"""Bounded Slack→ORBIT receipts. Identity comes only from gateway context/ledger."""
import contextvars
import hashlib
import json
import os
import sqlite3
from pathlib import Path
from urllib import error, parse, request

GUIDANCE = """새 ORBIT 메모는 쓰기 전에 orbit_slack_note_prepare로 canonical 후보를 준비하고 요청자의 정확한 승인 답변 뒤 request_id만으로 재개하세요. 준비 단계에는 provider_status를 넣지 마세요. 기존 사후 동기화 도구는 다음 규칙을 따릅니다. Slack 사용자의 일정·할 일·메모 변경을 실제로 수행/시도한 경우만 호출하세요. 모든 대화·첨부·비밀은 넣지 마세요. 출처는 런타임 자동 확인이므로 ID를 추측하지 마세요. 등록 위치·종류가 애매하면 alternatives에 후보를 넣으세요. needs_confirmation이면 반환된 approval_prompt로 요청자에게 프로젝트를 확인 질문하세요. 승인 문구를 대신 작성하거나 승인으로 간주하지 마세요. pending_source는 출처 미확인입니다. 부분 실패·provider_failed·readback 실패는 전체 성공이 아닙니다."""

GUIDANCE += " Google Tasks 성공 영수증은 change에 kind=task, provider=google_tasks, 원문 text/due, 실제 providerTaskListId/providerTaskId를 넣으세요. 프로젝트를 추측하지 마세요. 기존 Google 항목은 읽기만 하며 receipt_only는 ORBIT 업무 생성이 아닌 접수 기록입니다."


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))

def result(state, **extra):
    return dict(success=False, state=state, **extra)

def bound_origin():
    # Deliberately no get_session_env(): it permits process-env fallback in CLI.
    values = {var.name: value for var, value in contextvars.copy_context().items()}
    correlation = values.get('HERMES_SESSION_ORIGIN_CORRELATION_ID')
    if values.get('HERMES_SESSION_PLATFORM') != 'slack' or not isinstance(correlation, str) or not correlation:
        return None
    from gateway.slack_event_ledger import get_origin
    origin = get_origin(correlation)
    if not origin or origin.get('processing_state') == 'cancelled':
        return None
    pairs = [('HERMES_SESSION_CHAT_ID', 'channel_id'), ('HERMES_SESSION_USER_ID', 'requesting_user'), ('HERMES_SESSION_SCOPE_ID', 'workspace_scope'), ('HERMES_SESSION_MESSAGE_ID', 'message_ts')]
    if any(not values.get(key) or values[key] != origin.get(field) for key, field in pairs):
        raise ValueError('runtime_source_mismatch')
    if values.get('HERMES_SESSION_THREAD_ID', '') != (origin.get('thread_ts') or ''):
        raise ValueError('runtime_thread_mismatch')
    return origin

def database():
    from hermes_constants import get_hermes_home
    folder = Path(get_hermes_home()) / 'plugin-state' / 'orbit-slack-directive-sync'
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    conn = sqlite3.connect(folder / 'requests.sqlite3', timeout=15)
    os.chmod(folder / 'requests.sqlite3', 0o600)
    conn.row_factory = sqlite3.Row
    conn.execute('CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, origin TEXT, payload TEXT NOT NULL, state TEXT NOT NULL, choices TEXT NOT NULL DEFAULT "[]", selected TEXT, remote_id TEXT, response TEXT)')
    conn.execute('CREATE TABLE IF NOT EXISTS request_wires (id TEXT PRIMARY KEY, wire TEXT NOT NULL)')
    return conn

