"""Slack requests saved before the model runs (ORBIT-20260927-01).

Every Slack message the gateway dispatches is first written to a local outbox and then delivered to
ORBIT (`POST /api/integrations/slack/requests`), so a failing provider cannot lose an instruction.
When the provider's quota is already spent the agent is not started at all: the requester is told the
request is kept and why (quota, not credentials), and ORBIT resumes it once the limit is back.
How each turn ended (answered / limit / auth failure) is reported through the same ordered outbox.
"""
import asyncio
import contextlib
import json
import re
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone

MESSAGE_TS = re.compile(r'^\d{10}\.\d{6}$')
RETRY_AFTER = re.compile(r'retry.?after\D{0,3}(\d+)', re.I)
QUOTA_WORDS = re.compile(r'quota|usage limit|insufficient', re.I)
LIMIT_WORDS = re.compile(r'quota|usage limit|insufficient_quota|rate.?limit|\b429\b', re.I)
AUTH_WORDS = re.compile(r'\b40[13]\b|unauthori[sz]ed|invalid.{0,20}(key|token)|authentication', re.I)
SHORT_LIMIT_SECONDS = 15 * 60
PERMANENT = {400, 401, 403, 404, 405, 413, 415, 422}
KST = timezone(timedelta(hours=9))


class Receipts:
    """State shared by the gateway hooks; `post` sends one JSON body to ORBIT and returns (status, data)."""

    def __init__(self, state_path, post, origin, provider='openai-codex'):
        self.state_path, self.post, self.origin, self.provider = state_path, post, origin, provider
        self.limited, self.wake, self.lock = {}, threading.Event(), threading.Lock()
        self.worker = None

    @contextlib.contextmanager
    def db(self):
        self.state_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        conn = sqlite3.connect(self.state_path, timeout=15)
        try:
            conn.row_factory = sqlite3.Row
            conn.execute('CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at REAL NOT NULL DEFAULT 0)')
            conn.execute('CREATE TABLE IF NOT EXISTS requesters (workspace TEXT NOT NULL, user TEXT NOT NULL, accepted INTEGER NOT NULL, PRIMARY KEY (workspace, user))')
            with conn:
                yield conn
        finally:
            conn.close()

    # --- ordered delivery -------------------------------------------------------------------------
    def enqueue(self, key, body):
        with self.db() as conn:
            conn.execute('INSERT INTO outbox(key, body) VALUES(?, ?)', (key, json.dumps(body, ensure_ascii=False)))
        self.kick()

    def resume(self):
        # Deliveries left over from before a gateway restart go out without waiting for the next message.
        with self.db() as conn:
            if conn.execute('SELECT 1 FROM outbox LIMIT 1').fetchone():
                self.kick()

    def kick(self):
        with self.lock:
            if not self.worker or not self.worker.is_alive():
                self.worker = threading.Thread(target=self._run, name='orbit-slack-receipts', daemon=True)
                self.worker.start()
        self.wake.set()

    def _run(self):
        while True:
            self.wake.wait(timeout=60)
            self.wake.clear()
            try:
                self.flush()
            except Exception:
                pass

    def flush(self, deadline=None):
        """Delivers the outbox in order; stops at the first temporary failure (later entries depend on it)."""
        while deadline is None or time.time() < deadline:
            with self.db() as conn:
                row = conn.execute('SELECT seq, key, body, attempts, next_at FROM outbox ORDER BY seq LIMIT 1').fetchone()
            if not row or row['next_at'] > time.time():
                return
            body = json.loads(row['body'])
            try:
                status, data = self.post(body)
            except Exception:
                status, data = 0, {}
            if 200 <= status < 300 or status in PERMANENT:
                self._remember(body['source'], status, data)
                with self.db() as conn:
                    conn.execute('DELETE FROM outbox WHERE seq=?', (row['seq'],))
                continue
            delay = min(300, 5 * 2 ** row['attempts'])
            with self.db() as conn:
                conn.execute('UPDATE outbox SET attempts=attempts+1, next_at=? WHERE seq=?', (time.time() + delay, row['seq']))
            threading.Timer(delay, self.wake.set).start()
            return

    def _remember(self, source, status, data):
        # Only ORBIT's requester is stored; everyone else is refused (403/401) and remembered as such.
        accepted = 1 if 200 <= status < 300 else 0 if status in (401, 403) else None
        if accepted is None:
            return
        with self.db() as conn:
            conn.execute('INSERT OR REPLACE INTO requesters(workspace, user, accepted) VALUES(?,?,?)', (source['workspaceId'], source['requesterId'], accepted))

    def accepted(self, source):
        with self.db() as conn:
            row = conn.execute('SELECT accepted FROM requesters WHERE workspace=? AND user=?', (source['workspaceId'], source['requesterId'])).fetchone()
        return None if row is None else bool(row['accepted'])

    # --- provider state ---------------------------------------------------------------------------
    def quota_state(self):
        """{'kind', 'retry_after'} when every credential is exhausted by a 429, else None (core handles it)."""
        try:
            from agent.credential_pool import STATUS_EXHAUSTED, load_pool
            pool = load_pool(self.provider)
            if not pool.has_credentials() or pool.has_available():
                return None
            if not any(e.last_status == STATUS_EXHAUSTED and e.last_error_code == 429 for e in pool.entries()):
                return None
            until = pool.next_available_at()
        except Exception:
            return None
        retry_after = max(0, int(until - time.time())) if until else None
        kind = 'rate_limit' if retry_after is not None and retry_after <= SHORT_LIMIT_SECONDS else 'quota'
        return {'kind': kind, 'retry_after': retry_after}

    # --- hooks ------------------------------------------------------------------------------------
    def on_dispatch(self, event=None, gateway=None, **kwargs):
        """pre_gateway_dispatch: save the request, and answer for the agent when the quota is spent."""
        del kwargs
        try:
            source = slack_source(event)
            if not source:
                return None
            self.enqueue(receipt_key(source), {'action': 'receive', 'source': source, 'text': event.text.strip()[:4000]})
            state = self.quota_state()
            if not state:
                return None
            if self.accepted(source) is None:
                self.flush(deadline=time.time() + 3)
            kept = self.accepted(source) is True
            if not send_reply(gateway, event, limit_reply(state, kept)):
                return None
            self.report(source, 'limit', kind=state['kind'], detail='Codex provider quota exhausted (429); credentials are still valid', retry_after=state['retry_after'])
            return {'action': 'skip', 'reason': 'orbit_provider_' + state['kind']}
        except Exception:
            return None

    def on_api_error(self, status_code=None, retryable=None, retry_count=None, max_retries=None, reason=None, error=None, **kwargs):
        """api_request_error: report only the call that ends the turn (no retry left)."""
        del kwargs
        terminal = retryable is False or (retry_count is not None and max_retries is not None and retry_count >= max_retries)
        if not terminal:
            return None
        message = str((error or {}).get('message') or '') + ' ' + str(reason or '')
        source = self._origin_source()
        if not source:
            return None
        if status_code == 429 or LIMIT_WORDS.search(message):
            match = RETRY_AFTER.search(message)
            retry_after = int(match.group(1)) if match else None
            short = retry_after is not None and retry_after <= SHORT_LIMIT_SECONDS
            kind = 'quota' if QUOTA_WORDS.search(message) or not short else 'rate_limit'
            self.report(source, 'limit', kind=kind, detail=message.strip()[:300], retry_after=retry_after)
        elif status_code in (401, 403) or AUTH_WORDS.search(message):
            self.report(source, 'failed', kind='auth', detail=message.strip()[:300])
        return None

    def on_llm_done(self, **kwargs):
        """post_llm_call: the turn produced an answer; a turn that already reported a limit is left waiting."""
        del kwargs
        source = self._origin_source()
        if source and not self.limited.pop(receipt_key(source), False):
            self.report(source, 'answered')
        return None

    def report(self, source, outcome, kind=None, detail=None, retry_after=None):
        key = receipt_key(source)
        if outcome != 'answered':
            self.limited[key] = True
            while len(self.limited) > 500:
                self.limited.pop(next(iter(self.limited)))
        body = {'action': 'outcome', 'source': source, 'outcome': outcome}
        for field, value in (('kind', kind), ('detail', detail), ('retryAfterSeconds', retry_after)):
            if value is not None and value != '':
                body[field] = value
        self.enqueue(key, body)

    def _origin_source(self):
        try:
            origin = self.origin()
        except Exception:
            return None
        if not origin or not MESSAGE_TS.match(origin.get('message_ts') or ''):
            return None
        return build_source(origin['workspace'], origin['channel'], origin['user'], origin['message_ts'], origin.get('thread_ts'), origin.get('event_id'))


