import {deploymentHealth} from '../deployment-health.ts';
export type ReleaseEnv={ORBIT_RELEASE_CONTRACT_TOKEN?:string;ORBIT_RELEASE_CONTRACT_OWNER?:string;ORBIT_SITES_BEARER?:string};
export async function machineOwner(request:Request,env:ReleaseEnv):Promise<string|null>{
 const result=await deploymentHealth(request,env.ORBIT_RELEASE_CONTRACT_TOKEN,'release-probe');
 return result.ok&&env.ORBIT_RELEASE_CONTRACT_OWNER?env.ORBIT_RELEASE_CONTRACT_OWNER:null;
}
// A scoped machine probe executes the same read function, returns no user data,
// and is never accepted by a write route or normal data request.
export async function releaseProbe(request:Request,env:ReleaseEnv,tree:string,read:(owner:string)=>Promise<unknown>):Promise<Response|null>{
 if(new URL(request.url).searchParams.get('release_probe')!=='1')return null;
 const headers={'Cache-Control':'private, no-store','Vary':'Authorization, OAI-Sites-Authorization'};
 const principal=await machineOwner(request,env);
 if(!principal||request.method!=='GET')return Response.json({error:'Unauthorized'},{status:401,headers});
 try{await read(principal);return Response.json({status:'ok',probe:new URL(request.url).pathname,tree},{headers});}
 catch{return Response.json({error:'Read probe failed'},{status:503,headers});}
}
