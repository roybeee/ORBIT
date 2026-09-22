"""Regression tests: real Hermes context/ledger; remote responses are fixtures."""
import json
from concurrent.futures import ThreadPoolExecutor
import pytest

def test_name_only_canonical_readback_rejected(plugin):
    wire = {'source':{}, 'change':PAYLOAD['change'], 'providerStatus':'succeeded', 'project':{'name':'same'}}
    data = {**wire, 'status':'completed', 'project':{'id':'wrong'}, 'target':{'id':'t', 'type':'task', 'task':{'id':'t', 'projectId':'wrong', 'title':PAYLOAD['change']['text'], 'due':PAYLOAD['change']['due']}}}
    with pytest.raises(ValueError, match='canonical_binding_required'):
        plugin.verify_readback(data, wire)

def test_missing_backend_contract_blocks_before_post(plugin, monkeypatch):
    plugin = load()
    monkeypatch.setattr(plugin, 'http_json', lambda *a, **kw: {})
    calls = []
    original = plugin.orbit_request
    def remote(method, *a, **kw):
        calls.append(method)
        return original(method, *a, **kw)
    monkeypatch.setattr(plugin, 'orbit_request', remote)
    with origin():
        reply = json.loads(plugin.sync_directive(PAYLOAD))
    assert reply['state'] == 'blocked_contract'
    assert calls == ['GET']

from test_plugin import plugin, origin, PAYLOAD, load, fixture_binding

def test_lost_ack_reconciles_by_operation_key_without_repost(plugin, monkeypatch):
    saved = {}; calls = []
    def remote(method, payload=None, remote_id=None):
        calls.append(method)
        if method == 'POST':
            saved.update(payload)
            raise OSError('lost ACK')
        if payload:
            assert payload == {'operationKey':saved['operationKey']}
        return {'id':'r', 'status':'completed', **saved, 'target':{'id':'t','type':'task','task':{'id':'t','projectId':'project-a','ownerId':'fixture-owner','title':PAYLOAD['change']['text'],'due':PAYLOAD['change']['due']}}}
    monkeypatch.setattr(plugin, 'orbit_request', remote)
    with origin():
        first = json.loads(plugin.sync_directive(PAYLOAD))
    restarted = load()
    monkeypatch.setattr(restarted, 'authorize_project', fixture_binding)
    monkeypatch.setattr(restarted, 'orbit_request', remote)
    with origin():
        second = json.loads(restarted.sync_directive(PAYLOAD))
    assert first['state'] == 'uncertain'
    assert second['success']
    assert calls == ['POST','GET','GET']

def test_unbound_retry_cannot_create_second_durable_request(plugin, monkeypatch):
    first = json.loads(plugin.sync_directive(PAYLOAD))
    monkeypatch.setattr(plugin, 'orbit_request', lambda *a, **kw: pytest.fail('no authenticated source promotion'))
    with origin():
        second = json.loads(plugin.sync_directive(PAYLOAD))
    assert second['state'] == 'source_promotion_required'
    assert second['request_id'] == first['request_id']
    with plugin.database() as db:
        assert db.execute('SELECT count(*) FROM requests').fetchone()[0] == 1



def test_backend_receipt_approval_never_clears_receipt(plugin, monkeypatch):
    saved = {}
    def remote(method, payload=None, remote_id=None):
        if method == 'POST': saved.update(payload)
        return {'id':'existing-receipt','status':'needs_confirmation','candidates':['project-a'], **saved}
    monkeypatch.setattr(plugin, 'orbit_request', remote)
    with origin():
        pending = json.loads(plugin.sync_directive(PAYLOAD))
    monkeypatch.setattr(plugin, 'approval_message', lambda current: {'text':f"ORBIT 승인 {pending['request_id']} 1", 'user':'U_TEST', 'ts':current['message_ts']})
    with origin(event='Ev-approval', client='client-approval', ts='1790000000.000003'):
        reply = json.loads(plugin.sync_directive({'request_id':pending['request_id']}))
    assert reply['state'] == 'receipt_transition_required'
    with plugin.database() as db:
        assert db.execute('SELECT remote_id FROM requests').fetchone()[0] == 'existing-receipt'


@pytest.mark.parametrize('late_kind', ['error', 'confirmation'])
def test_late_read_error_cannot_overwrite_completed_receipt(plugin, monkeypatch, late_kind):
    saved = {}; nested = [False]
    def remote(method, payload=None, remote_id=None):
        if method == 'POST':
            saved.update(payload)
            return {'id':'r'}
        if not nested[0]:
            nested[0] = True
            assert json.loads(plugin.sync_directive(PAYLOAD))['success']
            if late_kind == 'confirmation':
                return {'id':'r', 'status':'needs_confirmation', 'candidates':['project-a'], **saved}
            raise OSError('older GET failed after newer GET completed')
        return {'id':'r', 'status':'completed', **saved, 'target':{'id':'t','type':'task','task':{'id':'t','projectId':'project-a','ownerId':'fixture-owner','title':PAYLOAD['change']['text'],'due':PAYLOAD['change']['due']}}}
    monkeypatch.setattr(plugin, 'orbit_request', remote)
    with origin():
        reply = json.loads(plugin.sync_directive(PAYLOAD))
    assert reply['success']
    with plugin.database() as db:
        assert db.execute('SELECT state FROM requests').fetchone()[0] == 'completed'