def bounded(params):
    payload = {key: params[key] for key in ('provider_status', 'change', 'project', 'alternatives') if key in params}
    if params.get('provider_status') not in ('succeeded', 'failed'):
        raise ValueError('provider_status_required')
    change = params.get('change')
    if not isinstance(change, dict) or len(encoded(payload).encode()) > 12000:
        raise ValueError('bounded_change_required')
    allowed = {'kind', 'text', 'title', 'date', 'due', 'duration', 'definition', 'provider', 'providerEventId', 'start', 'end', 'timeZone', 'items', 'providerTaskListId', 'providerTaskId', 'providerEtag', 'providerTaskStatus', 'providerUrl', 'notesSha256'}
    if set(change) - allowed:
        raise ValueError('unsupported_change_fields')
    kind = change.get('kind')
    required = {'task': ('text', 'due'), 'note': ('title', 'text', 'date'), 'calendar_agenda': ('title', 'date', 'providerEventId', 'timeZone', 'provider')}
    if kind not in required:
        raise ValueError('invalid_change_kind')
    for key in required[kind]:
        if not isinstance(change.get(key), str) or not change[key] or len(change[key]) > (4000 if key == 'text' and kind == 'note' else 160):
            raise ValueError('invalid_change_field')
    from datetime import date
    date_field = change.get('due') if kind == 'task' else change.get('date')
    if date.fromisoformat(date_field).isoformat() != date_field:
        raise ValueError('invalid_date')
    for key, value in change.items():
        if key == 'items':
            if not isinstance(value, list) or not 1 <= len(value) <= 50 or any(not isinstance(item, str) or not 1 <= len(item) <= 1000 for item in value):
                raise ValueError('invalid_agenda_items')
        elif key in ('duration', 'start', 'end'):
            if type(value) is not int:
                raise ValueError('invalid_numeric_field')
        elif not isinstance(value, str) or len(value) > 4000:
            raise ValueError('invalid_change_field')
    if kind == 'calendar_agenda' and (change.get('provider') != 'google_calendar' or not change.get('items') or not 0 <= change.get('start', -1) < change.get('end', -1) <= 1440):
        raise ValueError('invalid_calendar_agenda')
    project = payload.get('project')
    if project is not None and (not isinstance(project, dict) or not project or set(project) - {'id', 'name'} or any(not isinstance(value, str) or not 1 <= len(value) <= 160 for value in project.values())):
        raise ValueError('invalid_project')
    # Provider errors can carry tokens or raw response bodies; persist a category only.
    payload['provider_error'] = 'provider_failed' if params['provider_status'] == 'failed' else ''
    return payload

def source_for(origin, params):
    mapping = {'channel_id': 'channel_id', 'source_event_id': 'event_id', 'client_msg_id': 'client_msg_id', 'thread_id': 'thread_ts'}
    for supplied, stored in mapping.items():
        if supplied in params and params[supplied] != (origin.get(stored) or ''):
            raise ValueError('source_mismatch')
    if not origin.get('event_id') and not origin.get('client_msg_id'):
        return None
    source = {'platform': 'slack', 'channelId': origin['channel_id'], 'workspaceId': origin['workspace_scope'], 'requesterId': origin['requesting_user'], 'messageTs': origin['message_ts']}
    for field, remote in [('event_id', 'eventId'), ('client_msg_id', 'clientMsgId'), ('thread_ts', 'threadId')]:
        if origin.get(field):
            source[remote] = origin[field]
    return source

def http_json(url, token, method='GET', body=None):
    req = request.Request(url, data=encoded(body).encode() if body is not None else None,
                          headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method=method)
    return send_json(req)


