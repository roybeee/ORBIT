export type InstallPlatform='mac'|'windows'|'android'|'ios'|'other';
export type InstallBrowser='safari'|'chrome'|'edge'|'other';
export type SupportedPlatform=Exclude<InstallPlatform,'other'>;
export const installPlatforms:readonly SupportedPlatform[]=['mac','windows','android','ios'];
export const platformLabels:Record<InstallPlatform,string>={mac:'Mac',windows:'Windows',android:'갤럭시 · Android',ios:'iPhone · iPad',other:'이 기기'};
export const browserLabels:Record<InstallBrowser,string>={safari:'Safari',chrome:'Chrome',edge:'Microsoft Edge',other:'브라우저'};
export function detectInstallEnvironment(input:{userAgent:string;platform?:string;maxTouchPoints?:number;userAgentData?:{platform?:string}}){
 const ua=input.userAgent,hint=input.userAgentData?.platform??input.platform??'';
 // iPad desktop mode reports MacIntel, so touch/iOS detection must come first.
 const platform:InstallPlatform=/iPad|iPhone|iPod/i.test(ua)||(/Mac/i.test(hint)&&Number(input.maxTouchPoints)>1)?'ios':/Android/i.test(ua+hint)?'android':/Windows|Win32|Win64/i.test(ua+hint)?'windows':/Macintosh|MacIntel|macOS|Mac OS X/i.test(ua+hint)?'mac':'other';
 const browser:InstallBrowser=/Edg(?:e|A|iOS)?\//.test(ua)?'edge':/OPR\/|SamsungBrowser\/|FxiOS\//.test(ua)?'other':/Chrome\/|CriOS\//.test(ua)?'chrome':/Safari\//.test(ua)?'safari':'other';
 return {platform,browser};
}
export function guideBrowser(platform:SupportedPlatform,browser:InstallBrowser):Exclude<InstallBrowser,'other'>{
 if(platform==='ios')return 'safari';
 if(platform==='android')return 'chrome';
 if(browser==='chrome'||browser==='edge')return browser;
 return platform==='mac'?'safari':'edge';
}
export const installRootUrl=(platform:SupportedPlatform,browser:InstallBrowser)=>'/?install='+platform+'&browser='+guideBrowser(platform,browser)+'#agent';
export function installGuide(platform:SupportedPlatform,requested:InstallBrowser){
 const browser=guideBrowser(platform,requested),desktop=platform==='mac'||platform==='windows';
 const launcher=platform==='mac'?'Dock 또는 Spotlight':platform==='windows'?'시작 메뉴 또는 작업표시줄':'홈 화면';
 const browserName=browserLabels[browser];
 const instructions=platform==='ios'?{
  menu:'공유 → 홈 화면에 추가',detail:'‘웹 앱으로 열기’가 보이면 켜고 ‘추가’를 누르세요.',
  source:'https://support.apple.com/ko-kr/guide/iphone/iphea86e5236/ios',
 }:platform==='android'?{
  menu:'Chrome ⋮ → 홈 화면에 추가 → 설치',detail:'페이지에 설치 버튼이 표시되면 그 버튼을 사용해도 됩니다. 메뉴 이름은 버전에 따라 다를 수 있습니다.',
  source:'https://support.google.com/chrome/answer/9658361?hl=ko&co=GENIE.Platform%3DAndroid',
 }:browser==='safari'?{
  menu:'Safari 메뉴 막대의 파일 → Dock에 추가',detail:'공유 메뉴의 ‘Dock에 추가’도 사용할 수 있습니다. 이름을 Orbit으로 두고 ‘추가’를 누르세요. macOS Sonoma 14 이상에서 지원합니다.',
  source:'https://support.apple.com/ko-kr/104996',
 }:browser==='edge'?{
  menu:'Edge … → 앱 → 이 사이트를 앱으로 설치',detail:'주소창에 앱 설치 아이콘이 보이면 눌러도 됩니다. 앱 이름을 Orbit으로 확인하고 설치하세요.',
  source:'https://support.microsoft.com/ko-kr/edge/install-manage-or-uninstall-apps-in-microsoft-edge',
 }:{
  menu:'Chrome ⋮ → 전송, 저장 및 공유 → 페이지를 앱으로 설치',detail:'주소창 오른쪽에 설치 아이콘이 보이면 눌러도 됩니다. 이름을 Orbit으로 확인하고 설치하세요.',
  source:'https://support.google.com/chrome/answer/9658361?hl=ko&co=GENIE.Platform%3DDesktop',
 };
 return {browser,desktop,launcher,source:instructions.source,steps:[
  {title:browserName+'에서 Orbit 열기',text:'아래 ‘Orbit 열고 설치’를 누르세요. 로그인이 필요하면 폰에서 사용하던 것과 같은 ChatGPT 계정으로 로그인합니다.'},
  {title:instructions.menu,text:instructions.detail},
  {title:launcher+'에서 Orbit 실행',text:platform==='windows'?'시작 메뉴에서 Orbit을 찾고, 자주 열 수 있도록 작업표시줄에 고정하세요. 독립된 앱 창에서 같은 기록을 이어갑니다.':platform==='mac'?'Dock의 Orbit 아이콘을 누르거나 Spotlight에서 Orbit을 검색하세요. 설치한 앱에서 로그인을 다시 요청하면 같은 계정을 사용합니다.':'홈 화면에 생긴 Orbit 아이콘을 눌러 실행하세요. 설치한 앱에서 로그인을 다시 요청하면 같은 계정을 사용합니다.'},
 ]};
}
