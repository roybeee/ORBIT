import test from 'node:test';
import assert from 'node:assert/strict';
import {focusElapsedSeconds,formatFocusClock} from '../lib/orbit/focus-clock.ts';

test('focus clock updates seconds and catches up after background suspension or reopening',()=>{
  const start='2026-09-19T10:00:00Z', now=Date.parse(start);
  assert.equal(formatFocusClock(focusElapsedSeconds(start,now)),'00:00:00');
  assert.equal(formatFocusClock(focusElapsedSeconds(start,now+1000)),'00:00:01');
  assert.equal(formatFocusClock(focusElapsedSeconds(start,now+90500)),'00:01:30');
  assert.equal(formatFocusClock(12*60+focusElapsedSeconds(start,now+3601000)),'01:12:01');
});
test('stopped, invalid and future sessions never produce negative or invalid elapsed time',()=>{
  for(const start of [undefined,'invalid','2099-01-01T00:00:00Z'])assert.equal(focusElapsedSeconds(start,Date.parse('2026-09-19T10:00:00Z')),0);
  assert.equal(formatFocusClock(0),'00:00:00');
  assert.equal(formatFocusClock(360000),'100:00:00');
});
