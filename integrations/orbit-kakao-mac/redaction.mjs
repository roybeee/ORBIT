// Shared by the local collector and the server, including manually supplied captures.
// Remove the whole message, since extracting just a guessed secret can leave part behind.
const AUTHENTICATION=/비밀\s*(?:번호|키)|패스\s*워드|핀\s*번호|(?:인증|확인|보안|로그인|일회용)[\s_-]*(?:번호|코드|토큰|키)|(?:접근|갱신)[\s_-]*토큰|(?:API|secret)[\s_-]*키|\b(?:OTP|2FA|PIN|password|passwd|passphrase|(?:verification|security|login|authentication|authorization)[\s_-]*(?:code|pin)|one[\s-]*time|api[\s_-]*(?:key|secret)|(?:access|refresh|auth(?:entication)?)[\s_-]*token|client[\s_-]*secret|secret|Bearer|token)\b|\b(?:sk-[a-zA-Z0-9_-]{8,}|AIza[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9_]{15,})\b/i;

/** Exclude messages with authentication markers before storage or remote analysis. */
export function redactSecrets(text){
 const normalized=text.normalize('NFKC').replace(/[\u200b-\u200d\ufeff]/g,'');
 return AUTHENTICATION.test(normalized)?'[인증 정보가 포함되어 분석에서 제외]':text;
}
