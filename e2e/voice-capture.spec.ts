import {expect,test,type Page} from '@playwright/test';
import {testIdentity} from './support';

// 말로 기록 against the real local worker and D1, with a scripted speech engine: the browser's
// engine ends by itself after a pause, and the sheet must keep listening until 종료.
test.beforeEach(async({context})=>{
 await context.setExtraHTTPHeaders(testIdentity());
 await context.addInitScript(()=>{
  type Listener={onresult:((e:unknown)=>void)|null;onend:(()=>void)|null;onerror:((e:unknown)=>void)|null;results:({transcript:string}[]&{isFinal?:boolean})[];ended:boolean};
  const state={instances:[] as Listener[],current:null as Listener|null};
  class FakeRecognition{lang='';interimResults=false;continuous=false;onresult=null;onend=null;onerror=null;results:Listener['results']=[];ended=false;
   start(){state.instances.push(this as unknown as Listener);state.current=this as unknown as Listener}
   stop(){this.end()}abort(){this.end()}
   end(){if(this.ended)return;this.ended=true;setTimeout(()=>(this.onend as (()=>void)|null)?.(),10)}}
  const w=window as unknown as Record<string,unknown>;
  w.SpeechRecognition=FakeRecognition;w.webkitSpeechRecognition=FakeRecognition;
  w.__speech=state;
  w.__say=(text:string,final=true)=>{const r=state.current!;const last=r.results.at(-1);
   // An interim result is replaced by the next result at the same index.
   const index=last&&!last.isFinal?r.results.length-1:r.results.length;
   const entry=Object.assign([{transcript:text}],{isFinal:final});r.results[index]=entry;
   r.onresult?.({resultIndex:index,results:r.results})};
  w.__pause=()=>{(state.current as unknown as FakeRecognition).end()};
 });
});

const say=(page:Page,text:string,final=true)=>page.evaluate(([t,f])=>(window as unknown as {__say:(t:string,f:boolean)=>void}).__say(t as string,f as boolean),[text,final]);
const instances=(page:Page)=>page.evaluate(()=>(window as unknown as {__speech:{instances:unknown[]}}).__speech.instances.length);
const workspace=async(page:Page)=>(await page.evaluate(async()=>(await (await fetch('/api/workspace',{cache:'no-store'})).json()))).data;

async function startTalking(page:Page){
 await page.goto('/');
 await page.getByRole('button',{name:'말로 기록'}).click();
 await page.getByRole('button',{name:'음성 입력 시작'}).click();
 await expect(page.getByRole('status').filter({hasText:'듣고 있어요'})).toBeVisible();
}

