import {spawn} from 'node:child_process';

// Node provides a portable deadline on macOS and Linux without GNU timeout.
const duration=(value,fallback)=>{
  if(!value)return fallback;
  const match=/^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value);
  if(!match)throw Error('Invalid build timeout: '+value);
  return Number(match[1])*({ms:1,s:1000,m:60000}[match[2]??'s']);
};
const child=spawn(process.argv[2],['build'],{stdio:'inherit',detached:process.platform!=='win32'});
let timedOut=false,killTimer;
const stop=signal=>{try{if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
const deadline=setTimeout(()=>{timedOut=true;stop('SIGTERM');killTimer=setTimeout(()=>stop('SIGKILL'),duration(process.env.SITES_BUILD_KILL_AFTER,10000));},duration(process.env.SITES_BUILD_TIMEOUT,180000));
child.on('error',error=>{clearTimeout(deadline);console.error(error.message);process.exitCode=1;});
child.on('exit',(code,signal)=>{clearTimeout(deadline);clearTimeout(killTimer);if(timedOut)console.error('Build exceeded its time limit.');process.exitCode=timedOut?124:code??(signal?1:0);});
