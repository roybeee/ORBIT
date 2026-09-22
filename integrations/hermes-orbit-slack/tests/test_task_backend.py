"""Actual SDK + TS/SQLite. Only Google HTTPS response is a provider fixture."""
import hashlib
import json
import pytest
from test_plugin import plugin, origin
from test_note_backend import backend, registered

INPUT = {'provider_status':'succeeded','change':{'kind':'task','provider':'google_tasks','text':'LG U+ test payment','due':'2026-09-30','providerTaskListId':'test-list','providerTaskId':'test-task'}}
GOOGLE = {'id':'test-task','title':'LG U+ test payment','due':'2026-09-30T00:00:00.000Z','status':'needsAction','etag':'"test-etag"','webViewLink':'https://tasks.google.com/task/test-task','notes':'private provider note'}


def test_real_task_result_receipt_and_replay(registered, backend, monkeypatch):
    loaded, registry = registered
    remote, calls = backend
    reads = []
    monkeypatch.setattr(loaded.module, 'orbit_request', remote)
    def google(list_id, task_id):
        reads.append((list_id, task_id))
        return dict(GOOGLE)
    monkeypatch.setattr(loaded.module, 'google_task_get', google, raising=False)
    with origin():
        first = json.loads(registry.dispatch('orbit_slack_directive_sync', INPUT))
        second = json.loads(registry.dispatch('orbit_slack_directive_sync', INPUT))
    assert first.get('success') is True, first
    assert second.get('success') is True, second
    assert first['receipt_only'] is True
    assert reads == [('test-list','test-task')]*2
    actual=remote('INSPECT')
    assert calls.count('POST') == actual['receipts']['n'] == 1
    assert actual['workspace']['data']['tasks'] == []
    assert actual['workspace']['data']['notes'] == []
    stored=remote('GET', {'id': first['receipt_id']})
    assert stored['change']['providerEtag'] == GOOGLE['etag']
    assert stored['change']['notesSha256'] == hashlib.sha256(GOOGLE['notes'].encode()).hexdigest()
    assert GOOGLE['notes'] not in json.dumps(stored)

@pytest.mark.parametrize('delta', [{'title':'different'}, {'due':'2026-10-01T00:00:00.000Z'}, {'id':'other'}, {'deleted':True}, {'hidden':True}])
def test_mismatching_provider_result_never_reaches_orbit(registered, backend, monkeypatch, delta):
    loaded, registry = registered
    remote,calls=backend
    monkeypatch.setattr(loaded.module,'orbit_request',remote)
    monkeypatch.setattr(loaded.module,'google_task_get',lambda *a:dict(GOOGLE,**delta),raising=False)
    with origin():
        reply=json.loads(registry.dispatch('orbit_slack_directive_sync',INPUT))
    assert not reply['success']
    assert 'POST' not in calls
    assert remote('INSPECT')['receipts']['n'] == 0


def test_failed_provider_attempt_is_receipt_only_without_google_get(registered, backend, monkeypatch):
    loaded, registry = registered
    remote, calls = backend
    monkeypatch.setattr(loaded.module, 'orbit_request', remote)
    monkeypatch.setattr(loaded.module, 'google_task_get', lambda *a: pytest.fail('failed creation has no Google item'))
    change = {key:INPUT['change'][key] for key in ('kind','provider','text','due')}
    with origin():
        reply=json.loads(registry.dispatch('orbit_slack_directive_sync', {'provider_status':'failed','provider_error':'secret raw error','change':change}))
    assert reply['state']=='provider_failed' and reply['verified'] and not reply['success'], reply
    actual=remote('GET', {'id':reply['receipt_id']})
    assert actual['providerError']=='provider_failed' and actual['target'] is None


def test_task_lost_ack_reconciles_without_second_post(registered, backend, monkeypatch):
    loaded, registry = registered
    remote,calls=backend
    lost=[]
    def transport(method,payload=None,remote_id=None):
        result=remote(method,payload,remote_id)
        if method=='POST' and not lost:
            lost.append(True)
            raise OSError('fixture lost ack')
        return result
    monkeypatch.setattr(loaded.module,'orbit_request',transport)
    monkeypatch.setattr(loaded.module,'google_task_get',lambda *a:dict(GOOGLE))
    with origin():
        first=json.loads(registry.dispatch('orbit_slack_directive_sync', INPUT))
        second=json.loads(registry.dispatch('orbit_slack_directive_sync', INPUT))
    assert first['state']=='uncertain' and second['success'], (first,second)
    assert calls.count('POST')==1


def test_untrusted_source_cannot_trigger_google_read(registered, monkeypatch):
    loaded, registry = registered
    monkeypatch.setattr(loaded.module,'google_task_get',lambda *a:pytest.fail('no trusted Slack source'))
    reply=json.loads(registry.dispatch('orbit_slack_directive_sync', INPUT))
    assert reply['state']=='pending_source'


def test_google_scope_does_not_borrow_ambient_credentials(plugin, monkeypatch):
    from agent.secret_scope import set_secret_scope, reset_secret_scope
    monkeypatch.setenv('ORBIT_SLACK_GOOGLE_TOKEN_FILE','/forbidden/ambient.json')
    token=set_secret_scope({})
    try:
        with pytest.raises(ValueError, match='google_task_credentials_required'):
            plugin.google_task_get('list','task')
    finally:
        reset_secret_scope(token)
