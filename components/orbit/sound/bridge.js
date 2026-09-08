// Runs INSIDE the supplied bundle's closure. Only the shell can access Orbit APIs.
// The sandbox has an opaque origin and no access to the parent's DOM/cookies.
const orbitSoundProtocol='orbit.sound.v1';
const orbitHostOrigin=new URL(location.href).origin;
const orbitPending=new Map();
let orbitSequence=0;
const orbitSend=message=>parent.postMessage({protocol:orbitSoundProtocol,...message},orbitHostOrigin);
const orbitRequest=(method,payload)=>new Promise((resolve,reject)=>{
  const id=String(++orbitSequence);
  const timer=setTimeout(()=>{orbitPending.delete(id);reject(Error('Orbit 연결이 지연되고 있습니다. 다시 연결해 주세요.'))},45000);
  orbitPending.set(id,{resolve,reject,timer});orbitSend({type:'request',id,method,payload});
});
window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==orbitHostOrigin||event.data?.protocol!==orbitSoundProtocol)return;
  const message=event.data;
  if(message.type==='response'){
    const pending=orbitPending.get(message.id);if(!pending)return;
    clearTimeout(pending.timer);orbitPending.delete(message.id);
    message.error?pending.reject(Error(message.error)):pending.resolve(message.state);
  }else if(message.type==='command'){
    const bridge=window.__orbitSoundBridge;if(!bridge)return;
    if(message.command==='toggle')bridge.toggle();
    if(message.command==='pause')bridge.pause();
    if(message.command==='volume'&&Number.isFinite(message.value))bridge.volume(message.value);
    if(message.command==='prefill')bridge.prefill(message.value);
    if(message.command==='state')bridge.publish();
  }
});
// Replace the portable local-storage adapter before the app renders.
ic=()=>sc;
TL=()=>'';
Kg=async()=>{sc=Hg.parse(await orbitRequest('read'));return structuredClone(sc)};
vo=async action=>{
  try{sc=Hg.parse(await orbitRequest('mutate',action))}
  catch(error){
    // A committed start may lose its response. Reconcile the original UUID;
    // never create a second session or claim another device's session as ours.
    if(action.action==='start'){
      try{await Kg();if(sc.active?.id===action.id)return {ok:true}}catch{}
    }
    throw error;
  }
  return {ok:true};
};
OL=async text=>{
  if(text.length>1800000)throw Error('백업 파일이 너무 큽니다.');
  let parsed;try{parsed=JSON.parse(text)}catch{throw Error('올바른 JSON 백업 파일을 선택해 주세요.')}
  const input=parsed.format==='orbit-sound-backup'&&parsed.version===1?parsed.state:
    Array.isArray(parsed.sessions)&&Array.isArray(parsed.routines)&&Array.isArray(parsed.favorites)?{...AL(),...parsed}:null;
  const state=Hg.safeParse(input);
  if(!state.success)throw Error('ORBIT Sound에서 내보낸 백업 파일인지 확인해 주세요.');
  await vo({action:'import',state:state.data});
};
