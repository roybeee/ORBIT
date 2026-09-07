'use client';

import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {detectInstallEnvironment,type InstallPlatform,type InstallBrowser} from '@/lib/orbit/installation';

interface InstallPrompt extends Event {
  prompt:()=>Promise<void>;
  userChoice:Promise<{outcome:'accepted'|'dismissed'}>;
}
type InstallResult='accepted'|'dismissed'|'unavailable'|'failed';
interface PwaState {
  ready:boolean;
  standalone:boolean;
  installed:boolean;
  canInstall:boolean;
  installing:boolean;
  platform:InstallPlatform;
  browser:InstallBrowser;
  install:()=>Promise<InstallResult>;
}
const PwaContext=createContext<PwaState|null>(null);

export function PwaProvider({children}:{children:ReactNode}){
  const [ready,setReady]=useState(false),[standalone,setStandalone]=useState(false);
  const [installed,setInstalled]=useState(false),[canInstall,setCanInstall]=useState(false),[installing,setInstalling]=useState(false);
  const [platform,setPlatform]=useState<InstallPlatform>('other'),[browser,setBrowser]=useState<InstallBrowser>('other');
  const promptRef=useRef<InstallPrompt|null>(null),promptBusy=useRef(false);

  useEffect(()=>{
    const display=window.matchMedia('(display-mode: standalone)');
    const updateDisplay=()=>setStandalone(display.matches||Boolean((navigator as Navigator&{standalone?:boolean}).standalone));
    const capture=(event:Event)=>{event.preventDefault();promptRef.current=event as InstallPrompt;setCanInstall(true)};
    const complete=()=>{promptRef.current=null;setCanInstall(false);setInstalled(true)};
    const detected=detectInstallEnvironment(navigator);
    setPlatform(detected.platform);setBrowser(detected.browser);
    updateDisplay();setReady(true);
    window.addEventListener('beforeinstallprompt',capture);
    window.addEventListener('appinstalled',complete);
    display.addEventListener('change',updateDisplay);
    // Only static installation assets are cached. Demo records and private pages are never cached.
    if(location.pathname!=='/demo'&&'serviceWorker' in navigator){
      void navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).catch(()=>{console.warn('Orbit share receiver registration failed. Open /install#share-setup to check installation.');});
    }
    const viewport=window.visualViewport;
    const updateViewport=()=>{
      const height=viewport?.height??window.innerHeight;
      document.documentElement.style.setProperty('--phone-viewport-height',`${height}px`);
      document.documentElement.style.setProperty('--phone-viewport-top',`${viewport?.offsetTop??0}px`);
      document.documentElement.dataset.keyboard=window.innerHeight-height>140?'open':'closed';
    };
    updateViewport();viewport?.addEventListener('resize',updateViewport);viewport?.addEventListener('scroll',updateViewport);window.addEventListener('resize',updateViewport);
    return()=>{
      window.removeEventListener('beforeinstallprompt',capture);window.removeEventListener('appinstalled',complete);display.removeEventListener('change',updateDisplay);
      viewport?.removeEventListener('resize',updateViewport);viewport?.removeEventListener('scroll',updateViewport);window.removeEventListener('resize',updateViewport);
    };
  },[]);

  const install=useCallback(async():Promise<InstallResult>=>{
    if(!promptRef.current||promptBusy.current)return 'unavailable';
    const prompt=promptRef.current;promptRef.current=null;setCanInstall(false);promptBusy.current=true;setInstalling(true);
    try{
      // Call in the tap handler: browser installation requires a user gesture.
      await prompt.prompt();
      return (await prompt.userChoice).outcome;
    }catch{return 'failed'}
    finally{promptBusy.current=false;setInstalling(false)}
  },[]);
  return <PwaContext.Provider value={{ready,standalone,installed,canInstall,installing,platform,browser,install}}>{children}</PwaContext.Provider>;
}
export function usePwa(){const value=useContext(PwaContext);if(!value)throw new Error('PwaProvider is required');return value}