test('dictation keeps listening through pauses until 종료, then each thing said is reviewed and saved with its own kind',async({page})=>{
 await startTalking(page);
 await say(page,'내일 오후 3시에 성수 파트너 미팅 있고');
 // The engine stops by itself after a pause; the sheet keeps what it heard and listens again.
 await page.evaluate(()=>(window as unknown as {__pause:()=>void}).__pause());
 await expect.poll(()=>instances(page)).toBe(2);
 await expect(page.getByRole('status').filter({hasText:'듣고 있어요'})).toBeVisible();
 await say(page,'그리고 금요일까지',false);
 await expect(page.locator('.capture-listening p')).toHaveText('그리고 금요일까지');
 await say(page,'그리고 금요일까지 IR 덱 수정본 보내야 돼');
 await say(page,'그리고 매운맛 단계 설명 아이디어 메모해 줘');
 await expect(page.getByRole('textbox',{name:'빠른 기록 내용'})).toHaveValue(/성수 파트너 미팅 있고 그리고 금요일까지 IR 덱 수정본 보내야 돼 그리고 매운맛/);
 // Saving waits for 종료.
 await expect(page.getByRole('button',{name:/저장/}).last()).toBeDisabled();
 await page.getByRole('button',{name:'종료',exact:true}).click();
 await expect(page.locator('.capture-listening')).toBeHidden();

 const list=page.getByRole('region',{name:/여러 건으로 등록/});
 await expect(list.getByText('3건으로 나눠 등록')).toBeVisible();
 await expect(page.getByRole('textbox',{name:'1번 제목'})).toHaveValue('성수 파트너 미팅');
 await expect(page.getByRole('textbox',{name:'2번 제목'})).toHaveValue('IR 덱 수정본 보내기');
 await expect(page.getByRole('textbox',{name:'3번 제목'})).toHaveValue('매운맛 단계 설명 아이디어');
 await expect(page.getByRole('radiogroup',{name:'1번 저장 형식'}).getByRole('radio',{name:/일정/})).toHaveAttribute('aria-checked','true');
 await expect(page.getByRole('radiogroup',{name:'2번 저장 형식'}).getByRole('radio',{name:/할 일/})).toHaveAttribute('aria-checked','true');
 // Each item's kind is the owner's to change; the third becomes a to-do.
 await page.getByRole('radiogroup',{name:'3번 저장 형식'}).getByRole('radio',{name:/할 일/}).click();
 await page.getByRole('textbox',{name:'3번 제목'}).fill('매운맛 단계 설명 정리');
 await page.getByRole('button',{name:'3건 저장'}).click();
 await expect(page.getByText(/저장됨 · 3건/)).toBeVisible();
 await expect.poll(async()=>{const d=await workspace(page);return [d.events.find((e:{title:string})=>e.title==='성수 파트너 미팅')?.start,d.tasks.filter((t:{title:string})=>['IR 덱 수정본 보내기','매운맛 단계 설명 정리'].includes(t.title)).length];},{timeout:20000}).toEqual([900,2]);
 const d=await workspace(page);
 // The words said stay with the record.
 expect(d.tasks.find((t:{title:string})=>t.title==='IR 덱 수정본 보내기').definition).toMatch(/금요일까지 IR 덱 수정본 보내야 돼/);
});

test('when the server can organize, its short titles are used; an item can be left out',async({page})=>{
 await page.route('**/api/capture/organize',route=>route.fulfill({json:{answer:{items:[
  {kind:'event',title:'세무사 미팅',source:'다음 주 화요일 10시에 세무사 미팅 잡혀 있어'},
  {kind:'task',title:'법인카드 정산',source:'월말까지 법인카드 정산해야 돼'},
 ]}}}));
 await startTalking(page);
 await say(page,'음 다음 주 화요일 10시에 세무사 미팅 잡혀 있어 그 다음에 월말까지 법인카드 정산해야 돼');
 await page.getByRole('button',{name:'종료',exact:true}).click();
 await expect(page.getByText('AI가 정리했어요')).toBeVisible();
 await expect(page.getByRole('textbox',{name:'2번 제목'})).toHaveValue('법인카드 정산');
 await page.getByRole('checkbox',{name:'1번 등록'}).uncheck();
 await page.getByRole('button',{name:'1건 저장'}).click();
 await expect.poll(async()=>{const d=await workspace(page);return [d.tasks.some((t:{title:string})=>t.title==='법인카드 정산'),d.events.some((e:{title:string})=>e.title==='세무사 미팅')];},{timeout:20000}).toEqual([true,false]);
});

test('typed lines that each name a time or a deadline are offered as separate items; 한 건으로 keeps one',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:/무엇이든 적어 두세요/}).click();
 await page.getByRole('textbox',{name:'빠른 기록 내용'}).fill('내일 3시 성수 파트너 미팅\n금요일까지 IR 덱 보내기');
 await expect(page.getByText('2건으로 나눠 등록')).toBeVisible();
 await page.getByRole('button',{name:'한 건으로'}).click();
 await expect(page.getByRole('radiogroup',{name:'저장 형식'})).toBeVisible();
 await page.getByRole('button',{name:/여러 건으로 나누기/}).click();
 await expect(page.getByRole('button',{name:'2건 저장'})).toBeVisible();
});
