import {expect,test,type Page,type Route} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {testIdentity} from './support';

// Browser/worker and authenticated workspace are real. Kakao local capture and the
// analysis API are mocked; these tests do not access KakaoTalk or Google Calendar.
const LOCAL='http://127.0.0.1:43128';
const TOKEN='a'.repeat(64);

class KakaoReviewPage {
 constructor(readonly page:Page){}
 get dialog(){return this.page.getByTestId('kakao-review-dialog')}
 get token(){return this.page.getByTestId('kakao-token')}
 get connect(){return this.page.getByTestId('kakao-connect')}
 get scan(){return this.page.getByTestId('kakao-scan')}
 get error(){return this.page.getByTestId('kakao-error')}
 get result(){return this.page.getByTestId('kakao-review-result')}
 async open(){
  await this.page.goto('/#inbox');
  await expect(this.page.getByTestId('kakao-review-open')).toBeVisible();
  await this.page.getByTestId('kakao-review-open').click();
  await expect(this.dialog).toBeVisible();
 }
 async connectMac(){await this.token.fill(TOKEN);await this.connect.click();await expect(this.scan).toBeEnabled()}
 async close(){await this.page.keyboard.press('Escape');await expect(this.dialog).toBeHidden()}
 async reopen(){await this.page.getByTestId('kakao-review-open').click();await expect(this.dialog).toBeVisible()}
 async importInvalidFile(){
  await this.page.getByTestId('kakao-capture-file').setInputFiles({name:'invalid-capture.json',mimeType:'application/json',buffer:Buffer.from('{not valid JSON')});
 }
 async captureResult(path:string){await this.result.scrollIntoViewIfNeeded();await this.dialog.screenshot({path})}
 async showInbox(){await this.page.getByTestId('kakao-open-inbox').click()}
}

function sampleCapture(){
 const now=new Date().toISOString();
 return {id:randomUUID(),capturedAt:now,timeZone:'Asia/Seoul',source:'kakao-read-review',rooms:[{id:'reviewed-room',title:'읽은 업무방',unreadCount:0,verifiedAt:now,messages:[{id:'reviewed-message',sentAt:now,sender:'담당자',text:'검토 자료가 없어 일정 확정이 어렵습니다.'}]}]};
}

function sampleReview(capture:ReturnType<typeof sampleCapture>){
 return {id:capture.id,capturedAt:capture.capturedAt,createdAt:capture.capturedAt,status:'completed',roomCount:1,messageCount:1,actionCount:1,conversationId:randomUUID(),
  summary:'자료 확인 업무를 제안했습니다. 승인하면 반영됩니다.',questions:[],
  sources:[{id:'reviewed-message',room:'읽은 업무방',sender:'담당자',sentAt:capture.capturedAt,excerpt:'검토 자료가 없어 일정 확정이 어렵습니다.'}],
  solutions:[{problem:'자료 미확인으로 일정 확정 대기',evidence:[{messageId:'reviewed-message',quote:'검토 자료가 없어 일정 확정이 어렵습니다.'}],assumptions:['자료의 준비 여부는 확인이 필요합니다.'],options:['자료 확보 후 일정 확정','임시 검토 범위 결정'],recommendation:'자료 준비 여부부터 확인하세요.',nextAction:'필요 자료 목록을 정리하세요.'}],
 };
}

async function jsonLocal(route:Route,status:number,value:unknown){
 const origin=route.request().headers().origin??'http://localhost:4317';
 const headers={'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-private-network':'true'};
 await route.fulfill({status,headers,json:value});
}

async function mockedBoundary(page:Page,{modelReady=true,scanError=false}:{modelReady?:boolean;scanError?:boolean}={}){
 const capture=sampleCapture(),review=sampleReview(capture);
 const calls:{path:string;method:string;authorization?:string;body?:unknown}[]=[],analysis:unknown[]=[],calendarWrites:string[]=[];
 let runs:ReturnType<typeof sampleReview>[]=[];
 page.on('request',request=>{if(request.url().includes('/api/integrations/calendar')&&!['GET','OPTIONS'].includes(request.method()))calendarWrites.push(request.url())});
 await page.route('**/api/integrations/kakao',async route=>{
  if(route.request().method()==='POST'){analysis.push(route.request().postDataJSON());runs=[review];return route.fulfill({json:review})}
  if(route.request().method()==='DELETE'){runs=[];return route.fulfill({json:{deleted:true}})}
  return route.fulfill({json:{modelReady,runs}});
 });
 await page.route(LOCAL+'/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  if(request.method()==='OPTIONS')return jsonLocal(route,200,{});
  calls.push({path,method:request.method(),authorization:request.headers().authorization,body:request.postData()?request.postDataJSON():undefined});
  if(path==='/health')return jsonLocal(route,200,{protocol:1,connected:true,mode:'manual_only',message:'현재 읽은 방만 확인할 수 있습니다.',permissions:{accessibility:true},active:false});
  if(path==='/scan')return scanError?jsonLocal(route,409,{error:'읽지 않은 새 메시지가 있어 수집을 중단했습니다.',code:'UNREAD_MESSAGES'}):jsonLocal(route,200,{capture,skipped:[]});
  return jsonLocal(route,200,{stopped:true});
 });
 return {capture,review,calls,analysis,calendarWrites};
}

test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders(testIdentity())});

