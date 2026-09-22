"""Continuous real gateway executor -> SDK registry -> HTTPS -> pinned TS/SQLite.
Only AIAgent inference/Slack delivery are fixtures; no plugin handlers or HTTP
functions are substituted. All homes/config/secrets are temporary.
"""
import os, sys, json, importlib, shutil, socket, subprocess, threading, hashlib, traceback
from pathlib import Path
from types import ModuleType
from urllib.request import urlopen
import pytest
R=Path(os.environ['ORBIT_TEST_RUNTIME']).resolve()
P=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(R))
from gateway.config import Platform
from gateway.platforms.base import MessageEvent,MessageType
from gateway.session import SessionSource
from gateway.session_context import set_session_vars,clear_session_vars
from gateway.slack_event_ledger import SlackEventOrigin,claim_work_event
from tests.gateway.test_queued_native_image_session_key import CaptureAdapter,_make_runner
NOTE={'change':{'kind':'note','title':'Progress','text':'  first\n2) 한글 원문  ','date':'2026-09-22'}}
TOOL='orbit_slack_note_prepare'
TOKEN='test-only-note-bridge-credential-1234567890'

@pytest.fixture
def safe_backend(tmp_path,monkeypatch):
    key=tmp_path/'key.pem'; cert=tmp_path/'cert.pem'
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    monkeypatch.setenv('SSL_CERT_FILE',str(cert))
    for name in ('HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'): monkeypatch.delenv(name,raising=False)
    original_connect=socket.socket.connect; original_dns=socket.getaddrinfo
    blocked=[]
    def connect(sock,address):
        if isinstance(address,tuple) and address[0] not in ('127.0.0.1','::1'):
            blocked.append(str(address));raise OSError('QA_NONLOOPBACK_BLOCKED')
        return original_connect(sock,address)
    def dns(host,*args,**kwargs):
        if host not in ('127.0.0.1','::1',None):
            blocked.append(str(host));raise OSError('QA_DNS_BLOCKED')
        return original_dns(host,*args,**kwargs)
    monkeypatch.setattr(socket.socket,'connect',connect);monkeypatch.setattr(socket,'getaddrinfo',dns)
    child=subprocess.Popen(['node','--experimental-strip-types',str(P / 'tests/registry-gated.mjs'),str(key),str(cert)],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        line=child.stdout.readline()
        assert line,child.stderr.read()
        info=json.loads(line)
        print('BACKEND',json.dumps(info),flush=True)
        yield info['url'],blocked
    finally:
        child.terminate();out,err=child.communicate(timeout=10)
        print('GATE_EVIDENCE',err,flush=True)
        assert child.returncode==0,(out,err)

@pytest.mark.parametrize('stale',[None,'1790000000.000002'])
@pytest.mark.parametrize('scoped',[False,True])
@pytest.mark.asyncio
async def test_continuous_queue_registry(tmp_path,monkeypatch,safe_backend,stale,scoped):
    from contextlib import nullcontext
    url,blocked=safe_backend
    home=tmp_path/'profile';home.mkdir()
    launch=tmp_path/'launch';launch.mkdir()
    folder=home/'plugins'/'orbit-slack-directive-sync';folder.mkdir(parents=True)
    for name in ('__init__.py','plugin.yaml'): shutil.copy(P/name,folder/name)
    (home/'config.yaml').write_text('plugins:\n  enabled: [orbit-slack-directive-sync]\n')
    (home/'.env').write_text('ORBIT_SLACK_DIRECTIVE_URL='+url+'\nORBIT_SLACK_INGEST_KEY='+TOKEN+'\nORBIT_SLACK_APPROVED_ORIGIN='+url.split('/api/')[0]+'\nORBIT_SLACK_SITES_BEARER=test-only-sites-gate\n')
    monkeypatch.setenv('HERMES_HOME',str(launch if scoped else home))
    monkeypatch.setenv('ORBIT_SLACK_DIRECTIVE_URL','https://orbit.example/forbidden' if scoped else url)
    monkeypatch.setenv('ORBIT_SLACK_INGEST_KEY','WRONG_AMBIENT_KEY' if scoped else TOKEN)
    monkeypatch.setenv('ORBIT_SLACK_APPROVED_ORIGIN', 'https://wrong.example' if scoped else url.split('/api/')[0])
    monkeypatch.setenv('ORBIT_SLACK_SITES_BEARER', 'WRONG_AMBIENT_GATE' if scoped else 'test-only-sites-gate')
    monkeypatch.delenv('HERMES_ENABLE_PROJECT_PLUGINS',raising=False)
    import gateway.run as run, gateway.session_context as sc, gateway.slack_event_ledger as ledger
    import hermes_cli.plugins as sdk, tools.registry as registry_module, agent.secret_scope as secrets
    from tools.registry import registry
    from hermes_constants import get_hermes_home
    provenance={m.__name__:m.__file__ for m in (run,sc,ledger,sdk,registry_module,secrets)}
    for file in provenance.values(): assert Path(file).resolve().is_relative_to(R),file
    monkeypatch.setattr(run,'_hermes_home',home)
    monkeypatch.setattr(run,'_resolve_runtime_agent_kwargs',lambda:{'api_key':'fixture'})
    monkeypatch.setattr(sdk,'get_bundled_plugins_dir',lambda:tmp_path/'empty-bundled')
    monkeypatch.setattr(sdk,'discover_entrypoint_manifests',lambda:[])
    main_thread=threading.get_ident()
    scope=run._profile_runtime_scope(home,hydrate_secrets=False) if scoped else nullcontext()
    with scope:
        # Use the actual cached manager, not an independent uncached manager.
        manager=sdk.get_plugin_manager();sdk.discover_plugins()
        loaded=manager._plugins['orbit-slack-directive-sync']
        assert loaded.enabled and not loaded.error
        assert registry.get_entry(TOOL).handler is loaded.module.prepare_note
        expected_hash=hashlib.sha256((P/'__init__.py').read_bytes()).hexdigest()
        assert hashlib.sha256(Path(loaded.module.__file__).read_bytes()).hexdigest()==expected_hash
        claims=[]
        for suffix,ts in [('A','1790000000.000002'),('B','1790000000.000003')]:
            claims.append(claim_work_event(SlackEventOrigin(workspace_scope='T_TEST',channel_id='C_TEST',thread_ts='1790000000.000001',message_ts=ts,event_id='Ev-'+suffix,client_msg_id='client-'+suffix,requesting_user='U_TEST',normalized_event_type='message')))
        observed=[];responses=[]
        class Agent:
            def __init__(self,**kw):self.tools=[];self.tool_progress_callback=kw.get('tool_progress_callback')
            def run_conversation(self,message,**kw):
                assert threading.get_ident()!=main_thread
                assert Path(get_hermes_home())==home
                assert registry.current_scope_key()==str(home.resolve())
                assert sdk.get_plugin_manager() is manager
                assert registry.get_entry(TOOL).handler is loaded.module.prepare_note
                assert loaded.module.scoped_setting('ORBIT_SLACK_DIRECTIVE_URL')==url
                assert loaded.module.scoped_setting('ORBIT_SLACK_INGEST_KEY')==TOKEN
                current=loaded.module.bound_origin()
                assert current['correlation_id']==claims[len(observed)].correlation_id,current
                if observed:
                    assert current['message_ts']=='1790000000.000003'
                    assert current['event_id']=='Ev-B' and current['client_msg_id']=='client-B'
                    assert kw['persist_user_platform_id']=='1790000000.000003'
                    exposed=registry.get_definitions({TOOL})
                    assert [d['function']['name'] for d in exposed]==[TOOL]
                    # No scope argument: exercise implicit real scope isolation.
                    pending=json.loads(registry.dispatch(TOOL,NOTE))
                    assert pending['state']=='needs_confirmation',pending
                    assert pending['request_id']=='origin:'+claims[1].correlation_id
                    assert [c['project']['id'] for c in pending['candidates']]==['project-a','project-b']
                    responses.append(pending)
                    print('CONTINUOUS_PROOF',json.dumps({'scoped':scoped,'stale_message_id':stale,'registry_scope':registry.current_scope_key(),'handler_module':registry.get_entry(TOOL).handler.__module__,'plugin_sha256':expected_hash,'executor_thread':threading.current_thread().name,'source':current,'reply':pending},ensure_ascii=False),flush=True)
                observed.append(current)
                return {'final_response':'done','messages':[],'api_calls':1}
        mod=ModuleType('run_agent');mod.AIAgent=Agent;monkeypatch.setitem(sys.modules,'run_agent',mod)
        adapter=CaptureAdapter();adapter.platform=Platform.SLACK;runner=_make_runner(adapter)
        def source(ts):return SessionSource(platform=Platform.SLACK,chat_id='C_TEST',chat_type='group',thread_id='1790000000.000001',user_id='U_TEST',scope_id='T_TEST',message_id=ts)
        a=source('1790000000.000002');b=source(stale);key=runner._session_key_for_source(a)
        adapter._pending_messages[key]=MessageEvent(text='queued B',message_type=MessageType.TEXT,source=b,message_id='1790000000.000003',metadata={'slack_origin_correlation_id':claims[1].correlation_id})
        tokens=set_session_vars(platform='slack',chat_id='C_TEST',thread_id='1790000000.000001',user_id='U_TEST',scope_id='T_TEST',message_id='1790000000.000002',session_key=key,origin_correlation_id=claims[0].correlation_id)
        try:
            await runner._run_agent('A','',[],a,'session',session_key=key,inbound_message_id='1790000000.000002',origin_correlation_id=claims[0].correlation_id)
            assert len(observed)==2 and len(responses)==1
            assert loaded.module.bound_origin()['correlation_id']==claims[0].correlation_id
            assert loaded.module.bound_origin()['message_ts']=='1790000000.000002'
            with loaded.module.database() as db:
                rows=db.execute('SELECT id,origin,state FROM requests').fetchall()
                assert len(rows)==1
                assert rows[0]['id']=='origin:'+claims[1].correlation_id
                assert json.loads(rows[0]['origin'])['message_ts']=='1790000000.000003'
                assert rows[0]['state']=='needs_confirmation'
            with urlopen(url.split('/api/')[0]+'/inspect') as reply:actual=json.load(reply)
            assert actual['receipts']['n']==0 and actual['workspace']['data']['notes']==[]
            assert len(actual['calls'])==1,actual
            call=actual['calls'][0]
            assert call['method']=='GET' and call['credential_match'] and call['status']==200
            assert 'prepareNote=1' in call['path'] and 'workspaceId=T_TEST' in call['path'] and 'requesterId=U_TEST' in call['path']
            assert not blocked,blocked
            # Only Slack auth/message readback is a fixture. ORBIT remains real HTTPS.
            approval_text=f"ORBIT 승인 {responses[0]['request_id']} 1"
            original_http=loaded.module.http_json
            def slack_readback(endpoint, token, *args, **kwargs):
                assert endpoint.startswith('https://slack.com/api/')
                if endpoint.endswith('auth.test'):return {'ok':True,'team_id':'T_TEST'}
                return {'ok':True,'messages':[{'text':approval_text,'user':'U_TEST','ts':'1790000000.000004'}]}
            monkeypatch.setattr(loaded.module,'http_json',slack_readback)
            monkeypatch.setenv('SLACK_BOT_TOKEN','fixture-slack')
            old_setting=loaded.module.scoped_setting
            monkeypatch.setattr(loaded.module,'scoped_setting',lambda name:'fixture-slack' if name=='SLACK_BOT_TOKEN' else old_setting(name))
            from test_plugin import origin
            with origin(event='Ev-approved',client='approved',ts='1790000000.000004'):
                done=json.loads(registry.dispatch(TOOL,{'request_id':responses[0]['request_id']}))
                replay=json.loads(registry.dispatch(TOOL,{'request_id':responses[0]['request_id']}))
            assert done['success'] and replay['success'],(done,replay)
            with urlopen(url.split('/api/')[0]+'/inspect') as reply:saved=json.load(reply)
            assert saved['receipts']['n']==1 and len(saved['workspace']['data']['notes'])==1
            assert saved['notes'][0]['body']==NOTE['change']['text']
            assert sum(c['method']=='POST' for c in saved['calls'])==1
            print('GATED_WRITE_READBACK_REPLAY',json.dumps({'notes':1,'receipts':1,'posts':1,'textExact':True}))
            print('VERIFIED_READBACK',json.dumps({'scoped':scoped,'calls':actual['calls'],'receipts':actual['receipts']['n'],'notes':len(actual['workspace']['data']['notes']),'inherited_A_restored':True,'blocked_attempts':blocked,'imports':provenance}),flush=True)
        finally:
            clear_session_vars(tokens)
            if hasattr(runner,'_executor'):runner._executor.shutdown(wait=True)
            manager.unload()




@pytest.mark.parametrize('mode', ['missing_gate','wrong_gate','bad_app','expired','revoked','foreign','redirect','generic'])
def test_transport_fences(tmp_path, monkeypatch, safe_backend, mode):
    from test_plugin import load
    from urllib.error import HTTPError
    url,blocked=safe_backend
    p=load()
    settings={'ORBIT_SLACK_DIRECTIVE_URL':url,'ORBIT_SLACK_APPROVED_ORIGIN':url.split('/api/')[0],
              'ORBIT_SLACK_SITES_BEARER':'test-only-sites-gate','ORBIT_SLACK_INGEST_KEY':TOKEN}
    # Runtime scoped resolution itself is exercised by the continuous matrix above.
    monkeypatch.setattr(p,'scoped_setting',lambda name:settings.get(name,''))
    if mode=='missing_gate':
        with pytest.raises(HTTPError) as exc:p.http_json(url,TOKEN)
        assert exc.value.code==403
        settings['ORBIT_SLACK_SITES_BEARER']=''
        with pytest.raises(ValueError):p.orbit_request('GET',{'prepareNote':1})
    elif mode in ('wrong_gate','bad_app','expired','revoked'):
        if mode=='wrong_gate':settings['ORBIT_SLACK_SITES_BEARER']='wrong'
        else:settings['ORBIT_SLACK_INGEST_KEY']=TOKEN+'-'+mode
        with pytest.raises(HTTPError) as exc:p.orbit_request('GET',{'prepareNote':1,'workspaceId':'T_TEST','requesterId':'U_TEST'})
        assert exc.value.code==(403 if mode=='wrong_gate' else 401)
    elif mode=='foreign':
        for foreign in ('https://slack.com/api/integrations/slack/directives','http://127.0.0.1/api/integrations/slack/directives',url.replace('/api/','@foreign.test/api/')):
            settings['ORBIT_SLACK_DIRECTIVE_URL']=foreign
            with pytest.raises(ValueError):p.orbit_request('GET',{})
    elif mode=='redirect':
        with pytest.raises(HTTPError) as exc:p.orbit_request('GET',{'redirect':1})
        assert exc.value.code==302
    else:
        assert not p.http_json(url.split('/api/')[0]+'/inspect','fixture-slack-token')['gatePresent']
    with urlopen(url.split('/api/')[0]+'/inspect') as reply:actual=json.load(reply)
    assert actual['receipts']['n']==0 and actual['workspace']['data']['notes']==[]
    assert actual['leaks']==0 and not blocked
