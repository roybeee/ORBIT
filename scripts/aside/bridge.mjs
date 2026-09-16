// ORBIT's local connector. No cloud token, npm dependency or third-party daemon.
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {randomBytes, randomUUID, timingSafeEqual, createHash} from 'node:crypto';
import {mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, fsyncSync, existsSync, statSync} from 'node:fs';
import {join, dirname, resolve, extname} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';

export const ORIGIN='https://orbit-personal-os.hflameb.chatgpt.site';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RESULT=30000;
function atomic(file,value){
  const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(value),{mode:0o600});
  const fd=openSync(tmp,'r');try{fsyncSync(fd)}finally{closeSync(fd)}renameSync(tmp,file);
  if(process.platform!=='win32'){const dir=openSync(dirname(file),'r');try{fsyncSync(dir)}finally{closeSync(dir)}}
}
function clean(text,max=1000){return String(text??'').replace(/\x1b\[[0-9;]*m/g,'').slice(0,max)}
function fail(message,status=400){return Object.assign(new Error(message),{status})}
export function parseEvents(text){
  let result='',activity='';
  for(const line of text.split('\n')){try{const event=JSON.parse(line);
    if(event.type==='tool_execution_start')activity=`도구 실행: ${clean(event.toolName,100)}`;
    if(event.type==='message_end'&&event.message?.role==='assistant'){
      const body=(Array.isArray(event.message.content)?event.message.content:[]).filter(p=>p.type==='text'&&typeof p.text==='string').map(p=>p.text).join('\n');
      if(body)result=body;
    }
  }catch{/* incomplete lines are read again on the next poll */}}
  return {result:result.length>MAX_RESULT?result.slice(0,MAX_RESULT-40)+'\n[긴 결과의 뒷부분은 로컬 로그에 보관]':result,activity};
}
export function readEvents(file){
  if(!existsSync(file))return {result:'',activity:''};
  const size=statSync(file).size;
  // Retain full dump locally, but parse a bounded tail; image blocks may be large.
  if(size<=8*1024*1024)return parseEvents(readFileSync(file,'utf8'));
  const fd=openSync(file,'r'),buffer=Buffer.alloc(8*1024*1024);
  try{const count=readFileChunk(fd,buffer,0,buffer.length,size-buffer.length);return parseEvents(buffer.subarray(0,count).toString('utf8').split('\n').slice(1).join('\n'))}finally{closeSync(fd)}
}
import {readSync as readFileChunk} from 'node:fs';

export async function createBridge({directory,cli,account,port=43127,origin=ORIGIN,timeoutMs=30*60*1000,probe=true}){
  mkdirSync(directory,{recursive:true,mode:0o700});
  const token=randomBytes(32).toString('hex'),jobs=new Map();
  let bridgeId='',ready=false,diagnostic='연결 프로그램을 준비하고 있습니다.',active=null,initialized=false;
  const headers={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  const server=http.createServer(async(req,res)=>{
    const send=(value,status=200)=>{res.writeHead(status,headers);res.end(JSON.stringify(value))};
    const requestOrigin=req.headers.origin;
    if(req.headers.host!==`127.0.0.1:${server.address().port}`||requestOrigin!==origin)return send({error:'허용되지 않은 요청 출처입니다.'},403);
    res.setHeader('Access-Control-Allow-Origin',origin);
    if(req.method==='OPTIONS'){
      res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Private-Network','true');return send({},204);
    }
    const supplied=req.headers.authorization??'',expected=`Bearer ${token}`;
    if(Buffer.byteLength(supplied)!==Buffer.byteLength(expected)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))return send({error:'연결 키가 일치하지 않습니다. 연결 프로그램을 다시 열어 주세요.'},401);
    if(!initialized)return send({error:'시작 중입니다.'},503);
    try{
      const path=new URL(req.url,'http://127.0.0.1').pathname;
      if(req.method==='GET'&&path==='/health')return send({protocol:1,bridgeId,account,ready,blocked:[...jobs.values()].some(j=>j.status==='needs_attention'),diagnostic});
      if(req.method==='GET'&&/^\/runs\/[a-f0-9-]+$/.test(path)){
        const job=jobs.get(path.split('/')[2]);if(!job)throw fail('이 PC에 실행 기록이 없습니다.',404);
        await poll(job);return send(publicRun(job));
      }
      if(req.method!=='POST')throw fail('지원하지 않는 요청입니다.',404);
      if(!req.headers['content-type']?.startsWith('application/json'))throw fail('JSON 입력이 필요합니다.',415);
      const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>90000)throw fail('입력이 너무 큽니다.',413);chunks.push(chunk)}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw fail('JSON 형식을 확인해 주세요.')}
      if(!UUID.test(input.runId??''))throw fail('실행 ID가 올바르지 않습니다.');
      if(path==='/runs'){
        if(!ready)throw fail(diagnostic,503);
        if(input.account!==account)throw fail('ASIDE 계정이 다릅니다. 기존 실행 계정으로 연결해 주세요.',409);
        if(typeof input.prompt!=='string'||input.prompt.length<10||input.prompt.length>28000)throw fail('업무 내용이 올바르지 않습니다.');
        const fingerprint=createHash('sha256').update(JSON.stringify({protocol:1,account,cli,prompt:input.prompt})).digest('hex');
        const old=jobs.get(input.runId);
        if(old){if(old.fingerprint&&old.fingerprint!==fingerprint)throw fail('같은 실행 ID의 내용이 다릅니다.',409);return send(publicRun(old));}
        if(active||[...jobs.values()].some(j=>['running','needs_attention'].includes(j.status)))throw fail('이전 ASIDE 실행을 먼저 확인해 주세요.',409);
        const job={runId:input.runId,fingerprint,status:'running',seq:1,progress:'ASIDE에 업무를 전달했습니다.',result:'',createdAt:new Date().toISOString()};
        // Durable intent before spawn; restart never silently replays this record.
        save(job);jobs.set(job.runId,job);
        const log=join(directory,job.runId+'.jsonl');
        const child=spawn(cli.command,[...cli.prefix,'exec','--account',account,'--log-dump',log,input.prompt],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
        active={runId:job.runId,child,timer:null};let stderr='';
        child.stdout.on('data',()=>{});child.stderr.on('data',data=>{stderr=(stderr+data.toString()).slice(-2000)});
        const finish=(code,error)=>{
          if(active?.runId===job.runId){clearTimeout(active.timer);active=null;}
          let events;try{events=readEvents(log)}catch{events={result:''};error='로컬 로그를 읽지 못했습니다. ASIDE 화면에서 결과를 확인해 주세요.';code=null}job.result=events.result;
          if(job.status==='running')job.status=code===0&&job.result?'needs_review':'needs_attention';
          job.progress=job.status==='needs_review'?'CLI 실행이 끝났습니다. 업무 결과를 검토해 주세요.':clean(error||`실행 상태 확인이 필요합니다 (종료 코드 ${code??'없음'}). ${stderr}`,1000);
          job.seq++;save(job);
        };
        child.once('error',error=>finish(null,error.message));child.once('close',code=>{if(job.status==='running'||active?.runId===job.runId)finish(code)});
        active.timer=setTimeout(()=>stop(job,'실행 제한 시간에 도달했습니다. ASIDE 화면에서 실제 작업 상태를 확인해 주세요.'),timeoutMs);
        return send(publicRun(job));
      }
      if(path==='/cancel'){
        let job=jobs.get(input.runId);
        // Tombstone prevents delayed dispatch after an earlier cancellation.
        if(!job){job={runId:input.runId,fingerprint:'',status:'needs_attention',seq:1,progress:'중지 요청을 기록했습니다. ASIDE 화면에서 상태를 확인해 주세요.',result:''};jobs.set(job.runId,job);save(job)}
        else if(job.status==='running')stop(job,'로컬 실행을 중지했습니다. ASIDE 브라우저의 실제 작업 종료는 직접 확인해 주세요.');
        return send(publicRun(job));
      }
      if(path==='/acknowledge'){
        const job=jobs.get(input.runId);if(!job)throw fail('실행 기록이 없습니다.',404);
        if(active?.runId===job.runId)throw fail('로컬 프로세스 종료를 기다려 주세요.',409);
        if(input.confirmed!==true)throw fail('ASIDE에서 작업이 종료되었는지 확인해 주세요.');
        // Acknowledgment releases the dispatch block, but cannot cause replay.
        job.acknowledged=true;job.status='needs_review';job.progress='사용자가 ASIDE 작업 종료를 확인했습니다.';job.seq++;save(job);return send(publicRun(job));
      }
      throw fail('지원하지 않는 요청입니다.',404);
    }catch(error){send({error:clean(error.message)},error.status??500)}
  });
  const save=job=>atomic(join(directory,job.runId+'.json'),job);
  const publicRun=job=>({runId:job.runId,status:job.status,seq:job.seq,progress:job.progress,result:job.result});
  const poll=async(job)=>{
    if(job.status!=='running')return;
    const event=readEvents(join(directory,job.runId+'.jsonl'));
    if(event.activity&&event.activity!==job.progress){job.progress=event.activity;job.seq++;save(job)}
  };
  const stop=(job,message)=>{
    job.status='needs_attention';job.progress=message;job.seq++;save(job);
    if(active?.runId===job.runId){const child=active.child;child.kill('SIGTERM');setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL')},10000).unref();}
  };
  // Bind before opening the journal: a second process must not mutate live records.
  await new Promise((ok,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',ok)});
  try{
    const identityFile=join(directory,'identity.json');
    bridgeId=existsSync(identityFile)?JSON.parse(readFileSync(identityFile,'utf8')).bridgeId:randomUUID();
    if(!UUID.test(bridgeId))throw Error('로컬 연결 ID를 확인해 주세요.');atomic(identityFile,{bridgeId});
    for(const file of readdirSync(directory).filter(f=>UUID.test(f.slice(0,-5))&&f.endsWith('.json'))){
      const job=JSON.parse(readFileSync(join(directory,file),'utf8'));
      if(job.status==='running'){job.status='needs_attention';job.progress='이전 연결이 중단되었습니다. ASIDE에서 실행 상태를 확인해 주세요.';try{job.result=readEvents(join(directory,job.runId+'.jsonl')).result}catch{/* diagnostic remains attention */}job.seq++;save(job)}jobs.set(job.runId,job);
    }
    const help=probe?spawnSync(cli.command,[...cli.prefix,'exec','--help'],{encoding:'utf8',timeout:12000,windowsHide:true,maxBuffer:1024*1024}):{status:0,stdout:'--account --log-dump'};
    const helpText=(help.stdout??'')+(help.stderr??'');ready=help.status===0&&helpText.includes('--log-dump')&&helpText.includes('--account');
    diagnostic=ready?'ASIDE CLI 호환성 확인 완료':`현재 CLI에서 --account와 --log-dump를 확인하지 못했습니다. ASIDE를 업데이트하고 개발자 설정에서 CLI를 설치해 주세요. ${clean(help.error?.message??'',200)}`;
    if(ready&&probe){const status=spawnSync(cli.command,[...cli.prefix,'account','status',account],{encoding:'utf8',timeout:12000,windowsHide:true,maxBuffer:1024*1024});if(status.status!==0){ready=false;diagnostic='선택한 ASIDE 계정을 확인하지 못했습니다. ASIDE에 로그인하고 SETUP-ACCOUNT.cmd에서 계정을 다시 선택해 주세요.'}}
    initialized=true;
  }catch(error){await new Promise(ok=>server.close(ok));throw error}
  return {server,token,bridgeId,port:server.address().port,ready,diagnostic,close:async()=>{if(active){const job=jobs.get(active.runId);stop(job,'연결 프로그램이 종료되었습니다. ASIDE에서 실행 상태를 확인해 주세요.')}await new Promise(ok=>server.close(ok))}};
}

export function resolveCli(){
  const configured=process.env.ASIDE_EXECUTABLE;
  if(configured){const file=resolve(configured);if(!existsSync(file))throw Error('ASIDE_EXECUTABLE 파일을 찾을 수 없습니다.');if(/\.m?js$/i.test(file))return {command:process.execPath,prefix:[file]};if(process.platform==='win32'&&extname(file).toLowerCase()!=='.exe')throw Error('ASIDE_EXECUTABLE은 .exe 또는 .js 파일이어야 합니다.');return {command:file,prefix:[]}}
  if(process.platform!=='win32')return {command:'aside',prefix:[]};
  const where=spawnSync('where.exe',['aside'],{encoding:'utf8',windowsHide:true});
  const paths=(where.stdout??'').trim().split(/\r?\n/).filter(Boolean);
  const exe=paths.find(p=>/\.exe$/i.test(p));if(exe)return {command:exe,prefix:[]};
  for(const shim of paths.filter(p=>/\.cmd$/i.test(p))){
    // Recognize quoted npm-style JS targets only. Never run a command shell.
    const source=readFileSync(shim,'utf8');
    const match=source.match(/"%(?:~dp0|dp0%)\\?([^"\r\n]+\.m?js)"/i);
    if(match){const entry=resolve(dirname(shim),match[1]);if(existsSync(entry))return {command:process.execPath,prefix:[entry]};}
  }
  throw Error('ASIDE CLI를 찾지 못했습니다. ASIDE 설정 → Developers에서 CLI를 설치하고 다시 실행해 주세요.');
}
async function main(){
  if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js 22 이상이 필요합니다. https://nodejs.org/ 에서 LTS를 설치해 주세요.');
  const directory=join(homedir(),'.orbit-aside'),configFile=join(directory,'config.json');mkdirSync(directory,{recursive:true,mode:0o700});
  const cli=resolveCli();let account=existsSync(configFile)?JSON.parse(readFileSync(configFile,'utf8')).account:'';
  if(!account||process.argv.includes('--setup')){
    console.log('\nASIDE 계정 목록 (공식 CLI):');const listed=spawnSync(cli.command,[...cli.prefix,'account','list'],{stdio:'inherit',timeout:15000,windowsHide:true});
    if(listed.error||listed.status!==0)throw Error('ASIDE를 열고 로그인한 뒤 CLI 설치 상태를 확인해 주세요.');
    const input=createInterface({input:process.stdin,output:process.stdout});try{account=(await input.question('\n위 목록에서 사용할 account ID를 입력하세요: ')).trim()}finally{input.close()}
    if(!account||account.length>150)throw Error('올바른 account ID가 필요합니다.');atomic(configFile,{account});
  }
  const bridge=await createBridge({directory,cli,account});
  console.log('\n'+bridge.diagnostic+'\n계정: '+account+'\n이 창과 ORBIT 탭을 열어 두세요. Ctrl+C로 종료합니다.');
  const url=ORIGIN+'/#aside-connect='+bridge.token;
  console.log('\n브라우저가 열리지 않으면 아래 주소를 이 PC의 브라우저에 붙여 넣으세요. 연결 키가 포함되어 있으므로 공유하지 마세요.\n'+url+'\n');
  if(!process.argv.includes('--no-open')){
    const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
    const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
    spawn(command,args,{shell:false,stdio:'ignore',detached:true}).on('error',()=>{}).unref();
  }
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await bridge.close();process.exit(0)});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error('\n'+error.message);process.exitCode=1});
