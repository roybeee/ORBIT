"""Slack instruction -> Google + ORBIT at once.

Tasks go to Google Tasks and ORBIT together, notes go to ORBIT, and Google
Calendar events need no ORBIT write because ORBIT reads Google Calendar itself.
The Slack origin (workspace, requester, message) comes from the gateway, never
from model arguments.
"""
import contextlib
import contextvars
import hashlib
import json
import os
import sqlite3
from pathlib import Path
from urllib import error, parse, request

GUIDANCE = (
    "Slack에서 할 일 등록을 지시받으면 orbit_slack_task 하나로 Google Tasks와 ORBIT에 동시에 등록하세요. Google Tasks API를 따로 호출하지 마세요. "
    "title에는 사용자가 말한 할 일 문구만 그대로 넣으세요. '추가', '등록', '해줘', '할 일로' 같은 지시어나 날짜 표현은 붙이지 마세요(예: '내일 할 일로 A 추가해줘' → title 'A'). "
    "메모·기록 지시는 orbit_slack_note로 ORBIT에 저장하세요. 시간이 정해진 일정은 기존처럼 Google Calendar에 만드세요. ORBIT은 Google Calendar를 직접 읽으므로 따로 반영할 필요가 없습니다. "
    "사용자가 프로젝트를 말했으면 project에 그 말을 그대로 넣고, 말하지 않았으면 비워 두세요. "
    "결과 state가 needs_confirmation이면 question을 그대로 보여 주세요. 요청자가 번호로 답하면 orbit_slack_choose(request_id, choice)를 호출하세요. 번호를 추측하지 마세요. "
    "state가 completed가 아니면 성공이라고 말하지 말고, 어느 단계(google_task 또는 orbit)가 실패했는지 알리세요. "
    "ORBIT 할 일·오늘 할 일·남은 일을 물으면 orbit_slack_today로 ORBIT을 조회해 답하고 url을 링크로 주세요. 브라우저나 Google Tasks로 추측하지 말고, 실패하면 실패했다고 알리세요."
)

INBOX_NOTE = "프로젝트가 정해지지 않아 ORBIT의 Slack 보관함에 넣었습니다."


class NoRedirect(request.HTTPRedirectHandler):
    # Credentials must never follow a redirect to another origin.
    def redirect_request(self, *args, **kwargs):
        return None


def setting(name):
    try:
        from agent.secret_scope import get_secret
    except ImportError:
        return os.environ.get(name, '').strip()
    return (get_secret(name, '') or '').strip()


def hermes_home():
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except ImportError:
        return Path(os.environ.get('HERMES_HOME', str(Path.home() / '.hermes')))


def current_origin():
    """The Slack message being handled, verified against the gateway ledger when available."""
    values = {var.name: value for var, value in contextvars.copy_context().items() if isinstance(value, str)}
    if values.get('HERMES_SESSION_PLATFORM') != 'slack':
        return None
    origin = {'workspace': values.get('HERMES_SESSION_SCOPE_ID', ''), 'channel': values.get('HERMES_SESSION_CHAT_ID', ''),
              'user': values.get('HERMES_SESSION_USER_ID', ''), 'message_ts': values.get('HERMES_SESSION_MESSAGE_ID', ''),
              'thread_ts': values.get('HERMES_SESSION_THREAD_ID', ''), 'event_id': '', 'client_msg_id': ''}
    correlation = values.get('HERMES_SESSION_ORIGIN_CORRELATION_ID')
    if correlation:
        try:
            from gateway.slack_event_ledger import get_origin
        except ImportError:
            get_origin = None
        ledger = get_origin(correlation) if get_origin else None
        if ledger:
            origin.update(workspace=ledger['workspace_scope'], channel=ledger['channel_id'], user=ledger['requesting_user'],
                          message_ts=ledger['message_ts'], thread_ts=ledger.get('thread_ts') or '',
                          event_id=ledger.get('event_id') or '', client_msg_id=ledger.get('client_msg_id') or '')
    if not all(origin[key] for key in ('workspace', 'channel', 'user', 'message_ts')):
        return None
    return origin


def source_of(origin):
    source = {'platform': 'slack', 'workspaceId': origin['workspace'], 'requesterId': origin['user'],
              'channelId': origin['channel'], 'messageTs': origin['message_ts']}
    for field, remote in (('thread_ts', 'threadId'), ('event_id', 'eventId'), ('client_msg_id', 'clientMsgId')):
        if origin.get(field):
            source[remote] = origin[field]
    return source


