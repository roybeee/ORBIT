// Injected into Sy AFTER its controls are defined; use the app's session lifecycle.
(0,Z.useEffect)(()=>{
  const publish=()=>orbitSend({type:'state',state:{ready:!Q,activated:!!Fe.current?.ctx,busy:C,playing:A,active:!!D,title:Me?'무음 타이머':r.title,mode:r.mode,duration:l*60,elapsed:Math.floor(b),volume:f,needsFeedback:Zt}});
  window.__orbitSoundBridge={
    dismiss:async()=>{
      if(St.current)return;
      St.current=true;R(true);
      const elapsed=Math.floor(Fe.current?.elapsed()??b);
      try{
        await Fe.current?.stop();w(false);L(elapsed);
        if('mediaSession' in navigator){navigator.mediaSession.playbackState='none';navigator.mediaSession.metadata=null;}
        orbitSend({type:'dismissed'});
        if(D)await vo({action:'finish',id:D,elapsed,result:'ended',helpful:null,discomfort:false,config:{...ps(),purposeRating:null}});
        X(null);L(0);fs.current=null;_(false);ds(null);se(false);await uo();
      }catch(error){orbitSend({type:'dismiss-error'});}
      finally{St.current=false;R(false);}
    },
    publish,toggle:eu,pause:$i,volume:value=>p(Math.max(0,Math.min(100,value))),
    prefill:value=>{if(!D&&value&&typeof value.goal==='string'){u(value.goal.slice(0,240));o('focus');n(go[0]);c({...go[0].mix});s(Math.max(1,Math.min(180,Math.round(Number(value.minutes)||25))));sa(false);t('home');}},
  };
  publish();
});
