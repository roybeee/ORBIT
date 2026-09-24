'use client';
import {ArrowRight,Inbox,Moon,Sparkles} from 'lucide-react';

interface Props {art:string;completed:number;reviewed:boolean;tomorrowPending:number;eveningHour:number;onReview:()=>void;onProposal:()=>void;onInbox:()=>void}

// The evening form of the 오늘 hero: close the day with the PAFI review, then approve tomorrow.
export function EveningCard({art,completed,reviewed,tomorrowPending,eveningHour,onReview,onProposal,onInbox}:Props){
 return <section className="today-next mission-hero is-evening" aria-labelledby="evening-title">
  <img className="mission-hero-art" src={art} width="1536" height="864" alt="" fetchPriority="high"/>
  <div className="mission-copy">
   <span className="today-eyebrow"><Moon size={16}/> 하루 마무리 · {eveningHour}시 이후</span>
   {reviewed?<>
    <h2 id="evening-title">오늘 회고를 마쳤어요</h2>
    <p className="evening-note">{tomorrowPending?`내일 실행 제안 ${tomorrowPending}건이 결재함에서 기다립니다. 승인한 것만 내일 일정에 들어갑니다.`:'회고를 바탕으로 내일 실행 제안을 준비합니다. 준비되면 결재함에 올라옵니다.'}</p>
    <div className="today-actions">{tomorrowPending?<button className="primary-button" onClick={onInbox}><Inbox size={17}/>결재함에서 승인</button>:<button className="primary-button" onClick={onProposal}><Sparkles size={17}/>내일 제안 보기</button>}<button className="text-button" onClick={onReview}>회고 다시 보기</button></div>
   </>:<>
    <h2 id="evening-title">하루를 돌아보는 5분</h2>
    <p className="evening-note">오늘 완료 {completed}개. 결과 → 원인·규칙 → 에너지 → 감사 네 단계로 돌아보면 내일 제안이 바로 만들어집니다.</p>
    <div className="today-actions"><button className="primary-button" onClick={onReview}><Moon size={17}/>회고 시작<ArrowRight size={17}/></button><button className="text-button" onClick={onProposal}>내일 계획 먼저 보기</button></div>
   </>}
  </div>
 </section>;
}
