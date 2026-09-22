"""Actual TypeScript service/SQLite + actual gateway ledger; Slack readback is a fixture."""
import json
import subprocess
from pathlib import Path
import pytest
from test_plugin import plugin, origin, load

NOTE = {'change': {'kind':'note', 'title':'Progress', 'text':'  first\n2) 한글 원문  ', 'date':'2026-09-22'}}

@pytest.fixture
def backend():
    root = Path(__file__).resolve().parents[3]
    child = subprocess.Popen(['node', '--experimental-strip-types', str(root / 'tests/slack-note-bridge.mjs')], cwd=root, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    calls = []
    def remote(method, payload=None, remote_id=None):
        calls.append(method)
        child.stdin.write(json.dumps(dict(method=method,payload=payload,remote_id=remote_id))+'\n')
        child.stdin.flush()
        data = json.loads(child.stdout.readline())
        if method == 'INSPECT':
            return data
        if data.get('status') != 200:
            raise ValueError(str(data))
        return data['data']
    yield remote, calls
    child.stdin.close()
    child.wait(timeout=10)
    child.stdout.close()
    assert child.returncode == 0

@pytest.fixture
def registered(plugin, tmp_path):
    """Actual SDK manifest discovery, loader and scoped tool registry."""
    import shutil
    from hermes_cli.plugins import PluginManager
    from tools.registry import registry
    folder = tmp_path / 'plugins' / 'orbit-slack-directive-sync'
    folder.mkdir(parents=True)
    for name in ('__init__.py', 'plugin.yaml'):
        shutil.copy(Path(__file__).parents[1] / name, folder / name)
    manager = PluginManager(scope_key=str(tmp_path))
    manifests = manager._scan_directory(folder.parent, source='user')
    assert len(manifests) == 1
    manager._load_plugin(manifests[0])
    loaded = manager._plugins[manifests[0].key or manifests[0].name]
    assert loaded.enabled and not loaded.error, loaded.error
    try:
        yield loaded, registry
    finally:
        manager.unload()


def test_sdk_manifest_and_discovery(registered):
    loaded, registry = registered
    expected = {'orbit_slack_note_prepare', 'orbit_slack_directive_sync'}
    assert set(loaded.manifest.provides_tools) == expected
    assert set(loaded.tools_registered) == expected
    assert {d['function']['name'] for d in registry.get_definitions(expected)} == expected


@pytest.mark.parametrize('tool', ['orbit_slack_note_prepare', 'orbit_slack_directive_sync'])
def test_registered_tools_cannot_bypass_ambiguous_note_gate(registered, monkeypatch, backend, tool):
    loaded, registry = registered
    remote, calls = backend
    monkeypatch.setattr(loaded.module, 'orbit_request', remote)
    params = dict(NOTE, project={'id':'project-a'})
    if tool == 'orbit_slack_directive_sync':
        params['provider_status'] = 'succeeded'
    with origin():
        pending = json.loads(registry.dispatch(tool, params))
    assert pending['state'] == 'needs_confirmation', pending
    assert 'POST' not in calls
    assert remote('INSPECT')['receipts']['n'] == 0
    assert remote('INSPECT')['workspace']['data']['notes'] == []
    approvals = []
    def approval(current):
        approvals.append(current)
        return {'text':f"ORBIT 승인 {pending['request_id']} 1", 'user':'U_TEST', 'ts':current['message_ts']}
    monkeypatch.setattr(loaded.module, 'approval_message', approval)
    with origin(event='Ev-approval', client='approval', ts='1790000000.000003'):
        done = json.loads(registry.dispatch(tool, {'request_id':pending['request_id']}))
        replay = json.loads(registry.dispatch(tool, {'request_id':pending['request_id']}))
    assert approvals and done['success'] and replay['success'], (done, replay)
    actual = remote('INSPECT')
    assert calls.count('POST') == actual['receipts']['n'] == 1
    assert actual['workspace']['data']['notes'][0]['body'] == NOTE['change']['text']


def test_note_prepare_tool_is_registered(plugin):
    tools = {}
    class Context:
        def register_tool(self, **kwargs):
            tools[kwargs['name']] = kwargs
        def register_system_prompt_section(self, *args, **kwargs):
            pass
    plugin.register(Context())
    assert 'orbit_slack_note_prepare' in tools
    assert tools['orbit_slack_note_prepare']['handler'] == plugin.prepare_note
    assert 'provider_status' not in tools['orbit_slack_note_prepare']['schema']['parameters']['properties']


def test_prepare_ambiguous_note_then_verified_requester_choice_writes_once(plugin, monkeypatch, backend):
    remote, calls = backend
    p = load()  # Real authorization reader, not the fixture binding.
    monkeypatch.setattr(p, 'orbit_request', remote)
    assert callable(getattr(p, 'prepare_note', None)), 'pre-write note prepare handler required'
    with origin():
        pending = json.loads(p.prepare_note(NOTE))
    assert pending['state'] == 'needs_confirmation'
    assert [v['project']['id'] for v in pending['candidates']] == ['project-a','project-b']
    assert 'POST' not in calls
    before = remote('INSPECT')
    assert before['workspace']['data']['notes'] == [] and before['receipts']['n'] == 0
    # Slack auth.test and exact message readback are fixture-only; all ORBIT I/O is real.
    monkeypatch.setattr(p, 'scoped_setting', lambda name: 'test-slack-token')
    text = f"ORBIT 승인 {pending['request_id']} 2"
    def slack(url, token, *args):
        if url.endswith('auth.test'):
            return {'ok':True, 'team_id':'T_TEST'}
        return {'ok':True,'messages':[{'text':text,'user':'U_TEST','ts':'1790000000.000003'}]}
    monkeypatch.setattr(p, 'http_json', slack)
    with origin(event='Ev-other',client='other',user='OTHER',ts='1790000000.000004'):
        rejected = json.loads(p.prepare_note({'request_id':pending['request_id']}))
    assert rejected['state'] == 'rejected'
    assert remote('INSPECT')['receipts']['n'] == 0
    with origin(event='Ev-approval',client='approval',ts='1790000000.000003'):
        done = json.loads(p.prepare_note({'request_id':pending['request_id']}))
        replay = json.loads(p.prepare_note({'request_id':pending['request_id']}))
    assert done['success'] and replay['success'], (done,replay)
    actual = remote('INSPECT')
    assert actual['receipts']['n'] == 1 and calls.count('POST') == 1
    notes = actual['workspace']['data']['notes']
    assert len(notes) == 1 and notes[0]['projectId'] == 'project-b'
    assert notes[0]['body'] == NOTE['change']['text']
