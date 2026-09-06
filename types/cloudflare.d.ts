// Structural binding contract for exactly the D1 methods used by this app.
// This declares the runtime module; production supplies the actual DB binding.
declare module 'cloudflare:workers' {
  export const env: { BUCKET?: import('../lib/orbit/attachments/storage').Bucket; DB?: import('../db/storage').Database; ORBIT_ENCRYPTION_KEY?:string; PLAUD_OAUTH_CLIENT_ID?:string };
}

declare module '*?url' {const url:string;export default url;}