def send_json(req):
    # Neither Slack nor ORBIT may forward credentials through redirects.
    class NoRedirect(request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with request.build_opener(NoRedirect).open(req, timeout=10) as reply:
        raw = reply.read(100001)
    if len(raw) > 100000:
        raise ValueError('response_too_large')
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError('invalid_response')
    return value

def scoped_setting(name):
    from agent.secret_scope import current_secret_scope, get_secret
    scope = current_secret_scope()
    # Even single-profile scope misses must not borrow another process credential.
    return (scope.get(name, '') if scope is not None else get_secret(name, ''))


def orbit_request(method, payload=None, remote_id=None):
    endpoint = scoped_setting('ORBIT_SLACK_DIRECTIVE_URL')
    token = scoped_setting('ORBIT_SLACK_INGEST_KEY')
    approved = scoped_setting('ORBIT_SLACK_APPROVED_ORIGIN')
    gate = scoped_setting('ORBIT_SLACK_SITES_BEARER')
    url = parse.urlsplit(endpoint)
    pin = parse.urlsplit(approved)
    if (url.scheme != 'https' or not url.netloc or url.username or url.password
            or url.query or url.fragment or url.path != '/api/integrations/slack/directives'
            or pin.scheme != 'https' or not pin.netloc or pin.username or pin.password
            or pin.path or pin.query or pin.fragment or url.netloc != pin.netloc
            or not token or not gate or any(c.isspace() for c in token + gate)):
        raise ValueError('orbit_configuration_required')
    if method == 'GET':
        endpoint += '?' + parse.urlencode(payload if payload is not None else {'id': remote_id})
        payload = None
    # Only this origin-pinned ORBIT path receives the separately scoped host gate.
    # The generic Slack helper above never reads or attaches this credential.
    req = request.Request(endpoint, data=encoded(payload).encode() if payload is not None else None,
        headers={'Authorization': 'Bearer ' + token, 'OAI-Sites-Authorization': 'Bearer ' + gate,
                 'Content-Type': 'application/json'}, method=method)
    return send_json(req)

def google_task_get(task_list_id, task_id):
    """GET only; explicit per-profile credential path, never ambient OAuth fallback."""
    path = scoped_setting('ORBIT_SLACK_GOOGLE_TOKEN_FILE')
    if not path or not Path(path).is_absolute():
        raise ValueError('google_task_credentials_required')
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request as RefreshRequest
    credentials = Credentials.from_authorized_user_file(path)
    if credentials.token_uri != 'https://oauth2.googleapis.com/token':
        raise ValueError('google_token_origin_mismatch')
    if not credentials.valid:
        credentials.refresh(RefreshRequest())
    endpoint = 'https://tasks.googleapis.com/tasks/v1/lists/' + parse.quote(task_list_id, safe='') + '/tasks/' + parse.quote(task_id, safe='')
    return http_json(endpoint, credentials.token)


def task_result(change):
    import re
    for field in ('providerTaskListId', 'providerTaskId'):
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,160}', change.get(field, '')):
            raise ValueError('google_task_identity_required')
    actual = google_task_get(change['providerTaskListId'], change['providerTaskId'])
    if (actual.get('id') != change['providerTaskId'] or actual.get('title') != change['text']
            or actual.get('due') != change['due'] + 'T00:00:00.000Z'
            or actual.get('deleted') or actual.get('hidden')
            or actual.get('status') not in ('needsAction', 'completed')
            or not isinstance(actual.get('etag'), str) or not 1 <= len(actual['etag']) <= 200
            or not re.fullmatch(r'https://tasks\.google\.com/task/[A-Za-z0-9_-]+(?:\?sa=\d+)?', actual.get('webViewLink', ''))
            or not isinstance(actual.get('notes', ''), str)):
        raise ValueError('google_task_readback_mismatch')
    return {key: change[key] for key in ('kind', 'provider', 'text', 'due', 'providerTaskListId', 'providerTaskId')} | {
        'providerEtag': actual['etag'], 'providerTaskStatus': actual['status'], 'providerUrl': actual['webViewLink'],
        'notesSha256': hashlib.sha256(actual.get('notes', '').encode()).hexdigest()}


def is_task_receipt(change):
    return change.get('kind') == 'task' and change.get('provider') == 'google_tasks'


def authorize_project(payload, origin):
    if is_task_receipt(payload['change']):
        binding = orbit_request('GET', {'resolveTaskReceipt': '1', 'workspaceId': origin['workspace_scope'], 'requesterId': origin['requesting_user']})
        if (binding.get('contract') != 'orbit-slack-task-receipt-v1' or binding.get('authorized') is not True
                or binding.get('workspaceId') != origin['workspace_scope'] or binding.get('requesterId') != origin['requesting_user']
                or not isinstance(binding.get('ownerId'), str) or not binding['ownerId']):
            raise ValueError('canonical_contract_unavailable')
        return binding
    project_id = (payload.get('project') or {}).get('id')
    if not project_id:
        raise ValueError('canonical_binding_required')
    binding = orbit_request('GET', {'resolveProjectId': project_id,
        'workspaceId': origin['workspace_scope'], 'requesterId': origin['requesting_user']})
    if (binding.get('contract') != 'orbit-slack-v2' or binding.get('authorized') is not True
            or binding.get('projectId') != project_id
            or binding.get('workspaceId') != origin['workspace_scope']
            or binding.get('requesterId') != origin['requesting_user']
            or not isinstance(binding.get('ownerId'), str) or not binding['ownerId']):
        raise ValueError('canonical_contract_unavailable')
    return binding


