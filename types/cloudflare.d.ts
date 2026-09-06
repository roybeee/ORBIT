// Structural binding contract for exactly the D1 methods used by this app.
// This declares the runtime module; production supplies the actual DB binding.
declare module 'cloudflare:workers' {
  export const env: { DB?: import('../db/storage').Database };
}
