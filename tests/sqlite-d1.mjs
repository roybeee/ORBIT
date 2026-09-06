import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
export function createDatabase(beforeMigration=()=>{}){
 const sqlite=new DatabaseSync(':memory:');
 for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()){beforeMigration(file,sqlite);sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));}
 class Statement{constructor(sql,params=[]){this.sql=sql;this.params=params}bind(...params){return new Statement(this.sql,params)}async first(){return sqlite.prepare(this.sql).get(...this.params)??null}async all(){return {results:sqlite.prepare(this.sql).all(...this.params)}}async run(){const result=sqlite.prepare(this.sql).run(...this.params);return {success:true,meta:{changes:Number(result.changes)}}}}
 return {prepare(sql){return new Statement(sql)},async batch(statements){sqlite.exec('BEGIN IMMEDIATE');try{const out=[];for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out}catch(error){sqlite.exec('ROLLBACK');throw error}},close(){sqlite.close()}};
}