def verify_readback(data, wire):
    task_receipt = is_task_receipt(wire['change'])
    if (not task_receipt and not wire.get('project', {}).get('id')) or not wire.get('binding', {}).get('ownerId'):
        raise ValueError('canonical_binding_required')
    if data.get('operationKey') != wire.get('operationKey') or not wire.get('operationKey'):
        raise ValueError('readback_operation_mismatch')
    if data.get('binding') != wire['binding']:
        raise ValueError('readback_owner_mismatch')
    if data.get('source') != wire['source'] or data.get('change') != wire['change'] or data.get('providerStatus') != wire['providerStatus']:
        raise ValueError('readback_mismatch')
    if wire['providerStatus'] == 'failed':
        if data.get('status') != 'provider_failed':
            raise ValueError('readback_mismatch')
        return 'provider_failed'
    if task_receipt:
        c = wire['change']
        expected = {'id': c['providerTaskId'], 'taskListId': c['providerTaskListId'], 'title': c['text'], 'due': c['due'], 'status': c['providerTaskStatus'], 'etag': c['providerEtag'], 'url': c['providerUrl'], 'notesSha256': c['notesSha256'], 'ownerId': wire['binding']['ownerId']}
        if (data.get('status') != 'completed' or data.get('receiptOnly') is not True
                or data.get('target') != {'type': 'google_task', 'id': c['providerTaskId'], 'task': expected}):
            raise ValueError('readback_target_mismatch')
        return 'completed'
    if data.get('status') != 'completed' or not data.get('project', {}).get('id'):
        raise ValueError('readback_incomplete')
    if wire.get('project', {}).get('id') and data['project']['id'] != wire['project']['id']:
        raise ValueError('readback_project_mismatch')
    change = wire['change']
    target = data.get('target') or {}
    kind = 'task' if change['kind'] == 'task' else 'note'
    entity = target.get(kind) or {}
    if not target.get('id') or target.get('type') != kind or entity.get('id') != target['id'] or entity.get('projectId') != data['project']['id']:
        raise ValueError('readback_target_missing')
    expected = {'title': change['text'], 'due': change['due']} if kind == 'task' else {'title': change['title'], 'body': change.get('text') if change['kind'] == 'note' else '\n'.join(f'{i + 1}) {text}' for i, text in enumerate(change['items']))}
    expected['ownerId'] = wire['binding']['ownerId']
    if change['kind'] != 'task':
        expected['kind'] = 'knowledge'
        expected['date'] = change['date']
    if any(entity.get(key) != value for key, value in expected.items()):
        raise ValueError('readback_target_mismatch')
    return 'completed'

def cancellation(key, origin):
    from gateway.slack_event_ledger import get_origin, origin_is_cancelled
    correlation = origin['correlation_id']
    if not get_origin(correlation) or origin_is_cancelled(correlation):
        reply = result('cancelled', request_id=key, reconciliation_required=True)
        with database() as db:
            db.execute('UPDATE requests SET state=?,response=? WHERE id=?', ('cancelled', encoded(reply), key))
        return reply
    with database() as db:
        row = db.execute('SELECT state,response FROM requests WHERE id=?', (key,)).fetchone()
    if row and row['state'] == 'cancelled':
        return json.loads(row['response'])
    return None


def save_response(key, reply):
    # First terminal result wins over delayed transient responses. Cancellation
    # can still supersede completion via the live ledger fence.
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute("UPDATE requests SET state=?,response=? WHERE id=? AND state NOT IN ('completed','provider_failed','cancelled')", (reply['state'], encoded(reply), key))
        row = db.execute('SELECT response FROM requests WHERE id=?', (key,)).fetchone()
        return json.loads(row['response'])


