export async function resolve(specifier,context,next){
 if(specifier==='cloudflare:workers')return {url:'data:text/javascript,export const env = globalThis.__orbitCloudflareEnv;',shortCircuit:true};
 return next(specifier,context);
}
