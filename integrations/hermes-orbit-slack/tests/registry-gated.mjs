import https from 'node:https';
import {readFileSync} from 'node:fs';
import net from 'node:net';
import {createDatabase} from '../../../tests/sqlite-d1.mjs';
import {writeCommand,readWorkspace,readNote} from '../../../db/repository.ts';
import {digest,handleDirective} from '../../../lib/orbit/slack/directives.ts';
net.Socket.prototype.connect = function(){throw new Error('QA_NODE_OUTBOUND_BLOCKED')};
const db=createDatabase();
const token='test-only-note-bridge-credential-1234567890';
for(const [index,id] of ['project-a','project-b'].entries()) await writeCommand(db,'fixture-owner',{operationId:'seed-'+id,expectedRevision:index,action:{type:'project.upsert',project:{id,name:'Same name',goal:'',due:'2099-01-01',color:'#4455cc',symbol:'O',priority:3,status:'active'}}});
await db.prepare('INSERT INTO orbit_slack_credentials(token_hash,owner_id,workspace_id,requester_id,scope,expires_at,revoked) VALUES(?,?,?,?,?,?,0)').bind(await digest(token),'fixture-owner','T_TEST','U_TEST','directives:write',4102444800000).run();
for(const [suffix,expires,revoked] of [['expired',1,0],['revoked',4102444800000,1]]) await db.prepare('INSERT INTO orbit_slack_credentials VALUES(?,?,?,?,?,?,?)').bind(await digest(token+'-'+suffix),'fixture-owner','T_TEST','U_TEST','directives:write',expires,revoked).run();
const calls=[];let leaks=0;
const server=https.createServer({key:readFileSync(process.argv[2]),cert:readFileSync(process.argv[3])},async(req,res)=>{
 try {
 if(req.url==='/leak') {leaks++;res.end('{}');return;}
 if(req.url.includes('redirect=1')) {res.writeHead(302,{location:`https://127.0.0.1:${server.address().port}/leak`});res.end();return;}
 if(req.url!=='/inspect' && req.headers['oai-sites-authorization']!=='Bearer test-only-sites-gate') { console.error('QA_GATE_REJECT '+JSON.stringify({integrationBearerPresent:!!req.headers.authorization,sitesGatePresent:!!req.headers['oai-sites-authorization']})); res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:'fixture_private_sites_gate_required'}));return;}
 if(req.url==='/inspect') {res.end(JSON.stringify({calls,leaks,gatePresent:!!req.headers['oai-sites-authorization'],notes:await Promise.all((await readWorkspace(db,'fixture-owner')).data.notes.map(n=>readNote(db,'fixture-owner',n.id))),workspace:await readWorkspace(db,'fixture-owner'),receipts:await db.prepare('SELECT COUNT(*) n FROM orbit_slack_directives').first()}));return;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 const response=await handleDirective(db,new Request('https://127.0.0.1'+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
 const body=await response.text();
 calls.push({method:req.method,path:req.url,credential_match:req.headers.authorization==='Bearer '+token,status:response.status});
 res.writeHead(response.status,{'content-type':'application/json'});res.end(body);
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({url:`https://127.0.0.1:${server.address().port}/api/integrations/slack/directives`,snapshot:new URL('../../../',import.meta.url).pathname,sqlite:'real migrated :memory:'})));
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0)}));

