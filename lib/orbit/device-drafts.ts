// Device-local unsent inputs only. Authoritative records remain on the server.
// No account data is exposed by the offline fallback; every key includes a verified owner.
const PREFIX='orbit-draft:v1:';
export function draftKey(owner:string,kind:string,target='') {
 if(!owner)throw new Error('로그인한 계정을 확인해 주세요.');
 return PREFIX+encodeURIComponent(owner)+':'+kind+':'+encodeURIComponent(target);
}
export function readDraft<T>(owner:string,kind:string,target=''):T|null {
 if(!owner||typeof window==='undefined')return null;
 try{const raw=localStorage.getItem(draftKey(owner,kind,target));return raw?JSON.parse(raw).payload as T:null}catch{return null}
}
export function saveDraft(owner:string,kind:string,target:string,payload:unknown) {
 if(!owner)return;
 // setItem is synchronous: callers show success only after it returns.
 localStorage.setItem(draftKey(owner,kind,target),JSON.stringify({updatedAt:new Date().toISOString(),payload}));
}
export function clearDraft(owner:string,kind:string,target='') {
 try{if(owner)localStorage.removeItem(draftKey(owner,kind,target));}catch{} // Server ACK remains authoritative even if local cleanup fails.
}
