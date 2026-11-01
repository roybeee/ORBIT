import {z} from 'zod';
import {AgentError} from '../agent/errors.ts';
import type {KakaoCapture} from './types.ts';
import {todayInZone,validDate} from '../dates.ts';
import {redactSecrets} from '../../../integrations/orbit-kakao-mac/redaction.mjs';
export {redactSecrets} from '../../../integrations/orbit-kakao-mac/redaction.mjs';

export const KAKAO_WINDOW_MS=7*86400000;
export const KAKAO_MAX_MESSAGES=250;
const instant=z.string().datetime({offset:true});
const identity=z.string().trim().min(1).max(160);
const messageFields={id:identity,sender:z.string().trim().min(1).max(100),text:z.string().trim().min(1).max(4000)};
const message=z.union([z.object({...messageFields,sentAt:instant}).strict(),z.object({...messageFields,sentOn:z.string().refine(validDate),timePrecision:z.literal('day')}).strict()]);
const room=z.object({id:identity,title:z.string().trim().min(1).max(160),unreadCount:z.literal(0),verifiedAt:instant,messages:z.array(message).min(1).max(KAKAO_MAX_MESSAGES)}).strict();
const capture=z.object({id:z.string().uuid(),capturedAt:instant,timeZone:z.literal('Asia/Seoul'),source:z.literal('kakao-read-review'),rooms:z.array(room).min(1).max(20)}).strict();

/** Reject the whole batch when its read-state or time boundary is uncertain. */
export function validateCapture(input:unknown,now=Date.now()):KakaoCapture{
 const parsed=capture.safeParse(input);
 if(!parsed.success)throw new AgentError('읽지 않은 메시지가 없는 방의 최근 7일 대화만 가져올 수 있습니다. 수집 형식과 범위를 확인해 주세요.','KAKAO_CAPTURE',422);
 const value=parsed.data,at=Date.parse(value.capturedAt),rooms=value.rooms;
 const messages=rooms.flatMap(r=>r.messages);
 const invalid=at>now+30000||at<now-15*60000||messages.length>KAKAO_MAX_MESSAGES
  ||new Set(rooms.map(r=>r.id)).size!==rooms.length
  ||new Set(messages.map(m=>m.id)).size!==messages.length
  ||JSON.stringify(value).length>100000
  ||rooms.some(r=>Date.parse(r.verifiedAt)>at+30000||Date.parse(r.verifiedAt)<at-2*60000)
  ||messages.some(m=>'sentAt' in m
   ?Date.parse(m.sentAt)>at+30000||Date.parse(m.sentAt)<at-KAKAO_WINDOW_MS
   :Date.parse(m.sentOn+'T00:00:00+09:00')<at-KAKAO_WINDOW_MS||m.sentOn>todayInZone('Asia/Seoul',new Date(at)));
 if(invalid)throw new AgentError('최근 7일 범위, 수집 시각, 미읽음 재확인 시각 또는 중복 메시지를 확인해 주세요. 오래된 수집은 다시 시작해 주세요.','KAKAO_CAPTURE',422);
 return {...value,rooms:rooms.map(r=>({...r,title:redactSecrets(r.title),messages:r.messages.map(m=>({...m,sender:redactSecrets(m.sender),text:redactSecrets(m.text)}))}))};
}
