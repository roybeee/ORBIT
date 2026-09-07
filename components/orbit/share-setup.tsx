'use client';
import {useState} from 'react';
import {LoaderCircle,RefreshCw} from 'lucide-react';
import {usePwa} from './pwa-provider';
import {checkShareManifest} from '@/lib/orbit/share-setup';
const BUILD='2026-09-07.1';
function receiver(worker:ServiceWorker|null){return new Promise<string>((resolve)=>{if(!worker){resolve('');return}const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();resolve('')},3500);channel.port1.onmessage=e=>{clearTimeout(timer);channel.port1.close();resolve(e.data?.type==='ORBIT_SHARE_STATUS'&&e.data.files?e.data.build:'')};worker.postMessage({type:'ORBIT_SHARE_STATUS'},[channel.port2])})}
export function ShareSetup(){
 const {platform,browser,standalone}=usePwa(),[checking,setChecking]=useState(false),[result,setResult]=useState('');
 async function check(){setChecking(true);setResult('');try{
  const response=await fetch('/manifest.webmanifest',{credentials:'include',cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok||response.redirected||!(response.headers.get('content-type')??'').includes('json'))throw new Error('설치 정보를 읽지 못했습니다. Chrome에서 같은 계정으로 로그인한 뒤 다시 점검해 주세요.');
  if(!checkShareManifest(await response.json()))throw new Error('이 화면이 최신 공유 설정을 받지 못했습니다. Chrome에서 Orbit을 다시 열어 주세요.');
  if(!('serviceWorker' in navigator))throw new Error('이 브라우저는 공유 받기를 지원하지 않습니다. Android의 Chrome에서 열어 주세요.');
  const registration=await navigator.serviceWorker.getRegistration('/');
  if(!registration)throw new Error('공유 기능이 시작되지 않았습니다. Chrome에서 Orbit을 새로고침한 뒤 다시 점검해 주세요.');
  await Promise.race([registration.update(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('업데이트 확인이 지연됩니다. 인터넷 연결을 확인해 주세요.')),10000))]);
  const build=await receiver(navigator.serviceWorker.controller);
  setResult(build===BUILD?'현재 화면의 공유 수신 기능은 최신입니다. Android 공유 목록 등록 여부는 별도로 확인해야 합니다. 아래 설치 복구 절차를 진행해 주세요.':'공유 기능 업데이트를 요청했습니다. Orbit 창을 모두 닫고 다시 열어 점검해 주세요. 이 버튼은 Android 앱 패키지 설치를 대신하지 않습니다.');
 }catch(e){setResult(e instanceof Error?e.message:'점검을 마치지 못했습니다. 다시 시도해 주세요.')}finally{setChecking(false)}}
 return <section className="install-card share-setup" id="share-setup" aria-labelledby="share-setup-heading">
  <h2 id="share-setup-heading">공유 목록에 Orbit이 없나요?</h2>
  <p>홈 화면의 아이콘과 공유 앱 등록은 별개입니다. 앱을 껐다 켜도 Android의 설치 정보가 갱신되지 않을 수 있습니다.</p>
  {platform==='android'&&browser!=='chrome'&&<p className="agent-error">지금은 Chrome으로 확인되지 않습니다. 이 주소를 Chrome 앱에서 직접 열어 주세요.</p>}
  <button type="button" className="secondary-button" disabled={checking} onClick={()=>void check()}>{checking?<LoaderCircle size={16} className="animate-spin"/>:<RefreshCw size={16}/>} {checking?'공유 설정 확인 중…':'공유 설정 점검'}</button>
  {result&&<p className="install-feedback" role="status">{result}</p>}
  <p className="form-hint">{standalone?'독립된 앱 창으로 열려 있습니다. ':''}웹 화면에서는 Android의 설치 완료 여부를 직접 읽을 수 없습니다.</p>
  <ol className="share-repair-steps">
   <li>Chrome 주소창에 <code>chrome://webapks</code>를 입력하고 Orbit의 <strong>Update Status</strong>를 확인하세요. <strong>Pending</strong>은 완료가 아닌 대기 상태입니다.</li>
   <li>대기가 계속되면 충전기와 Wi-Fi를 연결하고, <strong>휴대폰 설정 → 애플리케이션 → Orbit → 강제 중지</strong> 후 앱을 닫아 두세요. 완료 상태는 <strong>Successful</strong>입니다.</li>
   <li>계속 갱신되지 않으면 작성 중인 내용과 첨부를 먼저 저장한 후 Orbit 앱만 제거하고, Chrome에서 이 사이트를 열어 <strong>홈 화면에 추가 → 설치</strong>로 다시 설치하세요. Chrome의 사이트 데이터 삭제는 선택하지 마세요.</li>
  </ol>
  <p>설치 후 갤러리에서 JPG 또는 PNG 사진 한 장을 골라 공유 목록을 확인하세요.</p>
  <a className="text-button" href="/?install=android&browser=chrome#agent">Chrome에서 Orbit 열고 설치</a>
  <a className="text-button" href="https://web.dev/articles/manifest-updates#updates_on_chrome_for_android" target="_blank" rel="noreferrer">Google의 Android 앱 업데이트 안내</a>
 </section>;
}
