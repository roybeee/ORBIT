// Native streaming SHA-256 on Workers; Node fallback is used by local tests.
export async function streamHasher(){
 const DigestStream=(crypto as any).DigestStream;
 if(DigestStream){const stream=new DigestStream('SHA-256'),writer=stream.getWriter();return {update:(bytes:Uint8Array)=>writer.write(bytes),end:async()=>{await writer.close();return [...new Uint8Array(await stream.digest)].map(b=>b.toString(16).padStart(2,'0')).join('')}};}
 const {createHash}=await import('node:crypto'),hash=createHash('sha256');return {update:async(bytes:Uint8Array)=>{hash.update(bytes)},end:async()=>hash.digest('hex')};
}