def operation_key(origin, kind, *parts):
    digest = hashlib.sha256('\0'.join(parts).encode()).hexdigest()[:20]
    return f"slack:{origin['workspace']}:{origin['channel']}:{origin['message_ts']}:{kind}:{digest}"


@contextlib.contextmanager
def state_db():
    folder = hermes_home() / 'plugin-state' / 'orbit-commands'
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    conn = sqlite3.connect(folder / 'requests.sqlite3', timeout=15)
    try:
        conn.row_factory = sqlite3.Row
        conn.execute('CREATE TABLE IF NOT EXISTS requests (key TEXT PRIMARY KEY, requester TEXT NOT NULL, google_list TEXT, google_id TEXT)')
        with conn:
            yield conn
    finally:
        conn.close()


def send(req):
    try:
        with request.build_opener(NoRedirect).open(req, timeout=15) as reply:
            return reply.status, json.loads(reply.read(100001) or b'{}')
    except error.HTTPError as exc:
        try:
            return exc.code, json.loads(exc.read(100001) or b'{}')
        except ValueError:
            return exc.code, {'error': 'non_json_response'}


def orbit(method, body=None, query=None):
    endpoint = setting('ORBIT_SLACK_DIRECTIVE_URL')
    token, gate = setting('ORBIT_SLACK_INGEST_KEY'), setting('ORBIT_SLACK_SITES_BEARER')
    url = parse.urlsplit(endpoint)
    if url.scheme != 'https' or not url.path.endswith('/directives') or not token or not gate:
        raise RuntimeError('orbit_configuration_required')
    target = endpoint[:-len('/directives')] + '/commands' + ('?' + parse.urlencode(query) if query else '')
    req = request.Request(target, data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None, method=method,
                          headers={'Authorization': 'Bearer ' + token, 'OAI-Sites-Authorization': 'Bearer ' + gate, 'Content-Type': 'application/json'})
    return send(req)


def google_access_token():
    path = Path(setting('ORBIT_SLACK_GOOGLE_TOKEN_FILE') or hermes_home() / 'google_token.json')
    saved = json.loads(path.read_text())
    if 'https://www.googleapis.com/auth/tasks' not in (saved.get('scopes') or []):
        raise RuntimeError('google_tasks_scope_missing')
    form = parse.urlencode({'client_id': saved['client_id'], 'client_secret': saved['client_secret'],
                            'refresh_token': saved['refresh_token'], 'grant_type': 'refresh_token'}).encode()
    status, data = send(request.Request(saved.get('token_uri') or 'https://oauth2.googleapis.com/token', data=form, method='POST',
                                        headers={'Content-Type': 'application/x-www-form-urlencoded'}))
    if status != 200 or not data.get('access_token'):
        raise RuntimeError('google_token_refresh_failed')
    return data['access_token']


def create_google_task(title, due, notes):
    body = {'title': title, 'due': due + 'T00:00:00.000Z', **({'notes': notes} if notes else {})}
    status, data = send(request.Request('https://tasks.googleapis.com/tasks/v1/lists/%40default/tasks', method='POST',
                                        data=json.dumps(body, ensure_ascii=False).encode(),
                                        headers={'Authorization': 'Bearer ' + google_access_token(), 'Content-Type': 'application/json'}))
    if status != 200 or not data.get('id'):
        raise RuntimeError(f'google_task_create_failed_{status}')
    return {'taskListId': '@default', 'taskId': data['id']}


def reply(value):
    return json.dumps(value, ensure_ascii=False)


def summarize(status, data, key, google_task=None):
    extra = {'google_task': google_task} if google_task else {}
    if status != 200:
        return reply({'success': False, 'state': 'failed', 'stage': 'orbit', 'error': data.get('error', f'http_{status}'),
                      'retryable': status >= 500 or status == 409 and data.get('error') == 'authorization_or_revision_changed', 'request_id': key, **extra})
    if data.get('status') == 'needs_confirmation':
        lines = [f"{c['number']}. {c['name']}" for c in data.get('candidates', [])]
        question = '어느 프로젝트에 넣을까요?\n' + '\n'.join(lines) + '\n번호로 답해 주세요.'
        return reply({'success': False, 'state': 'needs_confirmation', 'request_id': key, 'question': question, **extra})
    if data.get('status') != 'completed' or not data.get('target'):
        return reply({'success': False, 'state': data.get('status', 'unknown'), 'stage': 'orbit', 'request_id': key, **extra})
    target, project = data['target'], data.get('project') or {}
    result = {'success': True, 'state': 'completed', 'request_id': key,
              'orbit': {'type': target['type'], 'id': target['id'], 'title': target['title'], 'project': project.get('name'), 'inbox': data.get('inbox', False)}, **extra}
    if data.get('inbox'):
        result['note'] = INBOX_NOTE
    return reply(result)