test('opening the review never scans Kakao and an unavailable model prevents collection',async({page})=>{
 const boundary=await mockedBoundary(page,{modelReady:false}),review=new KakaoReviewPage(page);
 await review.open();
 await expect(review.dialog).toContainText('최근 7일');
 await expect(review.dialog).toContainText('분석 연결이 필요합니다');
 await expect(review.scan).toBeDisabled();
 expect(boundary.calls).toEqual([]);
 expect(boundary.analysis).toEqual([]);
});

test('an unread-message capture rejection never reaches analysis and the local key is not retained',async({page})=>{
 const boundary=await mockedBoundary(page,{scanError:true}),review=new KakaoReviewPage(page);
 await review.open();await review.connectMac();
 await expect(review.dialog).toContainText('자동 방 이동은 꺼져 있습니다');
 expect(boundary.calls.map(c=>c.path)).toEqual(['/health']);
 expect(boundary.calls[0].authorization).toBe('Bearer '+TOKEN);
 await review.scan.click();
 await expect(review.error).toContainText('읽지 않은 새 메시지');
 expect(boundary.analysis).toEqual([]);
 expect(boundary.calls.filter(c=>c.path==='/scan')).toHaveLength(1);
 expect(boundary.calls.find(c=>c.path==='/scan')?.body).toMatchObject({scope:'current_read_room'});
 const stored=await page.evaluate(()=>JSON.stringify({local:localStorage,session:sessionStorage}));
 expect(stored).not.toContain(TOKEN);
 await review.close();await review.reopen();
 await expect(review.token).toHaveValue('');
 await expect(review.scan).toBeDisabled();
});

test('reviewed capture shows cited solutions and stages review without writing a Google event',async({page},info)=>{
 const boundary=await mockedBoundary(page),review=new KakaoReviewPage(page);
 await review.open();await review.connectMac();await review.scan.click();
 await expect(review.result).toContainText(boundary.review.summary);
 await expect(review.result).toContainText(boundary.review.solutions[0].problem);
 await expect(review.result).toContainText(boundary.review.solutions[0].nextAction);
 await expect(review.result).toContainText(boundary.review.sources[0].excerpt);
 expect(boundary.analysis).toEqual([boundary.capture]);
 expect(boundary.calendarWrites).toEqual([]);
 const screenshot=info.outputPath('kakao-review.png');
 await review.captureResult(screenshot);await info.attach('카카오톡 비서실장 검토 결과',{path:screenshot,contentType:'image/png'});
 await review.showInbox();
 await expect(review.dialog).toBeHidden();
 await expect(page).toHaveURL(/#inbox$/);
});

test('malformed capture import reports an error without submitting analysis',async({page})=>{
 const boundary=await mockedBoundary(page),review=new KakaoReviewPage(page);
 await review.open();await review.importInvalidFile();
 await expect(review.error).toBeVisible();
 expect(boundary.analysis).toEqual([]);
 expect(boundary.calls).toEqual([]);
});

test('deleting reviewed evidence requires confirmation and never deletes a Google event',async({page})=>{
 const boundary=await mockedBoundary(page),review=new KakaoReviewPage(page),deleted:unknown[]=[];
 page.on('request',request=>{if(request.url().endsWith('/api/integrations/kakao')&&request.method()==='DELETE')deleted.push(request.postDataJSON())});
 await review.open();await review.connectMac();await review.scan.click();
 await expect(review.result).toBeVisible();
 await review.result.getByRole('button',{name:'이 검토 기록 삭제',exact:true}).click();
 await expect(review.result).toContainText('이미 승인한 할 일·일정은 유지합니다');
 expect(deleted).toEqual([]);
 await review.result.getByRole('button',{name:'취소',exact:true}).click();
 expect(deleted).toEqual([]);
 await review.result.getByRole('button',{name:'이 검토 기록 삭제',exact:true}).click();
 await review.result.getByRole('button',{name:'검토 기록 삭제 확인',exact:true}).click();
 await expect(review.result).toBeHidden();
 expect(deleted).toEqual([{id:boundary.review.id}]);
 expect(boundary.calendarWrites).toEqual([]);
});

test('dedicated analysis setup stores no key in browser storage and does not scan',async({page})=>{
 const boundary=await mockedBoundary(page,{modelReady:false}),review=new KakaoReviewPage(page),saved:unknown[]=[];
 await page.route('**/api/integrations/kakao/model',async route=>{saved.push(route.request().postDataJSON());await route.fulfill({json:{configured:true,provider:'anthropic',model:'claude-synthetic'}})});
 await review.open();await review.dialog.getByText('분석 연결 설정',{exact:true}).click();
 await review.dialog.getByLabel('분석 모델',{exact:true}).fill('claude-synthetic');
 await review.dialog.getByLabel('분석 API 키',{exact:true}).fill('synthetic-test-key-not-a-real-key');
 await review.dialog.getByRole('button',{name:'분석 연결 저장',exact:true}).click();
 await expect(review.dialog.getByRole('status').filter({hasText:'전용 분석 연결 설정을 저장했습니다'})).toBeVisible();
 await expect(review.dialog.getByLabel('분석 API 키',{exact:true})).toHaveValue('');
 expect(saved).toEqual([{provider:'anthropic',apiKey:'synthetic-test-key-not-a-real-key',model:'claude-synthetic'}]);
 expect(await page.evaluate(()=>JSON.stringify({local:localStorage,session:sessionStorage}))).not.toContain('synthetic-test-key-not-a-real-key');
 expect(boundary.calls).toEqual([]);
 expect(boundary.analysis).toEqual([]);
});
