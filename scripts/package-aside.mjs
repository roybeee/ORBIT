import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {zipSync,strToU8} from 'fflate';
const files={};
for(const name of ['bridge.mjs','START-WINDOWS.cmd','SETUP-ACCOUNT.cmd','README.md']){
  const source=readFileSync(new URL('./aside/'+name,import.meta.url),'utf8');
  files['orbit-aside/'+name]=strToU8(name.endsWith('.cmd')?source.replace(/\r?\n/g,'\r\n'):source);
}
const target=new URL('../public/downloads/',import.meta.url);mkdirSync(target,{recursive:true});writeFileSync(new URL('orbit-aside-connector.zip',target),zipSync(files,{level:6,mtime:new Date('2026-09-16T00:00:00Z')}));
console.log('ASIDE connector package ready (no credentials included).');