def build_source(workspace, channel, user, message_ts, thread_ts=None, event_id=None):
    source = {'platform': 'slack', 'workspaceId': workspace, 'requesterId': user, 'channelId': channel, 'messageTs': message_ts}
    if thread_ts and MESSAGE_TS.match(thread_ts):
        source['threadId'] = thread_ts
    if event_id:
        source['eventId'] = event_id[:160]
    return source


def receipt_key(source):
    return f"{source['workspaceId']}:{source['channelId']}:{source['messageTs']}"


def slack_source(event):
    """The ORBIT source of a user message on Slack, with the gateway ledger's event id when present."""
    source = getattr(event, 'source', None)
    platform = getattr(getattr(source, 'platform', None), 'value', getattr(source, 'platform', None))
    text = (getattr(event, 'text', '') or '').strip()
    if platform != 'slack' or not text or text.startswith('/') or getattr(event, 'internal', False) or getattr(source, 'is_bot', False):
        return None
    message_ts = getattr(event, 'message_id', None) or getattr(source, 'message_id', None) or ''
    workspace, event_id = getattr(source, 'scope_id', None) or getattr(source, 'guild_id', None) or '', ''
    correlation = (getattr(event, 'metadata', None) or {}).get('slack_origin_correlation_id')
    if correlation:
        try:
            from gateway.slack_event_ledger import get_origin
            ledger = get_origin(correlation) or {}
        except Exception:
            ledger = {}
        workspace, event_id = ledger.get('workspace_scope') or workspace, ledger.get('event_id') or ''
        message_ts = ledger.get('message_ts') or message_ts
    user, channel = getattr(source, 'user_id', None), getattr(source, 'chat_id', None)
    if not (workspace and channel and user and MESSAGE_TS.match(message_ts)):
        return None
    return build_source(workspace, channel, user, message_ts, getattr(source, 'thread_id', None), event_id)


