// The chat owns the proposal list; ask that single instance to reload after a decision.
// Rejects when that reload fails so the card says the list could not be refreshed; resolves
// after 15s so a missing listener never leaves a decision hanging.
export const agentRefresh=()=>new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,15000);window.dispatchEvent(new CustomEvent('orbit:agent-refresh',{detail:{done:(error?:unknown)=>{clearTimeout(timer);if(error)reject(error);else resolve()}}}))});
