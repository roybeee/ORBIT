import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
const last=journal.entries.at(-1);
const snapshot=JSON.parse(readFileSync(`drizzle/meta/${String(last.idx).padStart(4,'0')}_snapshot.json`,'utf8'));
const contract={version:1,lastMigration:last.tag,migrations:journal.entries.map(e=>({name:e.tag+'.sql',hash:createHash('sha256').update(readFileSync('drizzle/'+e.tag+'.sql')).digest('hex')})),tables:Object.fromEntries(Object.values(snapshot.tables).map(t=>[t.name,Object.keys(t.columns)])),probes:['/api/version','/api/slack-requests','/api/gotem/metrics'],hermes:{minimumVersion:'2.2.0',requiredHooks:['pre_gateway_dispatch','api_request_error','post_api_request','post_llm_call']}};
const target='lib/orbit/release/contract.json',content=JSON.stringify(contract,null,2)+'\n';
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==content)throw new Error('Release contract is stale; run node scripts/release-contract-manifest.mjs');}else writeFileSync(target,content);
