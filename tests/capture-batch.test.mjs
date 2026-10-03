import test from 'node:test';
import assert from 'node:assert/strict';
import {splitCapture,batchItems,spokenTitle,organizedItems,ORGANIZE_INSTRUCTIONS} from '../lib/orbit/capture-batch.ts';
import {organizeCapture} from '../lib/orbit/capture-organize.ts';
import {mergeFinals} from '../lib/orbit/dictation.ts';
import {captureAction,findDate} from '../lib/orbit/quick-capture.ts';
import {applyAction} from '../lib/orbit/reducer.ts';
import {commandSchema} from '../lib/orbit/validation.ts';
import {emptyWorkspace} from '../lib/orbit/model.ts';

// 2026-10-03 is a Saturday.
const today='2026-10-03',ctx={today,projects:[]};
const spoken='내일 오후 3시에 성수 파트너 미팅 있고 그리고 금요일까지 IR 덱 수정본 보내야 돼 그리고 매운맛 단계 설명 아이디어 메모해 줘';

test('one stream of speech with several things becomes one item per thing, each with its own kind and when',()=>{
 const items=batchItems(spoken,ctx);
 assert.deepEqual(items.map(i=>[i.kind,i.title]),[['event','성수 파트너 미팅'],['task','IR 덱 수정본 보내기'],['note','매운맛 단계 설명 아이디어']]);
 assert.equal(items[0].reading.date,'2026-10-04');assert.equal(items[0].reading.start,900);
 assert.equal(items[1].reading.date,'2026-10-09');
 // The words said stay as the body, so nothing is lost by the short title.
 assert.match(items[1].reading.body,/금요일까지 IR 덱 수정본 보내야 돼/);
});

test('ordinals, punctuation and plain lines split; bullets, one thing and plain memos stay whole',()=>{
 assert.equal(splitCapture('첫 번째 수요일 2시 디자이너 미팅 두 번째 포장 샘플 업체에 연락해야 돼 세 번째 인스타 기획안 금요일까지 드려야 돼',today).length,3);
 assert.equal(splitCapture('오늘 저녁 7시 가족 식사. 내일까지 견적서 회신하기.',today).length,2);
 assert.equal(splitCapture('내일 3시 성수 파트너 미팅\n금요일까지 IR 덱 보내기',today).length,2);
 assert.equal(splitCapture('해외 바이어 미팅\n- 단가 협의 완료\n- 샘플 3종 발송하기',today).length,1);
 assert.equal(splitCapture('내일 3시 성수 파트너 미팅',today).length,1);
 assert.equal(splitCapture('매운맛 단계 설명은 맵기 숫자보다 음식 비유가 좋겠다 그리고 사진도 같이',today).length,1);
 assert.deepEqual(splitCapture('',today),[]);
});

test('spoken titles drop fillers, the when and the request, and read an obligation as an action',()=>{
 assert.equal(spokenTitle('음 그 내일까지 포장 샘플 업체에 연락해야 돼',today),'포장 샘플 업체에 연락하기');
 assert.equal(spokenTitle('다음 주 화요일 10시에 세무사 미팅 잡혀 있어',today),'세무사 미팅');
 assert.equal(spokenTitle('금요일까지 기획안 드려야 돼요',today),'기획안 드리기');
 assert.equal(spokenTitle('계약서 받아야 돼',today),'계약서 받기');
 assert.equal(spokenTitle('견적서 회신할 거야',today),'견적서 회신하기');
 assert.equal(spokenTitle('해외 파트너용 메뉴 아이디어 메모해 줘',today),'해외 파트너용 메뉴 아이디어');
 assert.ok(spokenTitle('이번에 12월 회사 개인 손익 플러스 검증하는 거 회계사님한테 자료 받아서 다음 주까지 정리해야 할 것 같아',today).length<=41);
});

test('월말, 이번 달 말 and 다음 달 말 are the last day of that month',()=>{
 assert.equal(findDate('월말까지 법인카드 정산',today)?.date,'2026-10-31');
 assert.equal(findDate('이번 달 말까지',today)?.date,'2026-10-31');
 assert.equal(findDate('다음 달 말 마감','2026-12-10')?.date,'2027-01-31');
});

