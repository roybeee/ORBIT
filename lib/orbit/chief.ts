import type { CalendarEvent, Goal, WorkspaceData } from './model.ts';
import { todayInZone, addDays } from './dates.ts';

export const domainLabels = { work: '일·사업', health: '건강', mind: '마음·회복', learning: '학습', life: '삶' };
export const chiefDefaults = { tone: 'balanced' as const, quietStart: 22 * 60, quietEnd: 8 * 60 };
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const dayNumber = (date: string) => Date.parse(date + 'T00:00:00Z') / 86400000;
export function goalPace(goal: Goal, today: string) {
  const p = goal.progress;
  if (!p || !goal.deadline || !Number.isFinite(p.current) || p.target === p.baseline || goal.deadline <= p.startedOn)
    return { status: goal.status === 'achieved' ? 'achieved' as const : 'unknown' as const };
  const actual = clamp((p.current - p.baseline) / (p.target - p.baseline));
  const expected = clamp((dayNumber(today) - dayNumber(p.startedOn)) / (dayNumber(goal.deadline) - dayNumber(p.startedOn)));
  const stale = dayNumber(today) - dayNumber(p.updatedOn) > 7 || p.updatedOn > today;
  return { actual, expected, stale, status: goal.status === 'achieved' ? 'achieved' as const : goal.status === 'paused' ? 'paused' as const : stale ? 'unknown' as const : actual >= 1 ? 'confirm' as const : expected - actual > .15 ? 'behind' as const : 'on-track' as const };
}
export function localMinute(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  return Number(parts.find(p => p.type === 'hour')?.value) * 60 + Number(parts.find(p => p.type === 'minute')?.value);
}
export function careEvents(data: WorkspaceData, date: string): CalendarEvent[] {
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  return (data.careRoutines ?? []).filter(r => r.active && r.days.includes(day) && (!r.goalId || !['paused', 'achieved'].includes(data.goals?.find(g => g.id === r.goalId)?.status ?? 'active'))).map(r => ({ id: `care:${r.id}:${date}`, title: r.title, date, start: r.start, end: Math.min(1440, r.start + r.minutes), kind: 'break' }));
}
export function goalAllowsWork(data:WorkspaceData,projectId:string) { const goalId=data.projects.find(p=>p.id===projectId)?.goalId; return !['paused','achieved'].includes(data.goals?.find(g=>g.id===goalId)?.status??'active'); }
export interface ChiefSignal {
  key: string; kind: 'focus' | 'recovery' | 'rest' | 'task' | 'care' | 'followup' | 'goal' | 'checkin' | 'clear';
  title: string; reason: string; next: string; minutes?: number; taskId?: string; routineId?: string; goalId?: string;
  ask: string;
}
export function chiefOfStaff(data: WorkspaceData, now = new Date()) {
  const today = todayInZone(data.preferences.timeZone, now), minute = localMinute(now, data.preferences.timeZone);
  const settings = { ...chiefDefaults, ...data.chief?.settings };
  const checkin = data.chief?.checkins?.find(c => c.date === today);
  const review = data.reviews.filter(r => r.date <= today && r.date >= addDays(today, -1)).sort((a,b) => b.date.localeCompare(a.date))[0];
  const energy = checkin?.energy ?? review?.energy;
  const recovery = energy === 'low' || checkin?.strain === 'heavy';
  const quiet = settings.quietStart > settings.quietEnd ? minute >= settings.quietStart || minute < settings.quietEnd : minute >= settings.quietStart && minute < settings.quietEnd;
  const paused = !!settings.pausedUntil && Date.parse(settings.pausedUntil) > now.getTime();
  const meeting = data.events.find(e => e.date === today && e.kind === 'meeting' && e.start <= minute && e.end > minute);
  const active = data.tasks.find(t => t.startedAt && t.status !== 'done');
  const goals = (data.goals ?? []).map(g => ({ ...g, pace: goalPace(g, today) }));
  const responses = data.chief?.responses ?? [];
  const visible = (key: string) => !responses.some(r => r.key === key && Date.parse(r.until) > now.getTime());
  const projectGoal = (id: string) => goals.find(g => g.id === data.projects.find(p => p.id === id)?.goalId);
  const goalActive = (id: string) => !['paused','achieved'].includes(projectGoal(id)?.status ?? 'active');
  const ready = data.tasks.filter(t => t.status !== 'done' && t.status !== 'waiting' && !t.blocker?.trim() && (!t.planHoldUntil || t.planHoldUntil <= today) && (t.dependsOn ?? []).every(id => data.tasks.find(d => d.id === id)?.status === 'done') && goalActive(t.projectId));
  const ranked = ready.sort((a,b) => {
    const score = (t: typeof a) => (projectGoal(t.projectId) ? 25 : 0) + (projectGoal(t.projectId)?.pace.status === 'behind' ? 25 : 0) + (t.due <= today ? 20 : 0) + (t.must ? 10 : 0) + t.impact * 3 + (t.focusDate === today ? 10 : 0);
    return score(b) - score(a) || a.due.localeCompare(b.due) || a.id.localeCompare(b.id);
  });
  // Union of occupied intervals: overlapping meetings must not inflate load.
  const workDay=data.preferences.workDays.includes(new Date(today+'T12:00:00Z').getUTCDay());
  const from=Math.min(data.preferences.workEnd,Math.max(minute,data.preferences.workStart));
  const withinWork=workDay && minute>=data.preferences.workStart && minute<data.preferences.workEnd;
  const intervals = [...data.events.filter(e => e.date === today), ...careEvents(data,today)].map(e => [Math.max(from,e.start), Math.min(data.preferences.workEnd,e.end)]).filter(([a,b]) => b > a).sort((a,b) => a[0]-b[0]);
  let occupied = 0, end = -1;
  for (const [a,b] of intervals) { occupied += Math.max(0,b-Math.max(a,end)); end = Math.max(end,b); }
  const capacity = workDay?Math.max(0,Math.round((data.preferences.workEnd-from-occupied)*(1-data.preferences.bufferFraction))):0;
  const reserved = new Set(data.events.filter(e=>e.date===today&&e.taskId).map(e=>e.taskId));
  const demand = ready.filter(t => !reserved.has(t.id) && (t.focusDate === today || t.due <= today)).reduce((s,t)=>s+t.duration,0);
  const overloaded = demand > capacity && demand > 0;
  const signals: ChiefSignal[] = [];
  const push = (s: ChiefSignal) => { if(visible(s.key)) signals.push(s); };
  const resting = responses.find(r=>r.key===`recovery:${today}` && r.kind==='snooze' && Date.parse(r.until)>now.getTime());
  if (active) signals.push({ key: `focus:${active.id}`, kind:'focus',taskId:active.id,title:'지금 시작한 한 가지를 지킵니다',reason:active.title,next:'집중을 이어가거나, 멈추고 실제 진행을 기록하세요.',ask:`진행 중인 '${active.title}'의 범위를 늘리지 말고 현재 막힌 점과 가장 작은 다음 단계만 도와줘.` });
  else if (resting) signals.push({key:`recovery:${today}`,kind:'rest',title:'지금은 쉬는 시간입니다',reason:`${Math.max(1,Math.ceil((Date.parse(resting.until)-now.getTime())/60000))}분 뒤 컨디션을 다시 확인합니다.`,next:'새 일을 시작하지 않아도 됩니다. 회복도 목표를 위한 실행입니다.',ask:'잠깐 쉬고 있어. 지금 부담을 줄일 수 있는 방법을 짧게 제안해 줘.'});
  else if (recovery) push({key:`recovery:${today}`,kind:'recovery',title:'지금은 회복이 목표를 지키는 행동입니다',reason:checkin?'오늘 체크인에 에너지 저하 또는 부담이 기록되었습니다.':'최근 회고의 에너지가 낮았습니다. 현재 컨디션을 다시 확인합니다.',next:'5분 쉬고, 오늘 반드시 필요한 결과물 한 가지만 남겨봅시다.',minutes:5,ask:'오늘 컨디션과 부담을 기준으로 목표를 포기하지 않으면서 회복 시간을 먼저 확보해 줘. 미룰 일·줄일 범위·도움을 요청할 것을 근거와 함께 제안하고, 승인 전에는 일정을 바꾸지 마.'});
  if (withinWork && !active && !resting && !recovery && overloaded) push({key:`load:${today}`,kind:'followup',title:'오늘의 양이 실제 여유 시간을 넘었습니다',reason:`오늘 마감·집중 작업 ${demand}분 / 지금부터 일정·돌봄·여유분을 제외한 업무 예산 ${capacity}분.`,next:'더 밀어붙이기 전에 범위 축소·위임·보류안을 정합니다.',ask:'목표에 직접 기여하는 순서로 오늘의 과부하를 해소해 줘. 실제 일정과 돌봄 시간을 지키고, 반드시 할 것 1개, 줄일 것, 미룰 것, 위임할 것을 승인 가능한 제안으로 만들어 줘.'});
  if (!active && !resting) {
    for (const t of data.tasks.filter(t => withinWork && t.status !== 'done' && (t.status === 'waiting' || !!t.blocker?.trim()) && t.checkDate && t.checkDate <= today && visible(`task:${t.id}`) && goalActive(t.projectId))) push({key:`followup:${t.id}`,kind:'followup',taskId:t.id,goalId:projectGoal(t.projectId)?.id,title:'기다리던 일을 다시 확인할 때입니다',reason:`${t.title} · 확인 예정일 ${t.checkDate}`,next:t.blocker || '어떤 정보나 결정이 오면 재개할 수 있나요?',ask:`'${t.title}'이 ${t.checkDate}부터 확인 대상이야. 막힌 원인과 지금 할 수 있는 우회 방법을 정리하고, 외부 연락은 초안만 만들어 줘.`});
    for (const t of withinWork?ranked:[]) { const g = projectGoal(t.projectId); push({key:`task:${t.id}`,kind:'task',taskId:t.id,goalId:g?.id,title:!recovery && g?.pace.status==='behind' && settings.tone==='firm'?'목표의 기준 속도보다 뒤처졌습니다. 지금 첫 5분을 잡읍시다.': '지금 목표를 움직일 한 가지',reason:`${g ? `목표: ${g.sentence} · ` : '프로젝트 결과물에 연결 · '}${t.title}${t.due <= today ? ` · ${t.due} 마감` : ''}`,next:t.definition || '완료 조건을 확인하고 작은 단계부터 시작합니다.',minutes:recovery?5:Math.min(15,t.duration),ask:`'${t.title}'을 목표 '${g?.sentence ?? data.projects.find(p=>p.id===t.projectId)?.goal}'에 연결해 지금 5분 안에 시작할 행동으로 나눠줘. 막힌 이유, 필요한 자료, 도움을 받을 방법을 함께 판단해 줘.`}); }
    const dueCare = careEvents(data,today).filter(e => e.start <= minute).map(e => data.careRoutines!.find(r => e.id === `care:${r.id}:${today}`)!);
    for(const r of dueCare.filter(r => !r.log.includes(today))) { const signal:ChiefSignal={key:`care:${r.id}:${today}`,kind:'care',routineId:r.id,goalId:r.goalId,title:`${domainLabels[r.domain]}도 오늘의 목표입니다`,reason:r.title,next:`${r.minutes}분을 나에게 돌려줍니다. 완료는 직접 확인한 뒤 기록합니다.`,minutes:r.minutes,ask:`내 ${domainLabels[r.domain]} 목표와 '${r.title}' 루틴을 오늘 컨디션에 맞춰 실천하도록 도와줘. 개인 건강 상태를 추정하거나 진단하지 말고, 부담 없이 시작할 방법을 제안해 줘.`}; if(visible(signal.key)) signals.splice(recovery?1:0,0,signal); }
  }
  for (const g of goals.filter(g => !['paused','achieved'].includes(g.status??'active') && ['behind','confirm','unknown'].includes(g.pace.status))) push({key:`goal:${g.id}:${today}`,kind:'goal',goalId:g.id,title:g.pace.status==='confirm'?'목표 수치에 도달했습니다. 결과를 확인할까요?':g.pace.status==='behind'?'목표에 도달할 경로를 조정합니다':'목표의 현재 위치를 확인합니다',reason:g.sentence,next:g.pace.status==='unknown'?'실제 수치가 없거나 오래되었습니다. 작업 완료율로 목표 달성을 추정하지 않습니다.':'기준 속도는 선형 참고선입니다. 실제 마일스톤과 장애물을 함께 검토합니다.',ask:`목표 '${g.sentence}'의 현재 성과와 남은 기한을 확인하고 성공 가능성을 높일 방법을 제안해 줘. 최신 수치를 모르면 먼저 확인하고, 목표치를 임의로 낮추지 마.`});
  if(!checkin) push({key:`checkin:${today}`,kind:'checkin',title:'오늘의 나에게 맞춰 페이스를 조정합니다',reason:'아직 오늘 컨디션을 확인하지 않았습니다.',next:'에너지와 부담을 한 번만 알려주세요. 기록이 없다고 지연이나 의지 부족으로 판단하지 않습니다.',ask:'오늘 목표를 달성하도록 업무·건강·마음·학습을 함께 챙겨줘. 먼저 에너지와 가장 큰 부담을 짧게 확인해 줘.'});
  const wins = data.tasks.filter(t => t.status === 'done' && t.completedOn === today).length + (data.careRoutines??[]).filter(r=>r.log.includes(today)).length;
  const fallback:ChiefSignal = {key:`clear:${today}`,kind:'clear',title:wins?`오늘 ${wins}개의 실행을 쌓았습니다`:'지금은 새 일을 더 얹지 않아도 됩니다',reason:'완료·보류·진행 기록을 기준으로 다음 확인까지 기다립니다.',next:'목표, 회복, 학습 중 도움이 필요한 부분을 이야기하세요.',ask:'내 목표와 최근 기록을 함께 보고, 지금 꼭 필요한 도움만 제안해 줘.'};
  return {today,minute,energy:energy??'unknown',checkin,quiet,paused,meeting:meeting?.title,attention:!quiet&&!paused&&!meeting&&!active,capacity,demand,overloaded,wins,goals,primary:signals[0]??fallback,alternatives:signals.slice(1,3),signals,care:careEvents(data,today),snapshotAt:now.toISOString()};
}
