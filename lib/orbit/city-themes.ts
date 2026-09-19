import type {Preferences, View} from './model.ts';

export const illustrationIds = ['orbit','seoul','tokyo','los-angeles','new-york','singapore','hong-kong','shanghai','beijing','paris','london'] as const;
export type IllustrationId = typeof illustrationIds[number];
export const illustrationScreens = ['data','experiments','contacts','monthly','voice','portfolio','signals','meetings','followup','learning','backup','automation','aside','sound','agent','dashboard','goals','understanding','today','calendar','tasks','projects','wiki','knowledge','review','proposal'] as const satisfies readonly View[];
export interface IllustrationPreferences {
  defaultTheme: IllustrationId;
  screens: Partial<Record<View, IllustrationId>>;
  projects: Record<string, IllustrationId>;
}
export const defaultIllustrations = (): IllustrationPreferences => ({defaultTheme:'seoul',screens:{},projects:{}});
export const cityThemes = [
  {id:'seoul',name:'서울',english:'SEOUL',country:'대한민국',landmarks:'경복궁 · 남산 · 한강',accent:'#bba184'},
  {id:'tokyo',name:'도쿄',english:'TOKYO',country:'일본',landmarks:'도쿄 타워 · 센소지 · 시부야',accent:'#d8a49a'},
  {id:'los-angeles',name:'LA',english:'LOS ANGELES',country:'미국',landmarks:'그리피스 천문대 · 산타모니카',accent:'#e2bd86'},
  {id:'new-york',name:'뉴욕',english:'NEW YORK',country:'미국',landmarks:'맨해튼 · 센트럴 파크 · 브루클린',accent:'#9baea3'},
  {id:'singapore',name:'싱가포르',english:'SINGAPORE',country:'싱가포르',landmarks:'마리나 베이 · 슈퍼트리 · 머라이언',accent:'#a9c2a5'},
  {id:'hong-kong',name:'홍콩',english:'HONG KONG',country:'홍콩',landmarks:'빅토리아 하버 · 트램 · 스타페리',accent:'#a7bbbf'},
  {id:'shanghai',name:'상하이',english:'SHANGHAI',country:'중국',landmarks:'와이탄 · 동방명주 · 황푸강',accent:'#c6a38c'},
  {id:'beijing',name:'베이징',english:'BEIJING',country:'중국',landmarks:'자금성 · 천단 · 후통',accent:'#c99480'},
  {id:'paris',name:'파리',english:'PARIS',country:'프랑스',landmarks:'에펠탑 · 센강 · 루브르',accent:'#c7b6a6'},
  {id:'london',name:'런던',english:'LONDON',country:'영국',landmarks:'빅벤 · 타워 브리지 · 템스강',accent:'#9aadb4'},
] as const;
export const illustrationThemes = [
  ...cityThemes.map(city=>({...city,image:`/orbit-cities/${city.id}.webp`,thumbnail:`/orbit-cities/${city.id}-thumb.webp`})),
  {id:'orbit' as const,name:'오비트',english:'ORBIT',country:'나의 우주',landmarks:'행성 · 로켓 · 새로운 여정',accent:'#b7a4ff',image:'/orbit-worlds/mission.webp',thumbnail:'/orbit-worlds/mission.webp'},
];
export function illustrationTheme(id: IllustrationId) {
  return illustrationThemes.find(theme=>theme.id===id) ?? illustrationThemes[0];
}
export function screenIllustration(preferences: Preferences, view: View): IllustrationId {
  return preferences.illustrations?.screens[view] ?? preferences.illustrations?.defaultTheme ?? 'seoul';
}
export function projectIllustration(preferences: Preferences, id: string): IllustrationId {
  return (Object.hasOwn(preferences.illustrations?.projects ?? {},id) ? preferences.illustrations?.projects[id] : undefined) ?? screenIllustration(preferences,'projects');
}