test('the model answer is checked: kinds, titles and each item’s own words; dates still read locally',()=>{
 const answer={items:[{kind:'event',title:'성수 파트너 미팅',source:'내일 오후 3시에 성수 파트너 미팅 있고'},{kind:'task',title:'IR 덱 수정본 발송',source:'금요일까지 IR 덱 수정본 보내야 돼'},{kind:'note',title:'매운맛 단계 설명 아이디어',source:'매운맛 단계 설명 아이디어 메모해 줘'}]};
 const items=organizedItems(answer,spoken,ctx);
 assert.deepEqual(items.map(i=>[i.kind,i.title,i.reading.date??null,i.reading.start??null]),[['event','성수 파트너 미팅','2026-10-04',900],['task','IR 덱 수정본 발송','2026-10-09',null],['note','매운맛 단계 설명 아이디어',null,null]]);
 // An unknown kind falls back to the local guess for that item.
 assert.equal(organizedItems({items:[{kind:'reminder',title:'IR 덱',source:'금요일까지 IR 덱 수정본 보내야 돼'}]},'금요일까지 IR 덱 수정본 보내야 돼',ctx)[0].kind,'task');
 assert.equal(organizedItems({items:[]},spoken,ctx),null);
 assert.equal(organizedItems({items:[{kind:'task',title:'',source:'x'}]},spoken,ctx),null);
 assert.equal(organizedItems({nope:true},spoken,ctx),null);
 // An answer that dropped most of what was said does not replace the local reading.
 assert.equal(organizedItems({items:[{kind:'task',title:'IR 덱',source:'IR 덱'}]},spoken,ctx),null);
 assert.match(ORGANIZE_INSTRUCTIONS,/source/);
});

test('each reviewed item becomes a valid command and lands in the workspace',()=>{
 let data=emptyWorkspace();
 const items=batchItems(spoken,ctx);
 for(const [i,item] of items.entries()){
  const action=captureAction(item.reading,item.kind,{id:`00000000-0000-4000-8000-00000000000${i}`,today,data,nowMinute:600});
  assert.equal(commandSchema.safeParse({operationId:'00000000-0000-4000-8000-000000000001',expectedRevision:0,action}).success,true,JSON.stringify(action));
  data=applyAction(data,action,new Date('2026-10-03T01:00:00Z'));
 }
 assert.equal(data.events.find(e=>e.title==='성수 파트너 미팅')?.start,900);
 assert.equal(data.tasks.find(t=>t.title==='IR 덱 수정본 보내기')?.due,'2026-10-09');
 assert.ok(data.notes.some(n=>n.title==='매운맛 단계 설명 아이디어'));
});

test('dictation keeps the longest of repeated cumulative finals and keeps distinct ones in order',()=>{
 assert.equal(mergeFinals(['내일','내일 3시','내일 3시 미팅']),'내일 3시 미팅');
 assert.equal(mergeFinals(['내일 3시 미팅','금요일까지 덱 보내기']),'내일 3시 미팅 금요일까지 덱 보내기');
 assert.equal(mergeFinals(['내일 3시 미팅','3시 미팅','  ']),'내일 3시 미팅');
});

test('the organize endpoint reads through the model only when it is configured',async()=>{
 await assert.rejects(organizeCapture({},{text:spoken,today}),e=>e.code==='AI_OFF'&&e.status===503);
 await assert.rejects(organizeCapture({OPENAI_API_KEY:'k'},{text:'',today}),e=>e.code==='INPUT');
 await assert.rejects(organizeCapture({OPENAI_API_KEY:'k'},{text:'가'.repeat(4001),today}),e=>e.code==='INPUT');
 const real=globalThis.fetch;let sent;
 globalThis.fetch=async(url,init)=>{sent={url,body:JSON.parse(init.body)};return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify({items:[{kind:'task',title:'IR 덱 보내기',source:spoken}]})}]}]})};
 try{
  const result=await organizeCapture({OPENAI_API_KEY:'k'},{text:spoken,today});
  assert.equal(sent.url,'https://api.openai.com/v1/responses');
  assert.equal(sent.body.store,false);assert.match(sent.body.instructions,/오늘은 2026-10-03/);
  assert.equal(result.answer.items[0].title,'IR 덱 보내기');
 }finally{globalThis.fetch=real}
});
