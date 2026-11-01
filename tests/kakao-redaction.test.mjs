import test from 'node:test';
import assert from 'node:assert/strict';
import {redactSecrets} from '../integrations/orbit-kakao-mac/redaction.mjs';
import {redactSecrets as serverRedact} from '../lib/orbit/kakao/validation.ts';

const samples=[
 '카카오톡 인증번호는 [123456]입니다.','Your verification code is 123456',
 'Bearer abcdefghijklmnop','비밀번호는 SuperSecret123!','확인번호는 123456입니다.',
 'passwd = SyntheticPass123!','client_secret: synthetic-only-secret-value',
 'passphrase is Synthetic Words','OTP [123456]','2FA: 123456','login code: 123456',
 'API key = synthetic-only-key','API 키는 synthetic-only-key',
 'sk-ant-synthetic-test-only-not-a-real-key','sk-proj-synthetic-test-only-not-a-real-key',
 '보안 번호 [123456]','access_token=synthetic-token','refresh token=synthetic-token',
 '비밀\u200b번호: SyntheticPass','ＰＡＳＳＷＯＲＤ: SyntheticPass',
];
test('local and server use one complete-message exclusion rule for every authentication marker',()=>{
 for(const sample of samples){
  assert.equal(redactSecrets(sample),'[인증 정보가 포함되어 분석에서 제외]',sample);
  assert.equal(serverRedact(sample),redactSecrets(sample));
 }
});
test('ordinary appointment details survive the privacy boundary unchanged',()=>{
 const normal='내일 오후 3시부터 오후 4시까지 보고서 검토 회의 확정';
 assert.equal(redactSecrets(normal),normal);
});
