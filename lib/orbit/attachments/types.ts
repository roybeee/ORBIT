export interface StoredAttachment {id:string;name:string;mime:string;size:number;prepared:boolean;state:'pending'|'uploading'|'ready';preview:boolean;contextLabel:string;targetType:'turn'|'event'|null;targetId:string|null;createdAt:string}
export const MAX_FILES=8;
export const MAX_FILE_BYTES=100*1024*1024;
export const MAX_DOCUMENT_BYTES=25*1024*1024;
export const MAX_PREVIEW_BYTES=600000;
export const FILE_ACCEPT='image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,video/mp4,video/webm,video/quicktime,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.mp4,.mov,.webm,.mkv,.pdf,.txt,.md,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx';
export const fileUrl=(id:string,preview=false)=>'/api/attachments/'+(preview?'preview':'content')+'?id='+encodeURIComponent(id);
export function fileSize(size:number){return size<1024*1024?Math.max(1,Math.round(size/1024))+' KB':(size/1024/1024).toFixed(1)+' MB'}
export const fileTypes:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',heic:'image/heic',heif:'image/heif',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',mkv:'video/x-matroska',pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
