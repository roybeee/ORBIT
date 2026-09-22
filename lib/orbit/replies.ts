import type {WorkspaceData,DelegationRecord,RecordSource} from './model.ts';
type MailMessage={payload?:{headers?:{name:string;value:string}[]};internalDate?:unknown;labelIds?:unknown;threadId?:unknown};
export function mailMetadata(m:MailMessage):RecordSource['mail']{
 const from=String(m.payload?.headers?.find(h=>String(h.name).toLowerCase()==='from')?.value??'');
 const sender=(from.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1]??from.trim()).toLowerCase();
 const at=Number(m.internalDate);
 if(!Array.isArray(m.labelIds)||(from.match(/@/g)??[]).length!==1||!Number.isFinite(new Date(at).valueOf())||!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender)||sender.length>254||typeof m.threadId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(m.threadId)||!Number.isFinite(at)||at<=0)return;
 return {threadId:m.threadId,senderEmail:sender,receivedAt:new Date(at).toISOString(),incoming:!m.labelIds?.some((x:string)=>x==='SENT'||x==='DRAFT')};
}
export function delegationReplies(data:WorkspaceData,record:DelegationRecord){
 const match=(r:DelegationRecord,mail:NonNullable<RecordSource['mail']>)=>!!r.replyWatch&&mail.incoming&&r.replyWatch.senderEmail.toLowerCase()===mail.senderEmail&&r.replyWatch.threadId===mail.threadId&&mail.receivedAt>=r.createdAt;
 return data.notes.filter(n=>n.source?.provider==='gmail'&&n.source.mail&&match(record,n.source.mail)).map(note=>({note,ambiguous:(data.delegations??[]).filter(d=>match(d,note.source!.mail!)).length>1})).sort((a,b)=>b.note.source!.mail!.receivedAt.localeCompare(a.note.source!.mail!.receivedAt));
}
