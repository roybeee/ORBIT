// Track only the files actually handed to a destination. Retrying an older
// message must not clear a new share waiting in that conversation's composer.
export class ShareHandoffs {
 private scopes=new Map<string,Map<string,Set<string>>>();
 register(scope:string,shareId:string,fileIds:string[]){const shares=this.scopes.get(scope)??new Map<string,Set<string>>();shares.set(shareId,new Set(fileIds));this.scopes.set(scope,shares)}
 transfer(from:string,to:string){for(const [id,files] of this.scopes.get(from)??[])this.register(to,id,[...files]);this.scopes.delete(from)}
 async complete(scope:string,committedIds:string[],remove:(id:string)=>Promise<void>){const committed=new Set(committedIds),shares=this.scopes.get(scope);for(const [id,files] of shares??[]){if(!files.size||![...files].every(file=>committed.has(file)))continue;try{await remove(id);if(shares?.get(id)===files)shares.delete(id)}catch{/* A failed cleanup leaves a recoverable received item. */}}}
}
