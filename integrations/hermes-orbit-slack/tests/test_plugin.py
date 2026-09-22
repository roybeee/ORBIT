import importlib.util
import json
from pathlib import Path
import pytest

PLUGIN = Path(__file__).parents[1] / '__init__.py'
def load():
    spec = importlib.util.spec_from_file_location('orbit_sync', PLUGIN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

@pytest.fixture
def plugin(tmp_path, monkeypatch):
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    monkeypatch.setenv('ORBIT_SLACK_DIRECTIVE_URL', 'https://orbit.example/api/integrations/slack/directives')
    monkeypatch.setenv('ORBIT_SLACK_INGEST_KEY', 'test-key')
    return load()

def test_schema_does_not_require_model_to_supply_identity(plugin):
    schema = plugin.SCHEMA['parameters']
    assert 'channel_id' not in schema.get('required', [])
    assert 'anyOf' not in schema

def test_absent_runtime_origin_cannot_be_fabricated(plugin):
    result = json.loads(plugin.sync_directive({'source_event_id':'Ev-fabricated', 'channel_id':'C-fabricated', 'provider_status':'succeeded', 'change':{'kind':'task','text':'bounded task','due':'2026-09-22'}}))
    assert result['state'] == 'pending_source'
    assert not result['success']
    assert result['request_id']

from contextlib import contextmanager

@contextmanager
def origin(event='Ev1', client='client1', user='U_TEST', channel='C_TEST', workspace='T_TEST', thread='1790000000.000001', ts='1790000000.000002'):
    from gateway.slack_event_ledger import SlackEventOrigin, claim_work_event
    from gateway.session_context import set_session_vars, clear_session_vars
    claimed = claim_work_event(SlackEventOrigin(workspace_scope=workspace, channel_id=channel, thread_ts=thread, message_ts=ts, event_id=event, client_msg_id=client, requesting_user=user, normalized_event_type='message'))
    tokens = set_session_vars(platform='slack', chat_id=channel, thread_id=thread, user_id=user, scope_id=workspace, message_id=ts, origin_correlation_id=claimed.correlation_id)
    try:
        yield claimed.correlation_id
    finally:
        clear_session_vars(tokens)

PAYLOAD = {'provider_status':'succeeded','project':{'id':'project-a'},'change':{'kind':'task','text':'가맹 준비','due':'2026-09-22'}}

def test_autofill_posts_and_reads_exact_target(plugin, monkeypatch):
    calls = []
    stored = {}
    def remote(method, payload=None, remote_id=None):
        calls.append(method)
        if method == 'POST':
            stored.update(payload)
        return {'id':'receipt-1', 'status':'completed', **stored, 'target':{'id':'task-1', 'type':'task', 'task':{'id':'task-1','title':'가맹 준비','due':'2026-09-22','projectId':'project-a'}}}
    monkeypatch.setattr(plugin, 'orbit_request', remote, raising=False)
    with origin():
        reply = json.loads(plugin.sync_directive(PAYLOAD))
    assert reply['success']
    assert calls == ['POST', 'GET']
    assert stored['source']['eventId'] == 'Ev1'
    assert stored['source']['workspaceId'] == 'T_TEST'
    assert stored['source']['requesterId'] == 'U_TEST'

def test_explicit_identity_mismatch_is_rejected(plugin):
    with origin():
        reply = json.loads(plugin.sync_directive(dict(PAYLOAD, channel_id='C_OTHER')))
    assert reply['state'] == 'rejected'
    assert reply['error'] == 'source_mismatch'


def test_ambiguity_approval_is_durable_and_exactly_once(plugin, monkeypatch):
    options = [{'label':'OFD 할 일', 'project':{'id':'project-a'}, 'destination':'orbit', 'change':PAYLOAD['change']}, {'label':'OFD 메모', 'project':{'id':'project-a'}, 'destination':'orbit', 'change':{'kind':'note','title':'확인','text':'가맹 준비','date':'2026-09-22'}}]
    posted = []
    saved = {}
    def remote(method, payload=None, remote_id=None):
        if method == 'POST':
            posted.append(payload)
            saved.update(payload)
        return {'id':'receipt-a','status':'completed',**saved,'target':{'type':'task','id':'task-a','task':{'id':'task-a','projectId':'project-a','title':'가맹 준비','due':'2026-09-22'}}}
    monkeypatch.setattr(plugin, 'orbit_request', remote)
    with origin():
        pending = json.loads(plugin.sync_directive(dict(PAYLOAD, alternatives=options)))
    assert pending['state'] == 'needs_confirmation'
    assert not posted
    assert len(pending['candidates']) == 2
    # Restart module; both proposal and selected choice must survive.
    restarted = load()
    monkeypatch.setattr(restarted, 'orbit_request', remote)
    monkeypatch.setattr(restarted, 'approval_message', lambda current: {'text':f"ORBIT 승인 {pending['request_id']} 1",'user':'U_TEST','ts':current['message_ts']}, raising=False)
    with origin(event='Ev-approval', client='client-approval', ts='1790000000.000003'):
        approved = json.loads(restarted.sync_directive({'request_id':pending['request_id']}))
        replay = json.loads(restarted.sync_directive({'request_id':pending['request_id']}))
    assert approved['success'] and replay['success']
    assert len(posted) == 1
    assert posted[0]['source']['eventId'] == 'Ev1'

def test_changed_payload_cannot_reuse_source(plugin, monkeypatch):
    monkeypatch.setattr(plugin, 'orbit_request', lambda *a, **kw: (_ for _ in ()).throw(OSError('offline')))
    with origin():
        plugin.sync_directive(PAYLOAD)
        reply = json.loads(plugin.sync_directive(dict(PAYLOAD, change={**PAYLOAD['change'], 'text':'changed'})))
    assert reply['state'] == 'rejected'
    assert reply['error'] == 'payload_conflict'


def test_backend_ambiguity_persists_candidate_request(plugin, monkeypatch):
    saved = {}
    def remote(method, payload=None, remote_id=None):
        if payload: saved.update(payload)
        return {'id':'amb-1','status':'needs_confirmation','candidates':['project-a','project-b'], **saved}
    monkeypatch.setattr(plugin, 'orbit_request', remote)
    with origin():
        reply = json.loads(plugin.sync_directive(PAYLOAD))
        repeated = json.loads(plugin.sync_directive(PAYLOAD))
    assert reply['state'] == repeated['state'] == 'needs_confirmation'
    assert [c['project']['id'] for c in reply['candidates']] == ['project-a','project-b']

@pytest.mark.parametrize('field,value', [('user','U_OTHER'),('channel','C_OTHER'),('workspace','T_OTHER'),('thread','1790000000.900000')])
def test_other_principal_or_route_cannot_approve(plugin, monkeypatch, field, value):
    choice = {'label':'task','destination':'orbit','project':{'id':'project-a'},'change':PAYLOAD['change']}
    with origin():
        pending = json.loads(plugin.sync_directive(dict(PAYLOAD, alternatives=[choice])))
    monkeypatch.setattr(plugin, 'approval_message', lambda _: pytest.fail('must not read message across scope'))
    with origin(event='Ev-other', client='client-other', ts='1790000000.000003', **{field:value}):
        reply = json.loads(plugin.sync_directive({'request_id':pending['request_id']}))
    assert reply['error'] == 'approval_scope_mismatch'

@pytest.mark.parametrize('message_patch', [{'text':'승인'}, {'text':'> ORBIT 승인 copied 1'}, {'bot_id':'B_TEST'}, {'edited':{'ts':'later'}}, {'subtype':'bot_message'}])
def test_copied_bot_or_edited_approval_is_not_authority(plugin, monkeypatch, message_patch):
    choice = {'label':'task','destination':'orbit','project':{'id':'project-a'},'change':PAYLOAD['change']}
    with origin():
        pending = json.loads(plugin.sync_directive(dict(PAYLOAD, alternatives=[choice])))
    monkeypatch.setattr(plugin, 'approval_message', lambda current: {'text':f"ORBIT 승인 {pending['request_id']} 1", 'user':'U_TEST', 'ts':current['message_ts'], **message_patch})
    with origin(event='Ev-approval', client='client-approval', ts='1790000000.000003'):
        reply = json.loads(plugin.sync_directive({'request_id':pending['request_id']}))
    assert reply['state'] == 'rejected'

def test_failed_provider_readback_is_not_overall_success(plugin, monkeypatch):
    saved = {}
    def remote(method, payload=None, remote_id=None):
        if method == 'POST': saved.update(payload)
        return {'id':'failed-1','status':'provider_failed',**saved}
    monkeypatch.setattr(plugin, 'orbit_request', remote)
    with origin():
        reply = json.loads(plugin.sync_directive(dict(PAYLOAD, provider_status='failed', provider_error='secret-token-DO-NOT-STORE')))
    assert reply['state'] == 'provider_failed' and reply['verified'] and not reply['success']
    with plugin.database() as db:
        assert 'secret-token' not in str([tuple(r) for r in db.execute('SELECT * FROM requests')])

def test_readback_failure_retries_get_without_second_post(plugin, monkeypatch):
    saved = {}; calls = []; fail = [True]
    def remote(method, payload=None, remote_id=None):
        calls.append(method)
        if method == 'POST': saved.update(payload)
        if method == 'GET' and fail[0]: raise OSError('read unavailable')
        return {'id':'r1','status':'completed',**saved,'target':{'id':'t1','type':'task','task':{'id':'t1','title':'가맹 준비','due':'2026-09-22','projectId':'project-a'}}}
    monkeypatch.setattr(plugin, 'orbit_request', remote)
    with origin():
        first = json.loads(plugin.sync_directive(PAYLOAD))
        fail[0] = False
        second = json.loads(plugin.sync_directive(PAYLOAD))
    assert first['state'] == 'readback_failed' and not first['success']
    assert second['success'] and calls == ['POST','GET','GET']

@pytest.mark.parametrize('sequence', [[('Ev1',None),('Ev1','client1'),(None,'client1')],[(None,'client1'),('Ev1','client1'),('Ev1',None)]])
def test_incremental_aliases_keep_one_request(plugin, monkeypatch, sequence):
    calls = []
    monkeypatch.setattr(plugin, 'orbit_request', lambda *a, **kw: (calls.append(a[0]), (_ for _ in ()).throw(OSError('uncertain')))[1])
    keys = []
    for event, client in sequence:
        with origin(event=event, client=client):
            keys.append(json.loads(plugin.sync_directive(PAYLOAD))['request_id'])
    assert len(set(keys)) == 1
    assert calls == ['POST']

@pytest.mark.parametrize('change', [{'kind':'task','text':{'secret':'nested'},'due':'2026-09-22'}, {'kind':'mystery','text':'x'}, {'kind':'note','title':'x','text':'x','date':'bad'}, {'kind':'task','text':'x','due':'2026-09-22','attachments':['raw']}])
def test_invalid_or_unbounded_changes_rejected_before_storage(plugin, change):
    with origin():
        reply = json.loads(plugin.sync_directive(dict(PAYLOAD, change=change)))
    assert reply['state'] == 'rejected'
    with plugin.database() as db:
        assert db.execute('SELECT count(*) FROM requests').fetchone()[0] == 0

def test_thread_root_request_can_be_approved_in_its_reply_thread(plugin, monkeypatch):
    choice = {'label':'task','destination':'orbit','project':{'id':'project-a'},'change':PAYLOAD['change']}
    with origin(thread=''):
        pending = json.loads(plugin.sync_directive(dict(PAYLOAD, alternatives=[choice])))
    monkeypatch.setattr(plugin, 'approval_message', lambda current: {'text':f"ORBIT 승인 {pending['request_id']} 1", 'user':'U_TEST', 'ts':current['message_ts']})
    monkeypatch.setattr(plugin, 'deliver', lambda *a: {'success': True, 'state': 'local_approval_verified'})
    with origin(event='Ev-approval', client='client-approval', ts='1790000000.000003', thread='1790000000.000002'):
        reply = json.loads(plugin.sync_directive({'request_id':pending['request_id']}))
    assert reply['state'] == 'local_approval_verified'


def test_unbound_pending_survives_restart_without_transmission(plugin, monkeypatch):
    monkeypatch.setattr(plugin, 'orbit_request', lambda *a, **kw: pytest.fail('must not send'))
    first = json.loads(plugin.sync_directive(PAYLOAD))
    restarted = load()
    second = json.loads(restarted.sync_directive(PAYLOAD))
    assert first['state'] == second['state'] == 'pending_source'
    assert first['request_id'] == second['request_id']
    with restarted.database() as db:
        rows = db.execute('SELECT origin,state FROM requests').fetchall()
    assert len(rows) == 1 and rows[0]['origin'] is None


@pytest.mark.parametrize('tamper', ['source', 'change', 'project', 'target', 'id'])
def test_wrong_readback_never_reports_success(plugin, monkeypatch, tamper):
    saved = {}
    def remote(method, payload=None, remote_id=None):
        if method == 'POST':
            saved.update(payload)
            return {'id': 'r1'}
        reply = {'id':'r1','status':'completed', **saved,
                 'target':{'id':'t1','type':'task','task':{'id':'t1','projectId':'project-a','title':'가맹 준비','due':'2026-09-22'}}}
        reply[tamper] = 'wrong' if tamper == 'id' else {}
        return reply
    monkeypatch.setattr(plugin, 'orbit_request', remote)
    with origin():
        reply = json.loads(plugin.sync_directive(PAYLOAD))
    assert reply['state'] == 'readback_failed' and not reply['success']


def test_runtime_message_mismatch_rejected_before_io(plugin, monkeypatch):
    from gateway.session_context import set_session_vars, clear_session_vars
    monkeypatch.setattr(plugin, 'orbit_request', lambda *a, **kw: pytest.fail('must not send'))
    with origin() as correlation:
        tokens = set_session_vars(platform='slack', chat_id='C_TEST', thread_id='1790000000.000001', user_id='U_TEST', scope_id='T_TEST', message_id='1790000000.999999', origin_correlation_id=correlation)
        try:
            reply = json.loads(plugin.sync_directive(PAYLOAD))
        finally:
            clear_session_vars(tokens)
    assert reply['state'] == 'rejected'
    assert reply['error'] == 'runtime_source_mismatch'


def test_env_origin_is_not_trusted(plugin, monkeypatch):
    monkeypatch.setenv('HERMES_SESSION_PLATFORM','slack')
    monkeypatch.setenv('HERMES_SESSION_ORIGIN_CORRELATION_ID','copied-origin')
    assert plugin.bound_origin() is None
