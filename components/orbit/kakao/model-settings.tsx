'use client';
import {useState} from 'react';
import {agentRequest} from '../agent/connections';

export function KakaoModelSettings({onChanged,disabled}:{onChanged:()=>Promise<void>;disabled:boolean}){
 const [provider,setProvider]=useState('anthropic'),[apiKey,setApiKey]=useState(''),[model,setModel]=useState(''),[pending,setPending]=useState(false),[notice,setNotice]=useState('');
 const run=async(remove=false)=>{
  if(pending||disabled)return;
  setPending(true);setNotice('');
  try{await agentRequest('/api/integrations/kakao/model',remove?'DELETE':'POST',remove?undefined:{provider,apiKey,model});setApiKey('');await onChanged();setNotice(remove?'전용 분석 연결을 해제했습니다.':'전용 분석 연결 설정을 저장했습니다. 실제 분석 응답은 검토 실행 시 확인합니다.');}
  catch(error){setNotice(error instanceof Error?error.message:'분석 연결을 저장하지 못했습니다.')}
  finally{setPending(false)}
 };
 return <details className="kakao-model-settings"><summary>분석 연결 설정</summary><p className="form-hint">검토한 대화가 선택한 분석 서비스로 전송됩니다. 이 연결에는 카카오톡·메일·외부 실행 도구를 제공하지 않습니다. 기존 API 키를 사용할 수 있으며, 서비스 사용료는 해당 계정에 적용됩니다.</p>
  <form className="dialog-form" onSubmit={event=>{event.preventDefault();void run();}}>
   <label>분석 서비스<select className="form-field" value={provider} onChange={event=>{setProvider(event.target.value);setApiKey('');setModel('');}}><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label>
   <label>분석 모델<input className="form-field" value={model} onChange={event=>setModel(event.target.value)} maxLength={100} placeholder="사용 중인 API 모델 ID" required spellCheck={false}/></label>
   <label>분석 API 키<input className="form-field" type="password" value={apiKey} onChange={event=>setApiKey(event.target.value)} maxLength={500} autoComplete="new-password" spellCheck={false} required/></label>
   <p className="form-hint">API 키는 서버에 암호화해 보관합니다. Mac 연결 키와 별개입니다. 전용 연결을 해제해도 서버의 기본 분석 연결이 있으면 사용할 수 있습니다.</p>
   <div className="chief-actions"><button className="secondary-button" disabled={disabled||pending||!apiKey.trim()||!model.trim()}>분석 연결 저장</button><button type="button" className="text-button" disabled={disabled||pending} onClick={()=>void run(true)}>전용 분석 연결 해제</button></div>
  </form>{notice&&<p role="status">{notice}</p>}
 </details>;
}