def limit_reply(state, kept):
    """Names the real cause: a spent quota or a short rate limit, never missing credentials."""
    cause = '일시적 요청 제한' if state['kind'] == 'rate_limit' else 'AI 사용량 한도 소진'
    when = ''
    if state['retry_after'] is not None:
        when = (datetime.now(KST) + timedelta(seconds=state['retry_after'])).strftime('%-m/%-d %H:%M')
    lines = [f"⏳ {cause}으로 지금은 처리하지 못했습니다. 인증 정보 문제는 아니므로 다시 로그인할 필요가 없습니다."]
    if kept:
        lines.append('요청은 ORBIT에 보관했습니다 · 아직 일정·할 일은 등록되지 않았습니다.')
        lines.append(f"회복 예상 {when} 이후 원문을 한 번만 다시 해석해 ORBIT 결재함에 초안을 올리겠습니다. 같은 지시를 다시 보내지 않아도 됩니다." if when else '한도가 회복되면 원문을 한 번만 다시 해석해 ORBIT 결재함에 초안을 올리겠습니다. 같은 지시를 다시 보내지 않아도 됩니다.')
    else:
        lines.append(f"회복 예상 {when} 이후 다시 보내 주세요." if when else '한도가 회복되면 다시 보내 주세요.')
    return '\n'.join(lines)


def send_reply(gateway, event, text):
    """Schedules the reply on the gateway loop in the message's thread; False when it cannot be sent."""
    try:
        adapter = gateway.adapters.get(event.source.platform)
        if adapter is None:
            return False
        try:
            from gateway.platforms.base import _reply_anchor_for_event, _thread_metadata_for_source
            anchor = _reply_anchor_for_event(event)
            metadata = _thread_metadata_for_source(event.source, anchor)
        except Exception:
            anchor, metadata = None, None
        asyncio.get_running_loop().create_task(adapter.send(event.source.chat_id, text, reply_to=anchor, metadata=metadata))
        return True
    except Exception:
        return False
