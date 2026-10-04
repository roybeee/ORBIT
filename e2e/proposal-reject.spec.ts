import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { testIdentity } from './support';

// Real local workspace API + D1. Only Sites authentication headers and the browser
// clock are simulated; the second journey additionally injects a failed save.
class ProposalInbox {
  constructor(readonly page: Page) {}
  card(id: string): Locator { return this.page.getByTestId(`plan-proposal-${id}`); }
  async open() { await this.page.goto('/#inbox'); }
  async reject(id: string) { await this.card(id).getByTestId('reject-proposal').click(); }
  async reason(id: string, reason: string) { await this.card(id).getByTestId('reject-reason').fill(reason); }
  async cancel(id: string) { await this.card(id).getByTestId('cancel-reject-proposal').click(); }
  async confirm(id: string) { await this.card(id).getByTestId('confirm-reject-proposal').click(); }
  async reload() { await this.page.reload(); }
  async screenshot(path: string) { await this.page.screenshot({ path, fullPage: true }); }
}

type Item = { id: string; taskId: string; state: string; rejectReason?: string };
type Snapshot = { revision: number; data: { preferences: Record<string, unknown>; proposals: { date: string; items: Item[] }[]; tasks: { id: string }[]; events: unknown[] } };
class WorkspaceFixture {
  constructor(readonly request: APIRequestContext, readonly baseURL: string, readonly identity: Record<string,string>) {}
  async read(): Promise<Snapshot> { return (await this.request.get('/api/workspace', { headers: this.identity })).json(); }
  async command(action: unknown) {
    const current = await this.read();
    const response = await this.request.post('/api/workspace', {
      headers: { ...this.identity, origin: this.baseURL },
      data: { operationId: randomUUID(), expectedRevision: current.revision, action },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    return response.json() as Promise<Snapshot>;
  }
  async seed(page: Page) {
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year:'numeric',month:'2-digit',day:'2-digit' }).format(now);
    const nextDate = (offset: number) => new Date(Date.parse(`${today}T00:00:00+09:00`) + offset * 86400000).toLocaleDateString('en-CA', {timeZone:'Asia/Seoul'});
    const lateDate = nextDate(0), futureDate = nextDate(1);
    await page.clock.setFixedTime(new Date(`${lateDate}T23:00:00+09:00`));
    const initial = await this.read();
    await this.command({ type:'preferences.update', preferences:{...initial.data.preferences,workDays:[0,1,2,3,4,5,6],workStart:0,workEnd:1440,autoApprovePlan:false} });
    await this.command({ type:'project.upsert',project:{id:'reject-project',name:'반려 확인',goal:'회귀 확인',color:'#5558e8',symbol:'확',due:futureDate,priority:3} });
    await this.command({ type:'task.upsert', task:{id:'reject-task',title:'반려 회귀 확인용 할 일',projectId:'reject-project',status:'todo',duration:30,due:futureDate,impact:3,focus:false,definition:'원래 할 일은 유지'} });
    await this.command({type:'proposal.generate',date:lateDate,energy:'normal'});
    const seeded = await this.command({type:'proposal.generate',date:futureDate,energy:'normal'});
    const late = seeded.data.proposals.find(p=>p.date===lateDate)?.items.find(i=>i.state==='pending');
    const future = seeded.data.proposals.find(p=>p.date===futureDate)?.items.find(i=>i.state==='pending');
    expect(late, 'local planner must produce a late proposal').toBeTruthy();
    expect(future, 'local planner must produce a future proposal').toBeTruthy();
    return {late:late!,future:future!,lateDate,futureDate};
  }
}

test('future and late plans can be rejected; cancel and reload preserve the correct state', async ({ page, context, request, baseURL }, testInfo) => {
  const identity = testIdentity();
  await context.setExtraHTTPHeaders(identity);
  const fixture = new WorkspaceFixture(request,baseURL!,identity);
  const {late,future,lateDate,futureDate} = await fixture.seed(page);
  const inbox = new ProposalInbox(page);
  await inbox.open();
  await expect(inbox.card(late.id).getByRole('button',{name:'대안 다시 계산'})).toBeVisible();
  await expect(inbox.card(future.id).getByRole('button',{name:'승인',exact:true})).toBeVisible();
  await mkdir('e2e/artifacts/screens',{recursive:true});
  await inbox.screenshot(`e2e/artifacts/screens/${testInfo.project.name}-proposal-reject-controls.png`);
  await inbox.reject(future.id);
  await inbox.reason(future.id,'이번 제안은 진행하지 않음');
  await inbox.screenshot(`e2e/artifacts/screens/${testInfo.project.name}-proposal-reject-form.png`);
  await inbox.cancel(future.id);
  expect((await fixture.read()).data.proposals.find(p=>p.date===futureDate)?.items.find(i=>i.id===future.id)?.state).toBe('pending');
  await inbox.reject(future.id);
  await inbox.reason(future.id,'이번 제안은 진행하지 않음');
  await inbox.confirm(future.id);
  await expect(inbox.card(future.id)).toHaveCount(0);
  await inbox.reject(late.id);
  await inbox.confirm(late.id); // A reason is optional.
  await expect(inbox.card(late.id)).toHaveCount(0);
  await inbox.reload();
  await expect(inbox.card(future.id)).toHaveCount(0);
  await expect(inbox.card(late.id)).toHaveCount(0);
  await fixture.command({type:'proposal.generate',date:futureDate,energy:'normal'});
  await fixture.command({type:'proposal.generate',date:lateDate,energy:'normal'});
  await inbox.reload();
  await expect(inbox.card(future.id)).toHaveCount(0);
  await expect(inbox.card(late.id)).toHaveCount(0);
  const saved = await fixture.read();
  expect(saved.data.proposals.find(p=>p.date===futureDate)?.items.find(i=>i.id===future.id)).toMatchObject({state:'rejected',rejectReason:'이번 제안은 진행하지 않음'});
  expect(saved.data.proposals.find(p=>p.date===lateDate)?.items.find(i=>i.id===late.id)?.state).toBe('rejected');
  expect(saved.data.tasks.map(t=>t.id)).toContain('reject-task');
  expect(saved.data.events).toHaveLength(0);
});

test('a failed rejection keeps the pending card and the entered reason', async ({ page, context, request, baseURL }) => {
  const identity = testIdentity();
  await context.setExtraHTTPHeaders(identity);
  const fixture = new WorkspaceFixture(request,baseURL!,identity);
  const {future,futureDate} = await fixture.seed(page);
  const inbox = new ProposalInbox(page);
  await inbox.open();
  await inbox.reject(future.id);
  await inbox.reason(future.id,'저장 실패에도 유지할 이유');
  expect((await fixture.read()).data.proposals.find(p=>p.date===futureDate)?.items.find(i=>i.id===future.id)?.state).toBe('pending');
  let attempts = 0;
  await page.route('**/api/workspace',async route=>{
    if(route.request().method()==='POST' && route.request().postDataJSON().action.type==='proposal.reject'){
      attempts++;
      return route.fulfill({status:422,json:{code:'INPUT',error:'반려 저장 실패 테스트'}});
    }
    return route.continue();
  });
  await inbox.confirm(future.id);
  await expect.poll(()=>attempts).toBe(1);
  await expect(inbox.card(future.id)).toBeVisible();
  await expect(inbox.card(future.id).getByTestId('reject-reason')).toHaveValue('저장 실패에도 유지할 이유');
  expect((await fixture.read()).data.proposals.find(p=>p.date===futureDate)?.items.find(i=>i.id===future.id)?.state).toBe('pending');
});