def deliver(key, payload, origin):
    stopped = cancellation(key, origin)
    if stopped:
        return stopped
    if is_task_receipt(payload['change']):
        try:
            if payload.get('project') or payload.get('alternatives'):
                raise ValueError('task_receipt_has_no_project')
            change = task_result(payload['change']) if payload['provider_status'] == 'succeeded' else {field: payload['change'][field] for field in ('kind', 'provider', 'text', 'due')}
            payload = dict(payload, change=change)
        except Exception as exc:
            return result('provider_readback_failed', request_id=key, error=type(exc).__name__)
    wire = {'operationKey': key, 'source': source_for(origin, {}), 'providerStatus': payload['provider_status'], 'providerError': payload['provider_error'], 'change': payload['change']}
    if payload.get('project'):
        wire['project'] = payload['project']
    try:
        wire['binding'] = authorize_project(payload, origin)
    except Exception as exc:
        return result('blocked_contract', request_id=key, error=type(exc).__name__)
    # Commit the dispatch claim before I/O. A crash without a receipt ID remains
    # uncertain, never silently re-POSTed. Backend reconciliation is required.
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT * FROM requests WHERE id=?', (key,)).fetchone()
        previous = db.execute('SELECT wire FROM request_wires WHERE id=?', (key,)).fetchone()
        # Includes stale pre-gate requests and alternate-kind proposals. Only a
        # choice persisted by verified resume grants new canonical note creation.
        if payload['change']['kind'] == 'note' and payload['provider_status'] == 'succeeded' and not row['selected']:
            return result('approval_required', request_id=key)
        if previous and previous['wire'] != encoded(wire):
            return result('binding_conflict', request_id=key)
        if not previous and row['state'] not in ('pending', 'approved'):
            return result('legacy_reconciliation_required', request_id=key)
        db.execute('INSERT OR IGNORE INTO request_wires VALUES(?,?)', (key, encoded(wire)))
        if row['state'] in ('completed', 'provider_failed', 'cancelled'):
            return json.loads(row['response'])
        reconcile = row['state'] in ('sending', 'uncertain') and not row['remote_id']
        remote_id = row['remote_id']
        db.execute('UPDATE requests SET state=? WHERE id=?', ('sending', key))
    try:
        if reconcile:
            found = orbit_request('GET', {'operationKey': key})
            if any(found.get(field) != wire.get(field) for field in ('operationKey', 'source', 'change', 'project', 'binding', 'providerStatus')):
                raise ValueError('reconciliation_mismatch')
            remote_id = found.get('id')
            if not isinstance(remote_id, str) or not 1 <= len(remote_id) <= 200:
                remote_id = None
                raise ValueError('reconciliation_receipt_missing')
            with database() as db:
                db.execute('UPDATE requests SET remote_id=? WHERE id=?', (remote_id, key))
        if not remote_id:
            stopped = cancellation(key, origin)
            if stopped:
                return stopped
            posted = orbit_request('POST', wire)
            remote_id = posted.get('id')
            if not isinstance(remote_id, str) or not remote_id or len(remote_id) > 200:
                raise ValueError('receipt_id_missing')
            with database() as db:
                db.execute('UPDATE requests SET remote_id=? WHERE id=?', (remote_id, key))
        readback = orbit_request('GET', remote_id=remote_id)
        if readback.get('id') != remote_id:
            raise ValueError('readback_id_mismatch')
        if readback.get('status') == 'needs_confirmation':
            if readback.get('source') != wire['source'] or readback.get('change') != wire['change']:
                raise ValueError('readback_mismatch')
            candidates = readback.get('candidates', [])
            if not isinstance(candidates, list) or len(candidates) > 8 or any(not isinstance(item, str) or not 1 <= len(item) <= 100 for item in candidates):
                raise ValueError('invalid_candidates')
            choices = [{'label': item, 'destination': 'orbit', 'project': {'id': item}, 'change': payload['change']} for item in candidates]
            stopped = cancellation(key, origin)
            if stopped:
                return stopped
            with database() as db:
                db.execute('BEGIN IMMEDIATE')
                db.execute("UPDATE requests SET choices=? WHERE id=? AND state NOT IN ('completed','provider_failed','cancelled')", (encoded(choices), key))
            return save_response(key, confirmation(key, choices))
        stopped = cancellation(key, origin)
        if stopped:
            return stopped
        state = verify_readback(readback, wire)
        reply = dict(result(state, request_id=key, receipt_id=remote_id, verified=True), success=state == 'completed')
        if is_task_receipt(payload['change']):
            reply.update(receipt_only=True, provider_mutated=False)
        return save_response(key, reply)
    except Exception as exc:
        reply = result('readback_failed' if remote_id else 'uncertain', request_id=key, partial_failure=payload['provider_status'] == 'succeeded', retryable=bool(remote_id), error=type(exc).__name__)
        stopped = cancellation(key, origin)
        return stopped or save_response(key, reply)

