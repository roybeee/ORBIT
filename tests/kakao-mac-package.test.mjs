import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {unzipSync,strFromU8} from 'fflate';
import {kakaoPackage,SOURCE_FILES} from '../scripts/package-kakao.mjs';

test('Mac source package contains only the explicit source manifest and no runtime data',()=>{
 const files=unzipSync(kakaoPackage());
 assert.deepEqual(Object.keys(files).sort(),SOURCE_FILES.map(name=>'orbit-kakao-mac/'+name).sort());
 for(const name of Object.keys(files))assert.doesNotMatch(name,/\.env|\.build|connection\.json|transcript|\.jsonl|native$/);
 assert.match(strFromU8(files['orbit-kakao-mac/README.md']),/manual_only/);
});
test('Mac source package is byte-identical across process timezones',()=>{
 const code="import {createHash} from 'node:crypto';import {kakaoPackage} from './scripts/package-kakao.mjs';process.stdout.write(createHash('sha256').update(kakaoPackage()).digest('hex'))";
 const hashes=['UTC','Asia/Seoul'].map(TZ=>{const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('../',import.meta.url),env:{...process.env,TZ},encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout});
 assert.equal(hashes[0],hashes[1]);
});
