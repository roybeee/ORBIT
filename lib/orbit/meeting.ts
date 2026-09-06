import type {Note} from './model.ts';
export interface MeetingCandidate {line:number;quote:string;title:string}
// Deliberately recognizes explicit action markers only. No inferred promises or dates.
export function meetingCandidates(note:Note):MeetingCandidate[]{
 if(note.kind!=='meeting')return [];
 const candidates:MeetingCandidate[]=[];
 const lines=note.body.split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  const raw=lines[i].trim();
  const match=raw.match(/^(?:[-*]\s+\[\s\]\s+|(?:[-*]\s+)?(?:할\s*일|액션|TODO|ACTION)\s*[:：]\s*)(.+)$/i);
  if(match&&raw.length<=2000)candidates.push({line:i+1,quote:raw,title:match[1].trim().slice(0,160)});
 }
 return candidates;
}
