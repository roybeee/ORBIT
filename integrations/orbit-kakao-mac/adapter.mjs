import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {fail} from './policy.mjs';

const HELPER=fileURLToPath(new URL('./.build/orbit-kakao-native',import.meta.url));
const OPS=new Set(['health','inspect-current','capture-current']);

/** Fixed executable and argument set. Request data is never an executable or command. */
export function nativeCall(operation,signal){
 if(!OPS.has(operation))return Promise.reject(fail('허용되지 않은 수집 작업입니다.','OPERATION'));
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(fail('검토가 중지되었습니다.','STOPPED',409));
  const child=spawn(HELPER,[operation],{shell:false,stdio:['ignore','pipe','ignore'],signal});
  const chunks=[];let size=0,overflow=false;
  const timer=setTimeout(()=>child.kill('SIGTERM'),12000);
  child.stdout.on('data',chunk=>{size+=chunk.length;if(size>120000){overflow=true;child.kill('SIGTERM')}else chunks.push(chunk)});
  child.once('error',error=>{clearTimeout(timer);reject(fail(error.code==='ENOENT'?'Mac 연결 프로그램을 먼저 빌드해 주세요.':'네이티브 검토가 중지되었거나 실행되지 않았습니다.',signal?.aborted?'STOPPED':'NATIVE_UNAVAILABLE',409))});
  child.once('close',code=>{
   clearTimeout(timer);
   if(overflow)return reject(fail('수집 범위를 초과해 중단했습니다.','NATIVE_SIZE',413));
   if(signal?.aborted)return reject(fail('검토가 중지되었습니다.','STOPPED',409));
   let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return reject(fail('네이티브 응답을 확인하지 못했습니다.','NATIVE_FORMAT',409))}
   if(code!==0||data.error)return reject(fail(data.error??'네이티브 검토를 완료하지 못했습니다.',data.code??'NATIVE',409));
   resolve(data);
  });
 });
}

export const nativeAdapter={
 health:()=>nativeCall('health'),
 inspectCurrent:signal=>nativeCall('inspect-current',signal),
 readCurrent:signal=>nativeCall('capture-current',signal),
};
