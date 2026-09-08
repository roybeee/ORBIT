import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
const source=readFileSync('vendor/orbit-sound/portable.html','utf8');
const manifest=JSON.parse(readFileSync('vendor/orbit-sound/manifest.json','utf8'));
if(createHash('sha256').update(source).digest('hex')!==manifest.sha256)throw Error('Sound source changed: review bridge seams before porting.');
let html=source;
function replaceOnce(from,to){if(html.split(from).length!==2)throw Error('Sound integration seam changed: '+from.slice(0,80));html=html.replace(from,to)}
replaceOnce('};(0,Z.useEffect)(()=>{if("mediaSession"in navigator){try{navigator.mediaSession.setActionHandler("play"','};'+readFileSync('components/orbit/sound/hook.js','utf8')+'(0,Z.useEffect)(()=>{if("mediaSession"in navigator){try{navigator.mediaSession.setActionHandler("play"');
replaceOnce('var jk=k(W(),1);',readFileSync('components/orbit/sound/bridge.js','utf8')+'\nvar jk=k(W(),1);');
replaceOnce('OL(await I.text()),','await OL(await I.text()),');
// Make unresolved cross-device/start failures recoverable, including active hydration.
replaceOnce('}catch(I){fs.current=null,Ze.error','}catch(I){fs.current=null,No.current=false,F(I instanceof Error?I.message:"Orbit 연결을 다시 확인해 주세요."),Ze.error');
// Sidebar expansion is a transient preference inside the sandbox, with no cookies.
replaceOnce(',document.cookie=`${Z8}=${h}; path=/; max-age=${J8}`','');
// User-facing storage copy must describe hosted behavior, not the original download.
const escape=text=>[...text].map(c=>c.charCodeAt(0)>127?'\\u'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'):c).join('');
replaceOnce(escape('다운로드 버전 2.0 ')+String.raw`\xB7 `+escape('오프라인 사용 가능'),escape('Orbit에 연결된 사운드스테이션'));
replaceOnce(escape('기록은 이 브라우저에 저장됩니다. 파일 이동 전 전체 백업을 저장하세요.'),escape('세션·즐겨찾기·루틴은 Orbit 계정에 저장됩니다. 기존 기록은 백업 불러오기로 가져오세요.'));
replaceOnce(escape('이 기기에 저장을 선택하면 계속 들을 수 있어요.'),escape('Orbit 연결을 확인하고 다시 연결을 눌러주세요.'));
replaceOnce(escape('탭이 열려 있는 동안 작동합니다. 모바일 화면 잠금')+String.raw`\xB7`+escape('전화')+String.raw`\xB7`+escape('브라우저 종료 시 재생이 멈출 수 있어요. 내려받은 파일은 인터넷 없이 재생됩니다. 기록은 이 브라우저에 보관되며 웹 버전과 자동 동기화되지 않습니다. 파일을 이동하거나 이름을 바꾸기 전에 전체 백업을 저장하세요. 저장이 제한된 브라우저에서는 창을 닫으면 기록이 사라질 수 있습니다.'),escape('Orbit 안에서 다른 화면으로 이동해도 재생이 유지됩니다. 화면 잠금, 전화, 앱 종료 시 기기에 따라 중단될 수 있습니다. 기록 저장에는 인터넷 연결이 필요하며, 다시 열면 저장된 세션을 이어 들을 수 있습니다. 기존 다운로드 버전의 기록은 백업 파일로 가져와 주세요.'));
replaceOnce('<title>ORBIT Sound 2.0 · 다운로드 버전</title>','<title>Orbit 사운드스테이션</title>');
// Embedded app keeps its own theme and has no network/parent-origin access.
replaceOnce('</head>','<style>.storage-banner{margin-top:0!important}body{overscroll-behavior-y:contain}button,a,input{touch-action:manipulation}</style></head>');
for(const script of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
mkdirSync('public/sound-station',{recursive:true});
writeFileSync('public/sound-station/index.html',html);
copyFileSync('vendor/orbit-sound/OPEN-SOURCE-NOTICES.txt','public/sound-station/OPEN-SOURCE-NOTICES.txt');
console.log('ORBIT Sound: preserved 24 scenes and audio engine; attached workspace storage and controls.');
