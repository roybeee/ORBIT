import type {KakaoCapture} from './kakao/types.ts';

export const KAKAO_LOCAL_ENDPOINT='http://127.0.0.1:43128';
export interface KakaoLocalHealth {
 protocol:1;connected:boolean;mode:'manual_only'|'verified_navigation';message:string;
 permissions?:{accessibility:boolean};active:boolean;
}
export interface KakaoScanResult {capture:KakaoCapture;skipped?:{reason:string}[]}
const LOCAL_PATHS=['/health','/scan','/stop'];
const FILE_LIMIT=2000000;

/** Talk only to the fixed local collector; the key never goes to ORBIT. */
export async function localKakaoRequest<T>(token:string,path:string,input?:unknown,signal?:AbortSignal):Promise<T>{
 if(!/^[A-Za-z0-9_-]{32,128}$/.test(token))throw new Error('Mac 연결 키를 확인해 주세요.');
 if(!LOCAL_PATHS.includes(path))throw new Error('허용되지 않은 카카오톡 검토 동작입니다.');
 if(signal?.aborted)throw new Error('카카오톡 검토를 중지했습니다.');
 const controller=new AbortController(),cancel=()=>controller.abort();
 const timer=setTimeout(cancel,path==='/scan'?60000:8000);
 signal?.addEventListener('abort',cancel,{once:true});
 try{
  const response=await fetch(KAKAO_LOCAL_ENDPOINT+path,{
   method:input===undefined?'GET':'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
   ...(input===undefined?{}:{body:JSON.stringify(input)}),
  });
  const text=await response.text();
  if(text.length>FILE_LIMIT)throw new Error('수집 결과가 너무 큽니다. 범위를 나눠 주세요.');
  let result;try{result=JSON.parse(text)}catch{throw new Error('Mac 연결 프로그램의 응답을 확인하지 못했습니다.')}
  if(!response.ok)throw new Error(typeof result.error==='string'?result.error.slice(0,500):'Mac 연결 프로그램에서 검토를 완료하지 못했습니다.');
  return result as T;
 }catch(error){
  if(signal?.aborted)throw new Error('카카오톡 검토를 중지했습니다.');
  if(controller.signal.aborted)throw new Error('Mac 응답 시간이 초과됐습니다. 중지 상태를 확인한 뒤 다시 시도하세요.');
  if(error instanceof TypeError)throw new Error('Mac 연결 프로그램과 브라우저의 로컬 네트워크 권한을 확인해 주세요.');
  throw error;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel)}
}

/** Only accepts a structured capture export; the server validates every record. */
export async function readKakaoCaptureFile(file:Pick<File,'size'|'text'>):Promise<KakaoCapture>{
 if(file.size>FILE_LIMIT)throw new Error('수집 파일 크기는 2MB 이하여야 합니다.');
 let result;try{result=JSON.parse(await file.text())}catch{throw new Error('JSON 수집 파일을 선택해 주세요.')}
 const capture=result?.capture??result;
 if(capture?.source!=='kakao-read-review'||!Array.isArray(capture.rooms))throw new Error('카카오톡 검토 수집 파일이 아닙니다. 전체 대화 내보내기 파일은 사용할 수 없습니다.');
 return capture as KakaoCapture;
}
