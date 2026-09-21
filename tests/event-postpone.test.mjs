import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const component=await readFile(new URL('../components/orbit/event-postpone.tsx',import.meta.url),'utf8');
const workspace=await readFile(new URL('../components/orbit/workspace.tsx',import.meta.url),'utf8');

test('event detail exposes a mobile postpone dialog with quick and direct choices',()=>{
 assert.match(workspace,/<EventPostpone/);
 for(const text of ['일정 미루기','하루 뒤','일주일 뒤','새 시작 날짜','새 시작 시간'])assert.ok(component.includes(text));
 assert.ok(component.includes('type="date"'));
 assert.ok(component.includes('type="time"'));
 assert.ok(component.includes('role="alert"'));
});

test('Google postponement reuses the official calendar edit read and save route',()=>{
 assert.ok(component.includes("clientRequest('/api/integrations/calendar/event?id='"));
 assert.ok(component.includes("clientRequest('/api/integrations/calendar/event','PATCH'"));
 assert.ok(component.includes('postponedCalendarEdit'));
});

test('postpone UI locks duplicate saves and closes only after a successful save',()=>{
 assert.ok(component.includes('if(lock.current)return'));
 assert.ok(component.includes('disabled={disabled||busy}'));
 assert.match(component,/await onSaved\([\s\S]*setOpen\(false\)/);
});