def need_origin():
    origin = current_origin()
    if not origin:
        raise RuntimeError('slack_origin_required')
    return origin


def add_task(params, **kwargs):
    del kwargs
    try:
        origin = need_origin()
        title, due = params['title'].strip(), params['due']
        notes = '\n'.join(v for v in (params.get('time') and f"시간: {params['time']}", params.get('notes')) if v)
        key = operation_key(origin, 'task', title, due)
        with state_db() as db:
            db.execute('INSERT OR IGNORE INTO requests(key,requester) VALUES(?,?)', (key, origin['user']))
            row = db.execute('SELECT google_list,google_id FROM requests WHERE key=?', (key,)).fetchone()
        google_task = {'taskListId': row['google_list'], 'taskId': row['google_id']} if row['google_id'] else None
        if not google_task:
            # Confirm ORBIT accepts this requester before anything is created in Google.
            status, data = orbit('GET', query={'preflight': '1', 'workspaceId': origin['workspace'], 'requesterId': origin['user']})
            if status != 200:
                return summarize(status, data, key)
            try:
                google_task = create_google_task(title, due, notes)
            except Exception as exc:
                return reply({'success': False, 'state': 'failed', 'stage': 'google_task', 'error': str(exc), 'retryable': True, 'request_id': key})
            with state_db() as db:
                db.execute('UPDATE requests SET google_list=?,google_id=? WHERE key=?', (google_task['taskListId'], google_task['taskId'], key))
        command = {'kind': 'task', 'title': title, 'due': due, 'googleTask': google_task}
        for field, value in (('project', params.get('project')), ('description', notes), ('duration', params.get('duration'))):
            if value:
                command[field] = value
        status, data = orbit('POST', {'operationKey': key, 'source': source_of(origin), 'command': command})
        return summarize(status, data, key, google_task)
    except Exception as exc:
        return reply({'success': False, 'state': 'failed', 'stage': 'orbit', 'error': str(exc), 'retryable': True})


def add_note(params, **kwargs):
    del kwargs
    try:
        origin = need_origin()
        title, text = params['title'].strip(), params['text']
        key = operation_key(origin, 'note', title, text)
        with state_db() as db:
            db.execute('INSERT OR IGNORE INTO requests(key,requester) VALUES(?,?)', (key, origin['user']))
        command = {'kind': 'note', 'title': title, 'text': text, **({'project': params['project']} if params.get('project') else {})}
        status, data = orbit('POST', {'operationKey': key, 'source': source_of(origin), 'command': command})
        return summarize(status, data, key)
    except Exception as exc:
        return reply({'success': False, 'state': 'failed', 'stage': 'orbit', 'error': str(exc), 'retryable': True})


def choose(params, **kwargs):
    del kwargs
    try:
        origin = need_origin()
        key = params['request_id']
        with state_db() as db:
            row = db.execute('SELECT requester,google_list,google_id FROM requests WHERE key=?', (key,)).fetchone()
        if not row or row['requester'] != origin['user'] or not key.startswith(f"slack:{origin['workspace']}:"):
            return reply({'success': False, 'state': 'failed', 'stage': 'orbit', 'error': 'request_not_found_for_this_requester'})
        google_task = {'taskListId': row['google_list'], 'taskId': row['google_id']} if row['google_id'] else None
        status, data = orbit('POST', {'operationKey': key, 'source': source_of(origin), 'choice': int(params['choice'])})
        return summarize(status, data, key, google_task)
    except Exception as exc:
        return reply({'success': False, 'state': 'failed', 'stage': 'orbit', 'error': str(exc), 'retryable': True})