@pytest.mark.parametrize('field,value', [('authorized',False), ('contract','old'), ('projectId','wrong'), ('workspaceId','wrong'), ('requesterId','wrong'), ('ownerId','')])
def test_real_authorization_reader_rejects_misbound_contract(plugin, monkeypatch, field, value):
    plugin = load()
    from gateway.slack_event_ledger import get_origin
    with origin() as correlation:
        current = get_origin(correlation)
        response = fixture_binding(PAYLOAD, current)
        response[field] = value
        monkeypatch.setattr(plugin, 'http_json', lambda *a, **kw: response)
        reply = json.loads(plugin.sync_directive(PAYLOAD))
    assert reply['state'] == 'blocked_contract'
    with plugin.database() as db:
        assert db.execute('SELECT remote_id FROM requests').fetchone()[0] is None


def test_process_death_after_remote_acceptance_recovers_without_post(plugin, monkeypatch, tmp_path):
    import subprocess, sys
    from pathlib import Path
    fixture_file = tmp_path / 'synthetic-remote.json'
    code = """
import json, os, sys
sys.path.insert(0, sys.argv[1])
from test_plugin import load, origin, PAYLOAD, fixture_binding
p = load()
p.authorize_project = fixture_binding
def remote(method, payload=None, remote_id=None):
    assert method == 'POST'
    with open(sys.argv[2], 'w') as f:
        json.dump(payload, f)
        f.flush()
        os.fsync(f.fileno())
    os._exit(17)
p.orbit_request = remote
with origin():
    p.sync_directive(PAYLOAD)
"""
    child = subprocess.run([sys.executable, '-c', code, str(Path(__file__).parent), str(fixture_file)], timeout=20)
    assert child.returncode == 17
    saved = json.loads(fixture_file.read_text())
    with plugin.database() as db:
        assert db.execute('SELECT state,remote_id FROM requests').fetchone()[:] == ('sending', None)
    calls = []
    def remote(method, payload=None, remote_id=None):
        calls.append(method)
        assert method == 'GET'
        return {'id':'r', 'status':'completed', **saved, 'target':{'id':'t','type':'task','task':{'id':'t','projectId':'project-a','ownerId':'fixture-owner','title':PAYLOAD['change']['text'],'due':PAYLOAD['change']['due']}}}
    monkeypatch.setattr(plugin, 'orbit_request', remote)
    with origin():
        reply = json.loads(plugin.sync_directive(PAYLOAD))
    assert reply['success'] and calls == ['GET', 'GET']


def test_concurrent_active_secret_scopes_never_borrow_environment(plugin, monkeypatch):
    from agent.secret_scope import set_secret_scope, reset_secret_scope
    monkeypatch.setenv('SLACK_BOT_TOKEN', 'default-slack')
    def run(n):
        scope = {'ORBIT_SLACK_DIRECTIVE_URL': f'https://p{n}.example/api/integrations/slack/directives', 'ORBIT_SLACK_INGEST_KEY': f'key{n}', 'ORBIT_SLACK_APPROVED_ORIGIN': f'https://p{n}.example', 'ORBIT_SLACK_SITES_BEARER': f'gate{n}'} if n else {}
        token = set_secret_scope(scope)
        try:
            if not n:
                with pytest.raises(ValueError, match='orbit_configuration_required'):
                    plugin.orbit_request('GET', remote_id='r')
                with pytest.raises(ValueError, match='slack_readback_configuration_required'):
                    plugin.approval_message({})
                return
            assert plugin.orbit_request('GET', remote_id='r') == (f'https://p{n}.example/api/integrations/slack/directives?id=r', f'Bearer key{n}', f'Bearer gate{n}')
        finally:
            reset_secret_scope(token)
    monkeypatch.setattr(plugin, 'send_json', lambda req: (req.full_url, req.get_header('Authorization'), req.get_header('Oai-sites-authorization')))
    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(run, [0, 1, 2]))


@pytest.mark.parametrize('during_readback', [False, True])
def test_original_cancellation_survives_reload_and_approval(plugin, monkeypatch, during_readback):
    from gateway.slack_event_ledger import mark_origin_cancelled
    choice = {'label':'task', 'destination':'orbit', 'project':PAYLOAD['project'], 'change':PAYLOAD['change']}
    with origin() as correlation:
        pending = json.loads(plugin.sync_directive(dict(PAYLOAD, alternatives=[choice])))
    if not during_readback:
        mark_origin_cancelled(correlation)
    restarted = load()
    def approval(current):
        if during_readback:
            mark_origin_cancelled(correlation)
        return {'text':f"ORBIT 승인 {pending['request_id']} 1", 'user':'U_TEST', 'ts':current['message_ts']}
    monkeypatch.setattr(restarted, 'approval_message', approval)
    monkeypatch.setattr(restarted, 'orbit_request', lambda *a, **kw: pytest.fail('cancelled original must not dispatch'))
    with origin(event='Ev-approval', client='client-approval', ts='1790000000.000003'):
        reply = json.loads(restarted.sync_directive({'request_id':pending['request_id']}))
    assert reply['state'] == 'cancelled'
    with restarted.database() as db:
        assert db.execute('SELECT state FROM requests').fetchone()[0] == 'cancelled'
