'use client';
import {useState} from 'react';
import type {EventReview} from '../../lib/orbit/model.ts';
import type {WorkspaceAction} from '../../lib/orbit/validation.ts';
import {formatTime} from '../../lib/orbit/model.ts';

type EventReviewAction=Extract<WorkspaceAction,{type:'event.review'}>;
export const completeEventReview=(reviewId:string):EventReviewAction=>({type:'event.review',reviewId,decision:'complete'});
export const nextEventReview=(reviewId:string,title:string,due:string):EventReviewAction=>({type:'event.review',reviewId,decision:'next',title,due});
export const deferEventReview=(reviewId:string,followUpAt:string):EventReviewAction=>({type:'event.review',reviewId,decision:'defer',followUpAt});

export function EventReviewCard({review,busy,onResolve}:{review:EventReview;busy:boolean;onResolve:(action:EventReviewAction)=>void}){
 const [title,setTitle]=useState(''),[due,setDue]=useState(review.date),[followUpAt,setFollowUpAt]=useState('');
 return <article className="event-review-card" aria-label={`${review.title} 일정 검토`}>
  <span className="status-badge">검토 필요</span>
  <h3>{review.title}</h3><p>{review.date} · {formatTime(review.start)}–{formatTime(review.end)}</p>
  <strong>일이 끝났나요?</strong><p>다음 액션이 있나요?</p>
  <div className="event-review-options">
   <button disabled={busy} className="secondary-button" onClick={()=>onResolve(completeEventReview(review.id))}>완료만 표시</button>
   <form onSubmit={event=>{event.preventDefault();if(title.trim()&&due)onResolve(nextEventReview(review.id,title.trim(),due))}}>
    <label>다음 액션 제목<input required maxLength={160} value={title} onChange={event=>setTitle(event.target.value)}/></label>
    <label>마감일<input required type="date" value={due} onChange={event=>setDue(event.target.value)}/></label>
    <button disabled={busy||!title.trim()||!due} className="primary-button">완료 + 다음 액션</button>
   </form>
   <form onSubmit={event=>{event.preventDefault();if(followUpAt)onResolve(deferEventReview(review.id,new Date(followUpAt).toISOString()))}}>
    <label>다시 확인할 시각<input required type="datetime-local" value={followUpAt} onChange={event=>setFollowUpAt(event.target.value)}/></label>
    <button disabled={busy||!followUpAt} className="secondary-button">아직 진행 중 / 다시 확인</button>
   </form>
  </div>
 </article>;
}
