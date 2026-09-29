import type {Database} from '../../../db/repository.ts';
import contract from './contract.json' with {type:'json'};
export {contract};
export type Check={id:string;status:'passed'|'failed'|'blocked';reason:string};
export type SchemaInventory={tables:Record<string,string[]>;migrationNames:string[];migrationHashes:string[];ledgerReadable:boolean};
export async function schemaInventory(db:Database):Promise<SchemaInventory>{
 // One metadata query keeps a >50-table contract below D1 subrequest limits.
 // Provider-owned tables are not part of the application contract.
 const {results}=await db.prepare("SELECT m.name AS table_name,p.name AS column_name FROM sqlite_master AS m JOIN pragma_table_info(m.name) AS p WHERE m.type='table' AND m.name NOT GLOB '_cf_*' AND m.name NOT GLOB 'sqlite_*' ORDER BY m.name,p.cid").all<{table_name:string;column_name:string}>();
 const tables:Record<string,string[]>={};
 for(const row of results)(tables[row.table_name]??=[]).push(row.column_name);
 let migrationNames:string[]=[],migrationHashes:string[]=[],ledgerReadable=false;
 if(tables.d1_migrations?.includes('name')){migrationNames=(await db.prepare('SELECT name FROM d1_migrations').all<{name:string}>()).results.map(r=>r.name);ledgerReadable=true;}
 if(tables.__drizzle_migrations?.includes('hash')){migrationHashes=(await db.prepare('SELECT hash FROM __drizzle_migrations').all<{hash:string}>()).results.map(r=>r.hash);ledgerReadable=true;}
 return {tables,migrationNames,migrationHashes,ledgerReadable};
}
export function schemaChecks(inventory:SchemaInventory,required=contract):Check[]{
 const checks:Check[]=[];
 for(const [table,columns] of Object.entries(required.tables)){
  const actual=inventory.tables[table];
  if(!actual){checks.push({id:'table:'+table,status:'failed',reason:`필수 테이블 없음: ${table}`});continue;}
  const missing=columns.filter(c=>!actual.includes(c));
  checks.push({id:'table:'+table,status:missing.length?'failed':'passed',reason:missing.length?`필수 컬럼 없음: ${table}.${missing.join(', ')}`:'필수 컬럼 확인'});
 }
 const missing=required.migrations.filter(m=>!inventory.migrationNames.includes(m.name)&&!inventory.migrationHashes.includes(m.hash));
 checks.push({id:'migrations',status:!inventory.ledgerReadable?'blocked':missing.length?'failed':'passed',reason:!inventory.ledgerReadable?'적용 기록을 읽을 수 없음: d1_migrations / __drizzle_migrations':missing.length?'미적용 마이그레이션: '+missing.map(m=>m.name).join(', '):'모든 마이그레이션 적용 기록 확인'});
 return checks;
}
export type HermesEvidence={version:string;hooks:string[];checkedAt:string};
export function hermesCheck(e:HermesEvidence|null,now=Date.now()):Check{
 const base={id:'hermes'};
 if(!e||!Number.isFinite(Date.parse(e.checkedAt))||Date.parse(e.checkedAt)>now||now-Date.parse(e.checkedAt)>86400000)return {...base,status:'blocked',reason:'Hermes 실행 증거 없음 또는 24시간 경과'};
 const parse=(v:string)=>/^\d+\.\d+\.\d+$/.test(v)?v.split('.').map(Number):null;
 const actual=parse(e.version),min=parse(contract.hermes.minimumVersion);
 const compatible=actual&&min&&actual.reduce((cmp,n,i)=>cmp||Math.sign(n-min[i]),0)>=0;
 const missing=contract.hermes.requiredHooks.filter(h=>!e.hooks.includes(h));
 return {...base,status:compatible&&!missing.length?'passed':'failed',reason:!compatible?`Hermes ${contract.hermes.minimumVersion} 이상 필요 (관측: ${e.version})`:missing.length?'Hermes 훅 없음: '+missing.join(', '):`Hermes ${e.version} · 필수 훅 확인`};
}
export function readiness(checks:Check[]):'verified'|'failed'|'pending'{return checks.some(c=>c.status==='failed')?'failed':checks.every(c=>c.status==='passed')?'verified':'pending';}
