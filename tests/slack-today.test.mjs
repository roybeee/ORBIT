import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from './sqlite-d1.mjs';
import {writeCommand} from '../db/repository.ts';
import {digest} from '../lib/orbit/slack/directives.ts';
import {handleCommand} from '../lib/orbit/slack/commands.ts';
import {slackToday} from '../lib/orbit/slack/today.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';

// Hermes answers "오늘 ORBIT 할 일" from ORBIT itself instead of guessing through a browser or Google Tasks.
const token='test-only-integration-credential-1234567890';
const now=new Date('2099-01-10T03:00:00.000Z'); // 12:00 KST
const project={id:'ofd',name:'Old Ferry Donut',goal:'',color:'#4455cc',symbol:'O',due:'2099-06-30',priority:3,status:'active'};
const task=(id,extra={})=>({id,title:id,projectId:'ofd',status:'todo',duration:30,due:'2099-01-20',impact:3,focus:false,definition:'완료',...extra});
function data(){
 const d=emptyWorkspace();
 d.projects=[project];
 d.tasks=[
  task('오늘 마감',{due:'2099-01-10'}),
  task('지난 마감',{due:'2099-01-08'}),
  task('진행 중',{status:'doing'}),
  task('오늘 집중',{focus:true,focusDate:'2099-01-10'}),
  task('나중 할 일'),
  task('오늘 완료',{status:'done',due:'2099-01-10',completedOn:'2099-01-10'}),
  task('어제 완료',{status:'done',due:'2099-01-09',completedOn:'2099-01-09'}),
 ];
 return d;
}

test('today summary counts what matters today and lists the items to act on first',()=>{
 const summary=slackToday(data(),now,'https://orbit.test');
 assert.equal(summary.date,'2099-01-10');
 assert.deepEqual(summary.counts,{today:3,overdue:1,doing:1,focus:1,doneToday:1,open:5});
 assert.deepEqual(summary.items.map(i=>i.title),['오늘 집중','지난 마감','오늘 마감','진행 중'],'focus, overdue, due today, then in progress; later tasks are left out');
 assert.equal(summary.items[1].state,'overdue');
 assert.equal(summary.items[0].project,'Old Ferry Donut');
 assert.equal(summary.url,'https://orbit.test/#today');
});

test('the commands route serves the summary to the provisioned requester only',async()=>{
 const db=createDatabase();
 try{
  await writeCommand(db,'owner',{operationId:'seed',expectedRevision:0,action:{type:'project.upsert',project}});
  await writeCommand(db,'owner',{operationId:'seed-task',expectedRevision:1,action:{type:'task.upsert',task:task('오늘 마감',{due:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date())})}});
  await db.prepare('INSERT INTO orbit_slack_credentials(token_hash,owner_id,workspace_id,requester_id,scope,expires_at,revoked) VALUES(?,?,?,?,?,?,0)').bind(await digest(token),'owner','TTEST','UTEST','directives:write',4102444800000).run();
  const get=(query,credential=token)=>handleCommand(db,new Request('https://orbit.test/api/integrations/slack/commands'+query,{headers:{authorization:'Bearer '+credential}}));
  const ok=await get('?today=1&workspaceId=TTEST&requesterId=UTEST');
  assert.equal(ok.status,200);
  const body=await ok.json();
  assert.equal(body.contract,'orbit-slack-today-v1');
  assert.equal(body.counts.today,1);
  assert.equal(body.items[0].title,'오늘 마감');
  assert.equal(ok.headers.get('cache-control'),'private, no-store');
  assert.equal((await get('?today=1&workspaceId=TTEST&requesterId=UOTHER')).status,403,'another Slack user cannot read this workspace');
  assert.equal((await get('?today=1&workspaceId=TTEST&requesterId=UTEST','wrong-credential-000000000000000000000')).status,401);
 }finally{db.close()}
});
