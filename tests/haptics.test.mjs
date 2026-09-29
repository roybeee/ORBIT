import test from 'node:test';
import assert from 'node:assert/strict';

let moduleId = 0;
async function browser(t, options = {}) {
 const calls = [];
 let now = 0;
 const matchMedia = () => ({ matches: options.reducedMotion ?? false });
 const vibrate = options.vibrate ?? (duration => { calls.push(duration); return true; });
 const values = {
  navigator: options.unsupported ? {} : { vibrate },
  document: { hidden: options.hidden ?? false, visibilityState: options.hidden ? 'hidden' : 'visible' },
  performance: { now: () => now },
  window: { matchMedia },
  matchMedia,
 };
 for (const [key, value] of Object.entries(values)) {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
   if (original) Object.defineProperty(globalThis, key, original);
   else delete globalThis[key];
  });
 }
 const { haptic } = await import(`../lib/orbit/haptics.ts?test=${moduleId++}`);
 return { haptic, calls, advance: milliseconds => { now += milliseconds; } };
}

test('default button feedback vibrates for 10ms even at clock zero', async t => {
 const { haptic, calls } = await browser(t);
 assert.equal(haptic(), true);
 assert.deepEqual(calls, [10]);
});

test('explicit tap feedback vibrates for 10ms', async t => {
 const { haptic, calls } = await browser(t);
 assert.equal(haptic('tap'), true);
 assert.deepEqual(calls, [10]);
});

test('page selection feedback vibrates for 18ms', async t => {
 const { haptic, calls } = await browser(t);
 assert.equal(haptic('selection'), true);
 assert.deepEqual(calls, [18]);
});

test('long press feedback vibrates for 18ms', async t => {
 const { haptic, calls } = await browser(t);
 assert.equal(haptic('hold'), true);
 assert.deepEqual(calls, [18]);
});

test('different feedback kinds share the 80ms duplicate suppression window', async t => {
 const { haptic, calls, advance } = await browser(t);
 assert.equal(haptic('tap'), true);
 advance(79);
 assert.equal(haptic('selection'), false);
 advance(1);
 assert.equal(haptic('hold'), true);
 assert.deepEqual(calls, [10, 18]);
});

test('unsupported browsers return false without throwing', async t => {
 const { haptic } = await browser(t, { unsupported: true });
 assert.equal(haptic(), false);
});

test('browser refusal returns false and does not suppress a subsequent accepted vibration', async t => {
 let attempts = 0;
 const { haptic } = await browser(t, { vibrate: () => ++attempts > 1 });
 assert.equal(haptic(), false);
 assert.equal(haptic(), true);
 assert.equal(attempts, 2);
});

test('browser exceptions return false and do not suppress a subsequent accepted vibration', async t => {
 let attempts = 0;
 const { haptic } = await browser(t, { vibrate: () => {
  if (++attempts === 1) throw new Error('Vibration denied');
  return true;
 } });
 assert.equal(haptic(), false);
 assert.equal(haptic(), true);
 assert.equal(attempts, 2);
});

test('hidden documents do not request vibration', async t => {
 const { haptic, calls } = await browser(t, { hidden: true });
 assert.equal(haptic(), false);
 assert.deepEqual(calls, []);
});

test('reduced motion preference prevents vibration', async t => {
 const { haptic, calls } = await browser(t, { reducedMotion: true });
 assert.equal(haptic(), false);
 assert.deepEqual(calls, []);
});

test('server rendering without browser globals returns false', async t => {
 for (const key of ['window', 'navigator', 'document', 'matchMedia']) {
  const original = Object.getOwnPropertyDescriptor(globalThis, key);
  delete globalThis[key];
  t.after(() => {
   if (original) Object.defineProperty(globalThis, key, original);
  });
 }
 const { haptic } = await import(`../lib/orbit/haptics.ts?test=${moduleId++}`);
 assert.equal(haptic(), false);
});
