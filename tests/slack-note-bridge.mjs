// Test-only stdin transport: real canonical service and SQLite, no remote server.
import readline from 'node:readline';
import {createDatabase} from './sqlite-d1.mjs';
import {writeCommand,readWorkspace,readNote} from '../db/repository.ts';
import {digest,handleDirective} from '../lib/orbit/slack/directives.ts';
const db=createDatabase();
const token='test-only-note-bridge-credential-1234567890';
for(const [index,id] of ['project-a','project-b'].entries())await writeCommand(db,'fixture-owner',{operationId:'seed-'+id,expectedRevision:index,action:{type:'project.upsert',project:{id,name:'Same name',goal:'',due:'2099-01-01',color:'#4455cc',symbol:'O',priority:3,status:'active'}}});
await db.prepare('INSERT INTO orbit_slack_credentials(token_hash,owner_id,workspace_id,requester_id,scope,expires_at,revoked) VALUES(?,?,?,?,?,?,0)').bind(await digest(token),'fixture-owner','T_TEST','U_TEST','directives:write',4102444800000).run();
for await(const line of readline.createInterface({input:process.stdin})){
 try{
 const {method,payload,remote_id}=JSON.parse(line);
 if(method==='INSPECT'){const workspace=await readWorkspace(db,'fixture-owner');workspace.data.notes=await Promise.all(workspace.data.notes.map(n=>readNote(db,'fixture-owner',n.id)));console.log(JSON.stringify({workspace,receipts:await db.prepare('SELECT COUNT(*) n FROM orbit_slack_directives').first()}));continue}
 const url='https://orbit.test/api/integrations/slack/directives'+(method==='GET'?'?'+new URLSearchParams(payload??{id:remote_id}):'');
 const response=await handleDirective(db,new Request(url,{method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(payload)}:{})}));
 console.log(JSON.stringify({status:response.status,data:await response.json()}));
 }catch(error){console.log(JSON.stringify({error:String(error)}))}
}
db.close();
