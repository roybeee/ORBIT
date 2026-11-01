'use client';
import type {KakaoReview} from '@/lib/orbit/kakao/types';
import {useState} from 'react';
import {agentRequest} from '../agent/connections';

export function KakaoResults({review,onInbox,onDeleted}:{review:KakaoReview;onInbox:()=>void;onDeleted:()=>Promise<void>}){
 const [confirm,setConfirm]=useState(false),[deleting,setDeleting]=useState(false),[error,setError]=useState('');
 const remove=async()=>{setDeleting(true);setError('');try{await agentRequest('/api/integrations/kakao','DELETE',{id:review.id});setConfirm(false);await onDeleted();}catch(failure){setError(failure instanceof Error?failure.message:'검토 기록을 삭제하지 못했습니다.');}finally{setDeleting(false);}};
 const citation=(id:string)=>review.sources.find(source=>source.id===id);
 return <section className="kakao-results" data-testid="kakao-review-result" aria-label="카카오톡 검토 결과">
  <h3>검토 결과</h3><p>{review.summary}</p>
  <p className="form-hint">대화방 {review.roomCount}개 · 메시지 {review.messageCount}개 · 반영 후보 {review.actionCount}개</p>
  <p>이 분석은 반영 후보를 만듭니다. 실제 승인·동기화 상태는 결재함에서 확인하세요.</p>
  <button type="button" className="primary-button" data-testid="kakao-open-inbox" onClick={onInbox}>결재함에서 검토</button>
  {review.questions.length>0&&<section><h4>확인할 내용</h4><ul>{review.questions.map((question,i)=><li key={i}>{question}</li>)}</ul></section>}
  {review.solutions.map((solution,i)=><article className="kakao-solution" key={i}>
   <h4>{solution.problem}</h4><strong>추천</strong><p>{solution.recommendation}</p>
   <ul>{solution.options.map((option,n)=><li key={n}>{option}</li>)}</ul>
   {solution.assumptions.length>0&&<p className="form-hint">가정: {solution.assumptions.join(' · ')}</p>}
   <p><strong>다음 행동</strong> {solution.nextAction}</p>
   {solution.evidence.map((item,n)=>{const source=citation(item.messageId);return <blockquote key={n}><p>{item.quote}</p>{source&&<cite>{source.room} · {source.sender} · {source.sentAt??`${source.sentOn} · 날짜만 확인`}</cite>}</blockquote>})}
  </article>)}
  <details><summary>분석에 사용한 근거 {review.sources.length}개</summary>{review.sources.map(source=><blockquote key={source.id}><p>{source.excerpt}</p><cite>{source.room} · {source.sender} · {source.sentAt??`${source.sentOn} · 날짜만 확인`}</cite></blockquote>)}</details>
  {confirm?<div className="kakao-warning"><p>이 검토의 대화 근거와 미승인 제안을 삭제합니다. 이미 승인한 할 일·일정은 유지합니다.</p><div className="chief-actions"><button type="button" className="secondary-button" disabled={deleting} onClick={()=>void remove()}>검토 기록 삭제 확인</button><button type="button" className="text-button" disabled={deleting} onClick={()=>setConfirm(false)}>취소</button></div></div>:<button type="button" className="text-button" onClick={()=>setConfirm(true)}>이 검토 기록 삭제</button>}
  {error&&<p role="alert" className="agent-error">{error}</p>}
 </section>;
}
