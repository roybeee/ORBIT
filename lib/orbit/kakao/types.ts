export type KakaoMessage={id:string;sender:string;text:string}&({sentAt:string;sentOn?:never;timePrecision?:never}|{sentAt?:never;sentOn:string;timePrecision:'day'});
export interface KakaoRoom {id:string;title:string;unreadCount:0;verifiedAt:string;messages:KakaoMessage[]}
export interface KakaoCapture {id:string;capturedAt:string;timeZone:'Asia/Seoul';source:'kakao-read-review';rooms:KakaoRoom[]}
export interface KakaoCitation {messageId:string;quote:string}
export interface KakaoSolution {problem:string;evidence:KakaoCitation[];assumptions:string[];options:string[];recommendation:string;nextAction:string}
export interface KakaoReview {
 id:string;capturedAt:string;createdAt:string;status:'completed';roomCount:number;messageCount:number;
 actionCount:number;conversationId:string;solutions:KakaoSolution[];questions:string[];summary:string;
 sources:({id:string;room:string;sender:string;excerpt:string}&({sentAt:string;sentOn?:never;timePrecision?:never}|{sentAt?:never;sentOn:string;timePrecision:'day'}))[];replayed?:boolean;
}
export interface KakaoStatus {modelReady:boolean;runs:KakaoReview[]}
