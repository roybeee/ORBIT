import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createKakaoBridge} from './bridge.mjs';
import {nativeAdapter} from './adapter.mjs';

if(process.platform!=='darwin')throw new Error('카카오톡 연결 프로그램은 macOS 전용입니다.');
const bridge=await createKakaoBridge({adapter:nativeAdapter});
const directory=join(homedir(),'.orbit-kakao');
mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
const connectionFile=join(directory,'connection.json');
writeFileSync(connectionFile,JSON.stringify({url:`http://127.0.0.1:${bridge.port}`,token:bridge.token},null,2)+'\n',{mode:0o600});chmodSync(connectionFile,0o600);
process.stdout.write('카카오톡 검토 연결 프로그램이 준비되었습니다.\n연결 정보 파일: '+connectionFile+'\n자동 방 이동은 비활성이며 대화·이미지는 로컬 파일에 저장하지 않습니다.\n');
const close=async()=>{await bridge.close();writeFileSync(connectionFile,'{}\n',{mode:0o600});process.exit(0)};
process.once('SIGINT',close);process.once('SIGTERM',close);