def today(params, **kwargs):
    """Read-only: today's ORBIT work (focus, overdue, due today, in progress) for the Slack requester."""
    del params, kwargs
    try:
        origin = need_origin()
        status, data = orbit('GET', query={'today': '1', 'workspaceId': origin['workspace'], 'requesterId': origin['user']})
        if status != 200:
            return reply({'success': False, 'state': 'failed', 'stage': 'orbit', 'error': data.get('error', f'http_{status}')})
        return reply({'success': True, **data})
    except Exception as exc:
        return reply({'success': False, 'state': 'failed', 'stage': 'orbit', 'error': str(exc)})


def is_google_calendar_change(change):
    if not isinstance(change, dict) or not str(change.get('kind') or change.get('type') or '').startswith('calendar'):
        return False
    events = change.get('events')
    providers = [change.get('provider')] if change.get('provider') else [e.get('provider') for e in events if isinstance(e, dict)] if isinstance(events, list) and events else []
    return bool(providers) and all(p == 'google_calendar' for p in providers)


def legacy_sync(params, **kwargs):
    """Kept so earlier habits still work: calendar changes need no ORBIT write; others use the new tools."""
    del kwargs
    if is_google_calendar_change(params.get('change')):
        succeeded = params.get('provider_status') == 'succeeded'
        return reply({'success': succeeded, 'state': 'read_from_google' if succeeded else 'provider_failed', 'orbit_write': False,
                      'note': 'ORBIT은 Google Calendar를 직접 조회하므로 별도 쓰기가 필요 없습니다.' if succeeded else 'Google Calendar 변경이 실패해 ORBIT에 반영할 것이 없습니다.'})
    return reply({'success': False, 'state': 'use_new_tool', 'error': '할 일은 orbit_slack_task, 메모는 orbit_slack_note를 사용하세요.'})


text = lambda n: {'type': 'string', 'minLength': 1, 'maxLength': n}
TOOLS = [
    ('orbit_slack_task', add_task, 'Register one Slack-instructed to-do in Google Tasks and ORBIT together. Use once per to-do.',
     {'type': 'object', 'additionalProperties': False, 'required': ['title', 'due'], 'properties': {
         'title': {**text(160), 'description': "Only the to-do itself, verbatim; never add instruction words like 추가/등록/해줘 or the date (e.g. '내일 할 일로 A 추가해줘' -> 'A')."},
         'due': {'type': 'string', 'pattern': r'^\d{4}-\d{2}-\d{2}$', 'description': 'Due date YYYY-MM-DD (Asia/Seoul).'},
         'time': {'type': 'string', 'maxLength': 40, 'description': 'Optional time of day as said, e.g. 16:00.'},
         'notes': {'type': 'string', 'maxLength': 3000}, 'project': {'type': 'string', 'maxLength': 160, 'description': 'Project exactly as the user said it; omit if not said.'},
         'duration': {'type': 'integer', 'minimum': 5, 'maximum': 480}}}),
    ('orbit_slack_note', add_note, 'Save one Slack-instructed memo or record as an ORBIT knowledge note.',
     {'type': 'object', 'additionalProperties': False, 'required': ['title', 'text'], 'properties': {
         'title': text(160), 'text': text(4000), 'project': {'type': 'string', 'maxLength': 160, 'description': 'Project exactly as the user said it; omit if not said.'}}}),
    ('orbit_slack_choose', choose, "Apply the requester's numbered project choice to a request that returned needs_confirmation.",
     {'type': 'object', 'additionalProperties': False, 'required': ['request_id', 'choice'], 'properties': {
         'request_id': text(200), 'choice': {'type': 'integer', 'minimum': 1, 'maximum': 20}}}),
    ('orbit_slack_today', today, "Read today's ORBIT work for the Slack requester: counts and the first items to act on (focus, overdue, due today, in progress) with an ORBIT link. Read-only.",
     {'type': 'object', 'additionalProperties': False, 'properties': {}}),
    ('orbit_slack_directive_sync', legacy_sync, 'After creating a Google Calendar event from Slack, confirm that ORBIT needs no separate write.',
     {'type': 'object', 'additionalProperties': True, 'required': ['provider_status', 'change'], 'properties': {
         'provider_status': {'type': 'string', 'enum': ['succeeded', 'failed']}, 'change': {'type': 'object'}}}),
]


def register(ctx):
    for name, handler, description, parameters in TOOLS:
        ctx.register_tool(name=name, toolset='orbit', schema={'name': name, 'description': description, 'parameters': parameters}, handler=handler)
    ctx.register_system_prompt_section('orbit.slack-commands', GUIDANCE, position='after_memory', max_chars=1200)
