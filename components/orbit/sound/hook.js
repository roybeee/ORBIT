// Injected into Sy AFTER its controls are defined; use the app's session lifecycle.
(0,Z.useEffect)(()=>{
  const publish=()=>orbitSend({type:'state',state:{ready:!Q,activated:!!Fe.current?.ctx,busy:C,playing:A,active:!!D,title:Me?'무음 타이머':r.title,mode:r.mode,duration:l*60,elapsed:Math.floor(b),volume:f,needsFeedback:Zt}});
  window.__orbitSoundBridge={
    publish,toggle:eu,pause:$i,volume:value=>p(Math.max(0,Math.min(100,value))),
    prefill:value=>{if(!D&&value&&typeof value.goal==='string'){u(value.goal.slice(0,240));o('focus');n(go[0]);c({...go[0].mix});s(Math.max(1,Math.min(180,Math.round(Number(value.minutes)||25))));sa(false);t('home');}},
  };
  publish();
});
