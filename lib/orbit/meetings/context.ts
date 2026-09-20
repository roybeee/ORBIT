import {readNote,searchNotes,type Database} from '../../../db/repository.ts';
import {noteSource,sourceRecord,type AgentSource} from '../agent/evidence.ts';
import {AgentError} from '../agent/errors.ts';
const stop=new Set('회의 회의록 기록 기반 바탕 답변 알려줘 해줘 대한 관련 나의 이번 지난 오늘 내일 어떻게 무엇 정리 피드백 최근 진행 내용 주세요 바탕으로 바탕으로만'.split(' '));
export function queryTerms(query:string){return [...new Set(query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[])].map(w=>w.replace(/(에서는|으로는|에서|으로|에게|이랑|부터|까지|은|는|을|를|의|에|과|와)$/,'')).filter(w=>w.length>=2&&!stop.has(w)).slice(0,6)}
export async function recordContext(db:Database,owner:string,query:string,projectId?:string|null){
 const terms=queryTerms(query),found=new Map<string,any>();
 for(const term of terms){const r=await searchNotes(db,owner,{query:term,kind:'all',offset:0});for(const n of r.items)found.set(n.id,n);}
 if(projectId||!terms.length){const r=await searchNotes(db,owner,{query:'',kind:'all',offset:0,...(projectId?{projectId}:{})});for(const n of r.items)found.set(n.id,n);}
 const ranked=[...found.values()].map(n=>({note:n,score:terms.reduce((s,t)=>s+([n.title,n.summary,n.searchExcerpt,...n.tags].join(' ').toLowerCase().includes(t)?1:0),0)+(n.projectId===projectId?2:0)})).sort((a,b)=>b.score-a.score||b.note.updated.localeCompare(a.note.updated)).slice(0,6);
 const sources:AgentSource[]=[],records=[];
 for(const {note:meta} of ranked){const n=await readNote(db,owner,meta.id,meta.revision??1),lower=n.body.toLowerCase(),at=terms.map(t=>lower.indexOf(t)).filter(i=>i>=0).sort((a,b)=>a-b)[0]??0,excerpt=n.body.slice(Math.max(0,at-250),Math.max(0,at-250)+3500);
  const source={...noteSource(n),excerpt:excerpt.slice(0,1200),scope:'excerpt' as const,date:n.source?.date??n.updated,label:n.source?.provider==='plaud'?'Plaud 회의 원문 발췌':'기록 원문 발췌'};sources.push(source);records.push({evidenceId:source.id,title:n.title,meetingDate:n.source?.date,projectId:n.projectId,revision:n.revision,excerpt,partial:excerpt.length<n.body.length});
 }
 const feedbackRows=await db.prepare('SELECT f.* FROM orbit_answer_feedback f JOIN orbit_agent_turns t ON t.owner_id=f.owner_id AND t.id=f.turn_id WHERE f.owner_id=? ORDER BY f.updated_at DESC LIMIT 100').bind(owner).all<any>();
 const feedback=feedbackRows.results.filter(f=>f.project_id===projectId&&!!projectId||terms.some(t=>(f.question+' '+f.text).toLowerCase().includes(t))).slice(0,6).map(f=>{
  const source=sourceRecord('feedback',f.turn_id,'사용자가 남긴 '+(f.kind==='correction'?'답변 수정':f.kind==='outcome'?'실행 결과':'답변 평가'),f.text,{date:f.updated_at,label:'사용자 피드백 · '+f.updated_at.slice(0,10)});sources.push(source);return {evidenceId:source.id,kind:f.kind,question:f.question,text:f.text,updatedAt:f.updated_at,notice:'사용자가 보고한 수정·결과입니다. 실제 외부 검증이나 영구적 성향으로 단정하지 마세요.'};
 });
 return {records,feedback,sources,coverage:'질문 키워드와 프로젝트로 찾은 최대 6개 기록 발췌. 전체 보관함 분석이나 의미 검색은 아닙니다.'};
}
export async function saveFeedback(db:Database,owner:string,turnId:string,kind:string,text:string){
 const turn=await db.prepare("SELECT t.input,t.response_json,c.project_id FROM orbit_agent_turns t LEFT JOIN orbit_conversations c ON c.owner_id=t.owner_id AND c.id=t.conversation_id WHERE t.owner_id=? AND t.id=? AND t.status='completed'").bind(owner,turnId).first<{input:string;response_json:string;project_id:string|null}>();
 if(!turn)throw new AgentError('완료된 내 답변에서만 피드백을 남길 수 있습니다.','NOT_FOUND',404);
 await db.prepare('INSERT INTO orbit_answer_feedback(owner_id,turn_id,kind,text,question,project_id,sources_json,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,turn_id) DO UPDATE SET kind=excluded.kind,text=excluded.text,sources_json=excluded.sources_json,updated_at=excluded.updated_at').bind(owner,turnId,kind,text,turn.input.slice(0,2000),turn.project_id,JSON.stringify(JSON.parse(turn.response_json).sources??[]),new Date().toISOString()).run();
}
