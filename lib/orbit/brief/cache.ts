// Cross-run analysis reuse: content-addressed rows per owner in orbit_analysis_cache.
// A key is SHA-256(version, stage, exact stored input bytes); callers re-validate every hit.
import type {Database,Statement} from '../../../db/repository.ts';

export const CACHE_FORMAT='orbit-analysis-cache/v1';
export const CACHE_TTL_DAYS=45;
export const LOOKUP_PAGE=200;
const BATCH_STATEMENTS=40;
type Stage='source'|'merge';

export async function sha256(text:string):Promise<string>{
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
export const analysisVersion=async(instructions:string)=>(await sha256(CACHE_FORMAT+'\n'+instructions)).slice(0,16);
export const cacheKey=(version:string,stage:Stage,content:string)=>sha256(version+'\n'+stage+'\n'+content);

const pages=(keys:string[])=>Array.from({length:Math.ceil(keys.length/LOOKUP_PAGE)},(_,i)=>JSON.stringify(keys.slice(i*LOOKUP_PAGE,(i+1)*LOOKUP_PAGE)));
async function runPaged(db:Database,keys:string[],statement:(page:string)=>Statement){
 const statements=pages(keys).map(statement),results:Awaited<ReturnType<Database['batch']>>=[];
 for(let start=0;start<statements.length;start+=BATCH_STATEMENTS)results.push(...await db.batch(statements.slice(start,start+BATCH_STATEMENTS)));
 return results;
}

export async function lookupAnalyses(db:Database,owner:string,keys:string[]):Promise<Map<string,string>>{
 const results=await runPaged(db,keys,page=>db.prepare('SELECT cache_key,content FROM orbit_analysis_cache WHERE owner_id=? AND cache_key IN (SELECT value FROM json_each(?))').bind(owner,page));
 const rows=results.flatMap(r=>(r.results??[]) as {cache_key:string;content:string}[]);
 return new Map(rows.map(r=>[r.cache_key,r.content]));
}
export async function touchAnalyses(db:Database,owner:string,keys:string[],now:string):Promise<void>{
 await runPaged(db,keys,page=>db.prepare('UPDATE orbit_analysis_cache SET last_used_at=? WHERE owner_id=? AND cache_key IN (SELECT value FROM json_each(?))').bind(now,owner,page));
}
export function cacheStatement(db:Database,owner:string,row:{key:string;version:string;stage:Stage;unit:string;content:string},now:string):Statement{
 return db.prepare('INSERT OR REPLACE INTO orbit_analysis_cache(owner_id,cache_key,version,stage,unit,content,created_at,last_used_at) VALUES(?,?,?,?,?,?,?,?)').bind(owner,row.key,row.version,row.stage,row.unit,row.content,now,now);
}
export async function dropAnalyses(db:Database,owner:string,keys:string[]):Promise<void>{
 await runPaged(db,keys,page=>db.prepare('DELETE FROM orbit_analysis_cache WHERE owner_id=? AND cache_key IN (SELECT value FROM json_each(?))').bind(owner,page));
}
export async function pruneAnalyses(db:Database,owner:string,version:string,before:string):Promise<void>{
 await db.prepare('DELETE FROM orbit_analysis_cache WHERE owner_id=? AND (version<>? OR last_used_at<?)').bind(owner,version,before).run();
}