def choices_for(payload):
    choices = payload.get('alternatives', [])
    if not isinstance(choices, list) or len(choices) > 8:
        raise ValueError('invalid_candidates')
    for choice in choices:
        if not isinstance(choice, dict) or set(choice) - {'label', 'project', 'change', 'destination'}:
            raise ValueError('invalid_candidate')
        if not isinstance(choice.get('label'), str) or not 1 <= len(choice['label']) <= 160:
            raise ValueError('invalid_candidate_label')
        if choice.get('destination') not in ('orbit', 'knowledge_base'):
            raise ValueError('invalid_destination')
        bounded({'provider_status': payload['provider_status'], 'change': choice.get('change'), 'project': choice.get('project')})
    return choices

def confirmation(key, choices):
    lines = [f'{index + 1}. {item["label"]} / {item["destination"]} / {item["change"].get("kind", "미확인")} / {encoded(item.get("project"))}' for index, item in enumerate(choices)]
    prompt = '등록 후보를 확인해 주세요.\n' + '\n'.join(lines)
    prompt += f'\n요청자 본인이 이 스레드에 정확히 `ORBIT 승인 {key} 번호`로 답해 주세요. 이 ORBIT 후보의 접수는 승인 전 실행하지 않습니다. 이미 시도된 외부 제공자 작업은 되돌리지 않습니다.'
    return result('needs_confirmation', request_id=key, confirmation_required=True, candidates=choices, approval_prompt=prompt)

def approval_message(origin):
    token = scoped_setting('SLACK_BOT_TOKEN')
    if not token:
        raise ValueError('slack_readback_configuration_required')
    auth = http_json('https://slack.com/api/auth.test', token)
    if auth.get('ok') is not True or auth.get('team_id') != origin['workspace_scope']:
        raise ValueError('slack_workspace_mismatch')
    query = parse.urlencode({'channel': origin['channel_id'], 'ts': origin.get('thread_ts') or origin['message_ts'], 'oldest': origin['message_ts'], 'latest': origin['message_ts'], 'inclusive': 'true', 'limit': 2})
    reply = http_json('https://slack.com/api/conversations.replies?' + query, token)
    if reply.get('ok') is not True:
        raise ValueError('slack_readback_failed')
    matches = [message for message in reply.get('messages', []) if message.get('ts') == origin['message_ts']]
    if len(matches) != 1:
        raise ValueError('approval_message_missing')
    return matches[0]

def resume(key):
    current = bound_origin()
    if not current:
        return result('pending_source', request_id=key)
    with database() as db:
        row = db.execute('SELECT * FROM requests WHERE id=?', (key,)).fetchone()
    if not row or not row['origin']:
        raise ValueError('request_not_found')
    original = json.loads(row['origin'])
    if any(original.get(field) != current.get(field) for field in ('workspace_scope', 'channel_id', 'requesting_user')):
        raise ValueError('approval_scope_mismatch')
    if (original.get('thread_ts') or original['message_ts']) != (current.get('thread_ts') or current['message_ts']):
        raise ValueError('approval_scope_mismatch')
    if current['correlation_id'] == original['correlation_id']:
        raise ValueError('fresh_approval_required')
    stopped = cancellation(key, original)
    if stopped:
        return stopped
    choices = json.loads(row['choices'])
    message = approval_message(current)
    stopped = cancellation(key, original)
    if stopped:
        return stopped
    if message.get('user') != current['requesting_user'] or message.get('ts') != current['message_ts'] or message.get('bot_id') or message.get('subtype') or message.get('edited'):
        raise ValueError('approval_not_original_human_message')
    # Exact anchored grammar, not a model-supplied "approved" boolean or copied quote.
    commands = {f'ORBIT 승인 {key} {index + 1}': index for index in range(len(choices))}
    if message.get('text') not in commands:
        raise ValueError('explicit_approval_required')
    selected = choices[commands[message['text']]]
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('SELECT * FROM requests WHERE id=?', (key,)).fetchone()
        if row['selected'] and row['selected'] != encoded(selected):
            raise ValueError('approval_conflict')
        if not row['selected']:
            if row['remote_id']:
                return result('receipt_transition_required', request_id=key, receipt_id=row['remote_id'])
            if row['state'] != 'needs_confirmation':
                raise ValueError('request_not_awaiting_approval')
            db.execute('UPDATE requests SET selected=?,state=? WHERE id=?', (encoded(selected), 'approved', key))
    if selected['destination'] != 'orbit':
        return result('destination_blocked', request_id=key, error='지식베이스 쓰기 어댑터는 미구현입니다. 저장하지 않았습니다.')
    payload = json.loads(row['payload'])
    payload.update(change=selected['change'], project=selected.get('project'))
    return deliver(key, payload, original)

