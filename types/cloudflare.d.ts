// Structural binding contract for exactly the D1 methods used by this app.
// This declares the runtime module; production supplies the actual DB binding.
declare module 'cloudflare:workers' {
  export const env: import('../lib/orbit/agent/integrations').Runtime & { DB?: import('../db/storage').Database };
}

declare module '*?url' {const url:string;export default url;}
