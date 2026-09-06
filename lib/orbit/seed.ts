import type { Project,Task,Note,CalendarEvent } from './model';
export const initialProjects:Project[]=[
{id:'pizza',name:'옥수동 화덕피자',color:'#8981d7',symbol:'O',goal:'외대점 파일럿을 검증하고 가맹 표준모델 확정',due:'2026-09-18',priority:5},
{id:'ofd',name:'올드페리도넛 가맹',color:'#d6a56c',symbol:'F',goal:'첫 영업 미팅에 사용할 가맹 제안 자료 완성',due:'2026-09-11',priority:4},
{id:'mapdal',name:'맵달 서울',color:'#6ba69c',symbol:'M',goal:'라이브커머스 협업의 실행 계획 확정',due:'2026-09-15',priority:4},
{id:'orbit',name:'나의 매니지먼트 앱',color:'#768fe0',symbol:'O',goal:'폰에서 오늘의 업무와 프로젝트를 관리',due:'2026-09-13',priority:5},
];
export const initialTasks:Task[]=[
{id:'t1',title:'화덕피자 파일럿 운영안 확정',projectId:'pizza',status:'doing',duration:60,due:'2026-09-06',impact:5,focus:true,definition:'인력 운영 · 메뉴 구성 · 원가 가정이 담긴 원페이지 운영안',noteId:'n1'},
{id:'t2',title:'가맹 영업자료 목차와 우선순위 정리',projectId:'ofd',status:'todo',duration:45,due:'2026-09-07',impact:4,focus:true,definition:'영업자료 8종의 목차와 제작 순서가 담긴 체크리스트',noteId:'n2'},
{id:'t3',title:'개인 매니지먼트 앱 설계도 완성',projectId:'orbit',status:'todo',duration:90,due:'2026-09-06',impact:5,focus:true,definition:'핵심 화면 · 데이터 구조 · 1차 개발 범위를 포함한 설계서',noteId:'n3'},
{id:'t4',title:'협업사 운영 인력 계획 확인',projectId:'mapdal',status:'waiting',duration:20,due:'2026-09-07',impact:4,focus:false,definition:'역할별 인원과 투입 일정 확인',blocker:'운영 인력 계획 회신 대기',noteId:'n4'},
{id:'t5',title:'브랜드 서브네임 후보 검토',projectId:'pizza',status:'done',duration:30,due:'2026-09-06',impact:3,focus:false,definition:'최종 후보 3개와 선정 기준',completedOn:'2026-09-06',noteId:'n1'},
{id:'t6',title:'프로젝트별 이번 주 결과물 정리',projectId:'orbit',status:'done',duration:20,due:'2026-09-06',impact:4,focus:false,definition:'프로젝트별 결과물 1개와 마감일',completedOn:'2026-09-06'},
{id:'t7',title:'파일럿 검증 체크리스트 작성',projectId:'pizza',status:'todo',duration:45,due:'2026-09-08',impact:4,focus:false,definition:'수익성 · 작업 시간 · 고객 반응의 검증 기준',dependsOn:['t1'],noteId:'n1'},
{id:'t8',title:'라이브커머스 실행 일정 초안',projectId:'mapdal',status:'todo',duration:45,due:'2026-09-09',impact:3,focus:false,definition:'준비 · 리허설 · 첫 방송 일정을 연결한 실행표',dependsOn:['t4'],noteId:'n4'},
];
export const initialNotes:Note[]=[
{id:'n1',title:'화덕피자 · 파일럿 운영 회의',kind:'meeting',projectId:'pizza',summary:'운영 인력, 메뉴 구성, 가맹 표준모델을 연결한 검토 메모.',body:'[설계 시안용 예시 회의록]\n\n목표\n비용과 운영 난이도를 낮춘 파일럿 운영안을 완성한다.\n\n검토할 내용\n1. 운영 시간대별 필요한 인력을 산출한다.\n2. 핵심 메뉴의 원가와 작업 시간을 기록한다.\n3. 파일럿에서 검증할 수치를 정한다.\n\n미결정\n운영 인력과 메뉴 구성을 확정해야 한다.\n\n다음 행동\n원페이지 운영안을 정리하고 회의에서 결정한다.\n\n위 내용은 화면 검토를 위한 샘플이며 실제 회의록을 가져온 것이 아닙니다.',tags:['운영','파일럿','의사결정'],updated:'2026-09-06'},
{id:'n2',title:'가맹 영업자료 제작 메모',kind:'meeting',projectId:'ofd',summary:'가맹 희망자가 결정을 내리는 순서에 맞춰 자료를 구성한다.',body:'[설계 시안용 예시]\n\n목표\n가맹 희망자가 브랜드와 운영 구조를 쉽게 이해하도록 돕는다.\n\n다음 행동\n자료의 목차와 제작 우선순위를 정한다.\n\n완료 기준\n영업 미팅에서 설명할 흐름과 필요한 자료 목록이 준비되어 있다.',tags:['가맹','세일즈'],updated:'2026-09-05'},
{id:'n3',title:'나의 업무 운영 원칙',kind:'wiki',projectId:'orbit',summary:'매일 끝낼 결과물에 집중하고, 중요한 결정에는 근거를 남긴다.',body:'[제안하는 개인 운영 원칙]\n\n1. 하루의 핵심 결과물은 최대 3개로 정한다.\n2. 할 일에는 완료 기준을 적는다.\n3. 회의가 끝나면 결정과 다음 행동을 분리한다.\n4. 막힌 일에는 해결 조건과 다음 확인일을 둔다.\n5. 저녁에는 계획과 실제의 차이를 기록한다.\n6. 내일 계획은 내가 승인한 뒤 확정한다.\n\n개인 위키는 이런 운영 원칙과 프로젝트의 현재 사실을 축적하는 공간이다.',tags:['개인 원칙','실행'],updated:'2026-09-06'},
{id:'n4',title:'라이브커머스 · 협업 체크포인트',kind:'meeting',projectId:'mapdal',summary:'역할과 투입 일정이 정리되면 실행 계획으로 연결한다.',body:'[설계 시안용 예시]\n\n확인할 내용\n운영 인력별 역할과 투입 가능일\n\n현재 대기\n협업사의 운영 계획 회신\n\n후속 행동\n회신을 확인한 뒤 실행 일정 초안을 만든다.',tags:['협업','후속 확인'],updated:'2026-09-05'},
{id:'n5',title:'실행 의도: 언제, 어디서, 무엇을',kind:'knowledge',projectId:'orbit',summary:'추상적인 목표를 구체적인 행동의 시간과 장소로 바꿔 본다.',body:'[지식 카드 형식 예시 · 원문 미연결]\n\n핵심 아이디어\n하고 싶은 일을 실행할 상황과 함께 적는다.\n\n내 업무에 적용\n“기획을 해야 한다”를 “내일 오전 집중 시간에 운영안 1장을 작성한다”로 구체화한다.\n\n연결된 활용처\n내일 제안의 시간 배치와 완료 기준\n\n원문 자료는 정식 서비스에서 URL 또는 파일로 연결한다.',tags:['실행','행동 설계'],updated:'2026-09-06'},
{id:'n6',title:'원페이지로 의사결정 준비하기',kind:'knowledge',projectId:'ofd',summary:'배경, 선택지, 판단 기준, 추천안을 한 장에 모은다.',body:'[지식 카드 형식 예시]\n\n구성\n1. 이번에 결정해야 할 문제\n2. 가능한 선택지\n3. 비용과 기대 효과\n4. 추천안과 다음 행동\n\n적용\n가맹 영업자료와 협업 제안의 주요 결정을 준비할 때 사용한다.',tags:['의사결정','문서'],updated:'2026-09-05'},
{id:'n7',title:'파일럿 실험을 설계하는 질문',kind:'knowledge',projectId:'pizza',summary:'무엇이 맞으면 확대하고, 무엇이 틀리면 바꿀 것인가?',body:'[지식 카드 형식 예시]\n\n실험 전 질문\n검증할 가설은 무엇인가?\n어떤 관측값을 수집할 것인가?\n성공과 중단 기준은 무엇인가?\n누가 언제 결과를 확인할 것인가?\n\n적용할 프로젝트\n화덕피자 외대점 파일럿',tags:['실험','운영'],updated:'2026-09-04'},
];
export const initialEvents:CalendarEvent[]=[
{id:'e1',title:'이번 주 프로젝트 정리',date:'2026-09-06',start:570,end:600,kind:'focus',projectId:'orbit',taskId:'t6'},
{id:'e2',title:'화덕피자 후속 미팅',date:'2026-09-06',start:660,end:720,kind:'meeting',projectId:'pizza'},
{id:'e3',title:'앱 설계 · 집중 시간',date:'2026-09-06',start:840,end:930,kind:'focus',projectId:'orbit',taskId:'t3'},
{id:'e4',title:'저녁 회고',date:'2026-09-06',start:1260,end:1275,kind:'break'},
{id:'e5',title:'프로젝트 체크인',date:'2026-09-07',start:660,end:690,kind:'meeting'},
{id:'e6',title:'점심 · 재충전',date:'2026-09-07',start:720,end:780,kind:'break'},
];