def prepare_note(params, **kwargs):
    """Read-only canonical preparation. Only verified resume can execute a note.

    The legacy wire's succeeded flag means local ORBIT execution is requested;
    it is not evidence of a preceding external provider write. No POST occurs
    here until the durable requester choice has passed resume's Slack readback.
    """
    try:
        if 'request_id' in params:
            if set(params) != {'request_id'}:
                raise ValueError('resume_accepts_only_request_id')
            return encoded(resume(params['request_id']))
        if set(params) - {'change', 'project'}:
            raise ValueError('prepare_accepts_only_note_and_project')
        payload = bounded(dict(params, provider_status='succeeded'))
        if payload['change']['kind'] != 'note' or set(payload['change']) != {'kind', 'title', 'text', 'date'}:
            raise ValueError('note_only')
        origin = bound_origin()
        if not origin or not source_for(origin, {}):
            return encoded(result('pending_source', providerWritesAllowed=False))
        key = 'origin:' + origin['correlation_id']
        with database() as db:
            row = db.execute('SELECT * FROM requests WHERE id=?', (key,)).fetchone()
        if row:
            saved = json.loads(row['payload'])
            if any(saved.get(field) != payload.get(field) for field in ('change', 'project', 'provider_status')) or not json.loads(row['choices']):
                raise ValueError('payload_conflict')
            return _persist_directive(saved)
        query = {'prepareNote': '1', 'workspaceId': origin['workspace_scope'], 'requesterId': origin['requesting_user']}
        if payload.get('project', {}).get('id'):
            query['projectId'] = payload['project']['id']
        prepared = orbit_request('GET', query)
        candidates = prepared.get('candidates')
        if (prepared.get('contract') != 'orbit-slack-note-prepare-v1'
                or prepared.get('workspaceId') != origin['workspace_scope']
                or prepared.get('requesterId') != origin['requesting_user']
                or prepared.get('providerWritesAllowed') is not False
                or not isinstance(candidates, list) or len(candidates) > 8):
            raise ValueError('canonical_contract_unavailable')
        if not candidates:
            return encoded(result('blocked_no_candidates', providerWritesAllowed=False))
        choices = []
        for candidate in candidates:
            if not isinstance(candidate, dict) or any(not isinstance(candidate.get(field), str) or not 1 <= len(candidate[field]) <= 160 for field in ('id', 'name')):
                raise ValueError('invalid_candidates')
            if query.get('projectId') and candidate['id'] != query['projectId']:
                raise ValueError('canonical_candidate_mismatch')
            choices.append({'label': candidate['name'], 'destination': 'orbit', 'project': {'id': candidate['id']}, 'change': payload['change']})
        payload['alternatives'] = choices
        return _persist_directive(payload)
    except Exception as exc:
        return encoded(result('rejected', error=str(exc) if isinstance(exc, ValueError) else type(exc).__name__, providerWritesAllowed=False))


def sync_directive(params, **kwargs):
    # This exposed legacy tool is not a separate note-creation capability.
    # A model-asserted project/provider status cannot prove destination intent.
    try:
        if 'request_id' not in params:
            payload = bounded(params)
            origin = bound_origin()
            if origin:
                source_for(origin, params)  # Do not discard mismatched source hints.
            if is_task_receipt(payload['change']):
                if payload.get('project') or payload.get('alternatives'):
                    raise ValueError('task_receipt_has_no_project')
                return _persist_directive(payload)
            if payload['change']['kind'] == 'note' and payload['provider_status'] == 'succeeded':
                return prepare_note({key: payload[key] for key in ('change', 'project') if key in payload})
        return _persist_directive(params, **kwargs)
    except Exception as exc:
        return encoded(result('rejected', error=str(exc) if isinstance(exc, ValueError) else type(exc).__name__))


