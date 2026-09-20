// Injected into Sy AFTER its controls are defined; use the app's session lifecycle.
const orbitPopupOrder=(0,Z.useRef)([]);
(0,Z.useEffect)(()=>{
  const popups=[
    {id:'mixer',open:le,close:()=>te(false)},
    {id:'routine',open:la,close:()=>Jt(false)},
    {id:'feedback',open:Zt,close:()=>{if(!C)_(false)}},
    {id:'immersive',open:fe,close:()=>Ke(false)},
    {id:'guide',open:wa,close:()=>kt(false)},
  ];
  orbitPopupOrder.current=orbitPopupOrder.current.filter(id=>popups.some(p=>p.id===id&&p.open));
  for(const popup of popups)if(popup.open&&!orbitPopupOrder.current.includes(popup.id))orbitPopupOrder.current.push(popup.id);
  const popup=orbitPopupOrder.current.at(-1)??null;
  const publish=()=>orbitSend({type:'state',state:{ready:!Q,activated:!!Fe.current?.ctx,busy:C,playing:A,active:!!D,title:Me?'무음 타이머':r.title,mode:r.mode,duration:l*60,elapsed:Math.floor(b),volume:f,needsFeedback:Zt,popup}});
  window.__orbitSoundBridge={
    closePopup:expected=>{if(popup&&popup===expected)popups.find(p=>p.id===popup)?.close();},
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
