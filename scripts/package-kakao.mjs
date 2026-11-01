import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {zipSync,strToU8} from 'fflate';

export const SOURCE_FILES=Object.freeze(['README.md','START-MAC.command','adapter.mjs','bridge.mjs','build.sh','native.swift','policy.mjs','redaction.mjs','start.mjs']);

/** Reproducible source-only download. Runtime credentials, binaries and transcripts cannot enter it. */
export function kakaoPackage(){
 const files=Object.fromEntries(SOURCE_FILES.map(name=>{
  const source=readFileSync(new URL('../integrations/orbit-kakao-mac/'+name,import.meta.url),'utf8');
  const executable=name.endsWith('.command')||name.endsWith('.sh');
  return ['orbit-kakao-mac/'+name,[strToU8(source),{os:3,attrs:(executable?0o100755:0o100644)<<16}]];
 }));
 // ZIP stores local calendar fields. A local constructor gives the same fields in every TZ.
 return zipSync(files,{level:6,mtime:new Date(2026,10,1,0,0,0)});
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const target=new URL('../public/downloads/',import.meta.url);
 mkdirSync(target,{recursive:true});writeFileSync(new URL('orbit-kakao-mac.zip',target),kakaoPackage());
 process.stdout.write('카카오톡 Mac 검토 소스 패키지 생성 완료\n');
}