def _persist_directive(params, **kwargs):
    try:
        if 'request_id' in params:
            if set(params) != {'request_id'}:
                raise ValueError('resume_accepts_only_request_id')
            return encoded(resume(params['request_id']))
        payload = bounded(params)
        choices = choices_for(payload)
        origin = bound_origin()
        source = source_for(origin, params) if origin else None
        unbound_key = 'unbound:' + hashlib.sha256(encoded(payload).encode()).hexdigest()
        key = 'origin:' + origin['correlation_id'] if origin and source else unbound_key
        with database() as db:
            db.execute('BEGIN IMMEDIATE')
            if source and db.execute('SELECT 1 FROM requests WHERE id=?', (unbound_key,)).fetchone():
                return encoded(result('source_promotion_required', request_id=unbound_key))
            db.execute('INSERT OR IGNORE INTO requests(id,origin,payload,state,choices) VALUES(?,?,?,?,?)', (key, encoded(origin) if source else None, encoded(payload), 'pending_source' if not source else ('needs_confirmation' if choices else 'pending'), encoded(choices)))
            row = db.execute('SELECT * FROM requests WHERE id=?', (key,)).fetchone()
            if row['payload'] != encoded(payload):
                raise ValueError('payload_conflict')
            if row['origin']:
                origin = json.loads(row['origin'])  # Freeze first accepted aliases across redelivery.
        if not source:
            return encoded(result('pending_source', request_id=key, error='신뢰할 Slack 원본 이벤트에서 다시 요청해야 합니다. 외부 전송하지 않았습니다.'))
        if row['state'] == 'needs_confirmation':
            return encoded(confirmation(key, json.loads(row['choices'])))
        if row['selected']:
            selected = json.loads(row['selected'])
            if selected['destination'] != 'orbit':
                return encoded(result('destination_blocked', request_id=key))
            payload.update(change=selected['change'], project=selected.get('project'))
        return encoded(deliver(key, payload, origin))
    except Exception as exc:
        return encoded(result('rejected', error=str(exc) if isinstance(exc, ValueError) else type(exc).__name__))

SCHEMA = {'name': 'orbit_slack_directive_sync', 'description': 'Persist a bounded attempted Slack directive; trusted identity is automatic. Never collect ordinary conversations.', 'parameters': {'type': 'object', 'additionalProperties': False, 'properties': {
    **{key: {'type': 'string', 'maxLength': 200} for key in ('channel_id', 'source_event_id', 'client_msg_id', 'thread_id')},
    'provider_status': {'type': 'string', 'enum': ['succeeded', 'failed']},
    'provider_error': {'type': 'string', 'maxLength': 1000},
    'change': {'type': 'object'}, 'project': {'type': 'object'},
    'request_id': {'type': 'string', 'maxLength': 200, 'description': 'Resume only after requester posts the exact approval command. No model approval boolean.'},
    'alternatives': {'type': 'array', 'minItems': 1, 'maxItems': 8, 'items': {'type': 'object', 'additionalProperties': False, 'properties': {'label': {'type': 'string', 'maxLength': 160}, 'destination': {'type': 'string', 'enum': ['orbit', 'knowledge_base']}, 'project': {'type': 'object'}, 'change': {'type': 'object'}}, 'required': ['label', 'destination', 'change']}},
}, 'required': []}}

NOTE_SCHEMA = {'name': 'orbit_slack_note_prepare', 'description': 'Prepare an ORBIT knowledge note BEFORE writing. Always ask the requester using the returned approval_prompt; resume with request_id only after their exact Slack approval. No external provider status is needed.', 'parameters': {'type': 'object', 'additionalProperties': False, 'properties': {'change': {'type': 'object'}, 'project': {'type': 'object'}, 'request_id': {'type': 'string', 'maxLength': 200}}, 'required': []}}


def register(ctx):
    ctx.register_tool(name=NOTE_SCHEMA['name'], toolset='orbit', schema=NOTE_SCHEMA, handler=prepare_note)
    ctx.register_tool(name=SCHEMA['name'], toolset='orbit', schema=SCHEMA, handler=sync_directive)
    ctx.register_system_prompt_section('orbit.slack-directive-sync', GUIDANCE, position='after_memory', max_chars=1200)
