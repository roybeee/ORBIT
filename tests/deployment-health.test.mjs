import assert from 'node:assert/strict';
import test from 'node:test';
import {deploymentHealth} from '../lib/orbit/deployment-health.ts';

const token = '1234567890abcdef'.repeat(4); // Public test fixture, never provision it.
const build = '2026-09-22T01:23:45.678Z';
const request = (authorization) => new Request('https://fixture.invalid/api/deployment-health', {
  headers: authorization ? {Authorization: authorization} : {},
});

test('machine health rejects missing, malformed and incorrect credentials without leaking configuration', async () => {
  for (const authorization of [undefined, 'Basic '+token, 'Bearer short', 'Bearer '+'0'.repeat(64), 'Bearer '+token+'extra']) {
    const response = await deploymentHealth(request(authorization), token, build);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {error: 'Unauthorized'});
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
});

test('machine health fails closed when no strong release credential is configured', async () => {
  for (const configured of [undefined, '', 'short', 'x'.repeat(64), 123]) {
    const response = await deploymentHealth(request('Bearer '+token), configured, build);
    assert.equal(response.status, 401);
  }
});

test('valid machine credential returns only non-user release readiness and build data', async () => {
  const response = await deploymentHealth(request('Bearer '+token), token, build);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {status: 'ok', build});
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('vary'), /Authorization/);
});

test('a valid credential cannot report an invalid build as healthy', async () => {
  const response = await deploymentHealth(request('Bearer '+token), token, '<html>');
  assert.equal(response.status, 503);
});
