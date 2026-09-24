## 2026-09-24 · AI 사용량 한도가 소진되면 분석이 실패 대신 대기했다가 자동으로 이어집니다

- AI 제공자의 사용량 한도가 소진되면(429, `quota exhausted` 등) 그 사실을 제공자별로 한 곳에 기록합니다. 이후 회의 분석과 일일 계획은 **새로 호출하지 않고 ‘사용량 회복 대기’**로 보존되며, 회의 하나하나가 같은 오류로 차례로 실패하던 연쇄가 멈춥니다. 원문·기존 결재 카드·규칙 기반 기본 계획은 그대로 남습니다.
- 인증 오류와 한도를 구분하고, 한도는 **일시적 요청 제한**(재시도 대기 15분 이하)과 **장기 소진**으로 나눕니다. 재시도 시각을 알려주면 그 시각에, 모르면 30분부터 최대 6시간까지 간격을 늘려(±20% 분산) 다시 확인합니다.
- 다시 확인할 때는 대기 작업 **한 건만** 실제로 실행해 회복 여부를 봅니다(동시에 하나만). 성공하면 대기가 풀리고 멈춘 지점부터 한 건씩 순서대로 재개하며, 같은 회의의 결재 카드는 다시 만들지 않습니다. 사용자가 중지한 작업은 자동으로 재개하지 않습니다.
- 대기 중에는 회의별 ‘회의 분석 실패’ 알림 대신 **‘AI 분석 대기 중’ 알림 1건**을 보내고, 회복되면 ‘AI 분석 재개’를 알립니다. 오늘 화면에는 대기 중일 때만 얇은 배너(다음 확인 시각·대기 작업 수, 현재 계획 보기·대기 작업 보기)가 나타납니다.
- 직접 보내는 대화는 막지 않고 ‘실패할 수 있음’ 경고와 함께 보냅니다. 그 요청이 성공하면 대기가 풀립니다. 모델 변경·추가 과금·계정 전환은 자동으로 하지 않습니다.
- 효과 확인용으로 `GET /api/ai-hold`가 대기 에피소드별 복구 확인 호출 수, 대기 이후 새어 나간 같은 원인 호출 수, 대기했던 작업 중 재지시 없이 완료된 수(한도가 실제로 회복된 에피소드만), 최근 7일 한도 실패 건수를 보여줍니다.

## 2026-09-24 · 작은 실험의 결과가 다음 계획의 규칙으로 이어집니다

- 실험의 시작 값을 **‘아직 측정 전’**으로 둘 수 있습니다. 이때는 0으로 저장하지 않고 ‘기준값 측정 필요’ 단계부터 시작하며, 측정한 기준값과 근거를 기록해야 결과와 비교됩니다(`experiment.baseline`).
- 종료일이 되면 오늘 화면의 ‘확인할 제안’에 **검토할 실험**이 뜹니다. 결과를 기록하면 규칙으로 **계속 적용 / 수정해서 재시도 / 중단** 중 하나를 제안하고 근거(기준 → 측정, 목표, 기간)를 보여줍니다. 결정은 사용자가 하며(`experiment.decide`), 짧은 관찰로 인과를 확정하지 않는다고 함께 표시합니다.
- ‘계속 적용’을 고르면 기존 개선 규칙(★)에 **어느 실험에서 왔는지**와 함께 저장됩니다. ‘회의 뒤 여유시간’으로 지정한 규칙은 **계획 엔진이 직접** 회의 뒤 N분을 비워 두고 배치합니다(이동 시간 설정 뒤에 이어서). 다른 규칙은 원페이지 분석에 `rule:` 근거로 전달되어 인용할 수 있습니다.
- 내일 제안 화면에 **이 계획에 적용한 규칙**이 표시됩니다. 출처 실험으로 이동하거나 규칙을 해제할 수 있고, 해제하면 다음에 만드는 계획부터 빠집니다. ‘재시도’는 이전 실험과 연결된 새 실험 초안을 엽니다.
- 최근 14일 실행 기록에서 같은 미완료 사유가 3회 이상 나오면 실험 화면에 **반복되는 문제** 후보로 보여주고, 기록 기준 시작 값이 채워진 초안이나 Hermes 설계 요청으로 이어집니다. 원인이 확인됐다는 뜻은 아닙니다.

## 2026-09-24 · 1분 회고가 기록의 근거를 붙여 결과를 확인합니다

- 1분 회고를 열면 회의록·Slack으로 등록한 기록·메일·위임 기록·집중 타이머에서 **결과 후보를 미리 찾아 원문 근거와 함께** 보여줍니다. 이미 기록된 결과는 ‘확정’, 기록 문구로 추정한 결과는 ‘추정 · 확인 필요’로 구분합니다. 추정은 규칙으로만 만들며 AI 모델을 부르지 않습니다.
- 결과마다 **맞음 · 수정 · 아직 모름**으로 답하고, 바꾼 답은 ‘되돌리기’로 처음 상태로 돌릴 수 있습니다. 답하지 않았거나 ‘아직 모름’인 결과는 완료·실패로 저장하지 않고 할 일 상태도 그대로 둡니다.
- 결과 옆에서 **실제 소요시간**을 확인합니다. 집중 타이머 기록은 불러오고, 모르면 ‘미확인’으로 남깁니다. 캘린더에 잡힌 시간은 실제 수행시간으로 쓰지 않습니다.
- 저장 직후 내일 제안 화면에 **이 회고가 내일 계획에 어떻게 반영되는지** 표시합니다(내일 후보에서 빠지는 일, 이어 할 일, 외부 대기 업무의 다음 날 ‘확인 필요’ 표시, 예상시간 보정 표본 진행). 외부 대기로 끝나지 않은 일은 다음 날 확인 필요 목록에 올라갑니다.
- 같은 결과가 두 번 기록되지 않습니다. 한 회고에 같은 할 일이 두 번 들어오면 저장을 거절하고, 지난 날짜 회고를 같은 내용으로 다시 저장해도 실행 기록이 쌓이지 않습니다.
- 효과 확인용으로 회고마다 보여준 후보 수·확인 수·걸린 시간(내용 없이 숫자만)을 저장하고, 회고 화면 오른쪽에 **첫 7일과 다음 7일의 결과 확인 비율과 확인 시간**을 비교해 보여줍니다.

## 2026-09-24 · 이전 계획을 근거로 인용해도 보정 턴을 쓰지 않습니다

- 모델이 이전 계획(`plan:날짜`)이나 비서 맥락(`chief:`)을 근거 ID로 적으면, 기록이 아니라 맥락이라 근거 검증에서 거부되고 보정 턴 1회(약 1~2분)를 소모했습니다. 실제 9/24 계획 실행에서 발생했습니다.
- 이제 해당 항목에 실제 기록 근거가 하나라도 있으면 맥락 인용만 조용히 제외하고 경고로 표시합니다. 맥락만 인용한 항목은 예전처럼 정확한 ID를 다시 요청합니다. 계획 지시문에도 허용되는 근거 ID 종류를 명시했습니다.

## 2026-09-24 · 분석 중에 기록이 추가되어도 계획이 완성됩니다

- 전체 자료 분석(약 30분)이 진행되는 동안 Plaud 회의록이나 Hermes 대화가 몇 분마다 추가되면, 지금까지는 그때마다 처음부터 다시 분석했고 두 번 넘게 바뀌면 '분석 중 관련 기록이 계속 변경되고 있습니다'로 끝났습니다. 실제로 9/24 계획이 이 이유로 두 번 실패했습니다.
- 이제 계획은 **분석을 시작한 시점의 기록을 기준으로 완성**되고, 그 사이 무엇이 바뀌었는지(노트 +2, 일정 +1 등)를 커버리지 경고로 표시합니다. 변경분은 다음 실행에서 증분 분석으로 반영됩니다. 우선순위를 승인할 때 대상 기록을 다시 검사하는 동작은 그대로입니다.

## 2026-09-24 · 근거 ID 오타 한 글자에 전체 분석이 끝나지 않습니다

- 최종 실행안이 인용한 근거 ID가 기록에 없으면(실제 사례: 회의록 ID 32자 중 한 글자가 다르게 적힘) 지금까지는 수십 분 걸린 분석 전체가 그 자리에서 실패했습니다. 이제 회의 결재안처럼 **어느 ID가 확인되지 않았는지 알려주고 정확한 ID로 다시 받습니다**(최대 2회).
- 그래도 확인되지 않는 근거를 계속 인용하면 예전처럼 해당 ID를 이름 붙여 실패로 끝냅니다. 없는 기록을 지어낸 인용은 여전히 통과하지 않습니다.

## 2026-09-24 · 원인 모를 실패의 실제 오류를 보여줍니다

- 에이전트 실행이 저장소 오류나 내부 예외처럼 **정해진 오류 종류가 아닌 이유**로 실패하면, 지금까지는 '응답을 완료하지 못했습니다'로만 표시되어 원인을 알 수 없었습니다. 이제 실제 오류 이름과 문구(300자까지)를 함께 표시하고, 서버 로그에도 실행 ID·단계·스택과 함께 기록합니다.
- 회의 분석의 같은 경우도 '연결 상태를 확인해 주세요' 대신 실제 오류를 보여줍니다. 규칙 기반 기본 계획으로 대체하는 동작은 그대로입니다.

## 2026-09-24 · 실재하는 기록을 인용했다고 분석이 중단되지 않습니다

- 전체 자료 분석에서 **실제로 존재하는 기록을 인용했는데도** 근거 검증에 걸려 분석 전체가 실패하던 문제를 고쳤습니다. 한 달치 일정처럼 기록이 많은 묶음은 요약에 25건이 담겨도 다음 단계로 넘길 수 있는 근거는 16건까지라, 요약 안에만 남은 기록을 통합 단계가 인용하면 '없는 근거'로 판정됐습니다.
- 이제 **모델에게 실제로 보여준 내용에 있는 기록**이면 인용을 인정합니다. 보여준 적 없는 기록을 지어낸 경우는 지금처럼 거부하며, 다른 기록의 앞부분만 일치하는 값도 통과하지 않습니다.
- 저장된 분석을 재사용할 때도 같은 기준을 적용해, 정상적인 분석 결과가 캐시에서 버려지지 않습니다.

## 2026-09-24 · 거부된 근거가 어느 묶음에서 나왔는지 알려줍니다

- 전체 자료 분석에서 중간 결과의 근거가 원본과 맞지 않아 거부될 때, 이제 **어느 묶음의 몇 번째 조각인지와 실제로 문제가 된 근거 값**을 함께 표시합니다. 이전에는 이유만 있고 대상이 없어, 천 개가 넘는 묶음 중 무엇이 계속 실패하는지 알 수 없었습니다.

## 2026-09-23 · 한 묶음의 응답 오류가 전체 분석을 끝내지 않습니다

- 전체 자료 분석 중 한 묶음의 결과가 **그 묶음에 없는 근거를 인용**하거나 형식이 어긋나면, 지금까지는 분석 전체가 그 자리에서 실패로 끝났습니다. 이제 그 묶음만 새 세션으로 다시 받고(최대 2회) 나머지는 그대로 이어갑니다.
- 같은 묶음이 계속 실패하면 예전처럼 실행을 끝내고 이유를 그대로 알립니다. 무한 재시도는 하지 않습니다.
- 이미 분석한 묶음은 원래도 보존됐지만, 이제는 실행 자체가 살아남아 사람이 다시 걸어줄 필요가 없습니다.

## 2026-09-23 · 최신 자료부터 분석합니다

- 전체 자료 분석이 **최근 기록부터 과거 순서로** 진행됩니다. 지금까지는 자료 종류의 이름순(대화 → 완료업무 → 일정 → 회의록 …)으로 훑어서, 분석이 중간에 멈추면 몇 달 전 대화만 저장되고 정작 최근 자료는 손도 못 댄 상태로 남았습니다.
- 프로젝트와 진행 중인 할 일, 결정·위임·기억처럼 날짜가 없는 '현재 상태'를 가장 먼저 봅니다. 그 다음이 최신 날짜 순입니다.
- 분석 결과 캐시는 내용으로 식별하므로 순서가 바뀌어도 이미 분석한 자료를 다시 보내지 않습니다.
- 기록 목록(manifest)이 처리 순서에 따라 달라지던 것도 함께 고쳤습니다. 이 변경 직후 한 번은 기록이 바뀐 것으로 집계될 수 있습니다.

## 2026-09-23 · 알림 삭제가 실제로 지워집니다

- 알림함에서 **×**를 눌러도 카드가 그대로 남아 있던 문제를 고쳤습니다. 같은 제목의 알림(예: '회의 분석 실패')이 떨어진 위치에서 여러 번 묶일 때 묶음 식별자가 서로 겹쳐, 화면이 실제 목록과 다른 자리에 카드를 그리고 지운 카드가 살아남는 것처럼 보였습니다. 서버는 정상적으로 삭제하고 있었습니다.
- 같은 이유로 '같은 알림 더 보기'를 누르면 제목이 같은 다른 묶음까지 함께 펼쳐지던 것도 함께 해결됩니다.

## 2026-09-23 · Slack 업무지시 확인이 날짜 때문에 '변경됨'이 되지 않습니다

- Slack에서 넘어온 지시로 만든 지식 기록을 다시 확인할 때, 서버가 찍은 기록 날짜와 지시에 적힌 날짜가 다르다는 이유로 **변경됨**으로 표시하던 문제를 고쳤습니다. 기록 날짜는 저장 시점에 서버가 정하므로 지시의 날짜와 애초에 같을 수 없었고, 그래서 어제 날짜의 메시지를 오늘 정리하거나 자정에 걸쳐 저장된 지시는 방금 저장하고도 곧바로 변경됨으로 보였습니다.
- 확인은 이제 실제로 기록한 내용(종류·프로젝트·제목·본문)만 비교합니다. 기록이 실제로 수정되거나 삭제되면 지금처럼 **변경됨**·**대상 없음**으로 알립니다.

## 2026-09-23 · 분석이 실패해도 그 날 계획은 남는다

- 연결된 Hermes의 계획 분석이 끝내 실패하면(프로바이더 사용량 한도 소진, 인증 실패, 30분 초과, 전송 오류) 그 날짜를 규칙 기반 기본 계획으로 대신 채웁니다. 지금까지는 Hermes를 아예 연결하지 않은 경우에만 규칙 기반 계획이 나왔고, 실행 도중 실패하면 계획 없이 '실패'로만 끝났습니다.
- 이미 그 날짜에 계획이 있으면 덮어쓰지 않습니다. 사용자가 중지한 실행도 계획을 만들지 않습니다.
- 사용량 한도가 소진된 실행은 분량을 줄여 다시 보내지 않습니다. 같은 카탈로그를 세 번 더 보내도 한도는 회복되지 않기 때문이며, 오류 문구도 'API 키 확인' 대신 한도 소진을 그대로 알립니다.
- 계획이 생긴 날짜는 자동 실행이 다시 대기열에 넣지 않습니다.

## 2026-09-22 증분 분석과 계획 준비 상태

- 원문 묶음과 통합 단계의 분석 결과를 소유자별 `orbit_analysis_cache`에 입력 내용 해시로 저장하고, 내용이 같은 묶음은 Hermes에 다시 보내지 않습니다(마이그레이션 0029). 수정·삭제된 기록은 해당 단위와 그 상위 통합만 다시 분석하며, 분석 지시문이 바뀌면 전체를 다시 분석합니다. 캐시는 백업·내보내기에 포함하지 않습니다.
- 최종 합성은 목표·규칙·일정·운영 신호·후속 확인·최근 계획(frame)을 매번 새로 받고, 이전 게시 이후 추가·수정·삭제된 기록 그룹(changes)을 함께 받습니다. 원문 묶음 분석은 계획 날짜와 무관하게 절대 날짜를 유지합니다.
- 홈 화면에 자료 수집 → 계획 분석 → 계획 준비 완료 3단계와 반영 기준 시각·미확인 자료·마지막 진행 시각, 최근 7일 준비 기록(시작·준비 완료·소요·아침 7시 전 준비·재사용·Hermes 호출)을 표시합니다(`GET /api/brief/status`, `orbit_brief_runs`).
## 2026-09-22 · 기존 할 일·일정으로 통합

- 회의 결재 카드의 **다른 일정과 통합**에서 승인 대기 결재안뿐 아니라 **이미 등록된 할 일·일정**도 고를 수 있습니다. 기존 항목을 고르면 카드가 그 항목의 수정안으로 바뀌고, 승인하면 기존 항목이 갱신됩니다(제목은 기존 항목을 유지, 완료 기준·메모에 `[통합]`으로 덧붙임, 예상 시간 합산·영향도 최대·더 빠른 마감일, 같은 날 일정은 시간 이어 붙임).
- 마감일 미정 카드는 기존 할 일의 마감일을 이어받습니다. 완료된 할 일에는 통합할 수 없습니다. 통합 후 기존 항목이 다른 곳에서 바뀌면 승인이 차단되고 재분석을 안내합니다.
- 후보 목록: 미완료 할 일 전체, 최근 30일 이후의 로컬 일정(Google·집중 시간·마감 표시 제외). `POST /api/meetings/review/merge`는 `target:{kind:'proposal'|'task'|'event',id}`를 받습니다.

## 2026-09-22 · 회의 결재안 통합

- 회의 요약·결재 카드에 **다른 일정과 통합** 버튼을 추가했습니다. 같은 분석에서 나온 같은 종류(할 일끼리, 일정끼리)의 승인 대기 카드를 골라 하나로 합친 뒤 한 번만 승인해 등록합니다.
- 할 일은 완료 기준·근거를 이어 붙이고 예상 시간을 더하며(최대 480분), 영향도는 큰 값을, 마감일은 더 빠른 날짜를 씁니다. 마감일 미정 카드는 상대 카드의 마감일을 이어받고, 둘 다 미정이면 승인 전 날짜 지정이 그대로 필요합니다. 같은 날 일정은 시작·종료 시간을 이어 붙입니다.
- 합쳐진 카드는 **통합됨**으로 표시되고 원래 제안 내용을 보존해 다시 분석해도 되살아나지 않습니다. 통합 후에도 원문 변경·대상 변경 검증은 그대로 적용됩니다(`POST /api/meetings/review/merge`).

## 2026-09-20 전체 자료 분석

- 원페이지 분석의 총 9만 자 초과 중단과 원문·대화·오래된 완료 업무의 분량 축소를 제거했습니다.
- 큰 자료를 저장 가능한 묶음으로 분석하고, 결과를 계층적으로 통합합니다. 현재 묶음 재시도와 진행률, 원본 근거 검증, 완료/중지 시 임시 자료 정리를 추가했습니다.
- 전체 분석 시간 대신 개별 실행 시간을 관리하며, 계획 게시와 업무 승인은 기존 검증을 유지합니다.

## 2026-09-07 · 프로젝트 자동 안분과 연결 그래프

- 할 일의 제목·완료 기준을 프로젝트 이름, 프로젝트 키워드, 그 프로젝트가 이미 쓰는 어휘와 대조해 프로젝트를 자동으로 고릅니다. 새 할 일을 쓰는 동안 확신이 높으면 연결 프로젝트가 바로 선택되고(직접 고르면 그대로 둠), 확신이 낮으면 코치 체크가 후보를 제안합니다.
- 할 일 화면의 **프로젝트 자동 안분**이 다른 프로젝트를 분명히 가리키는 할 일을 키워드와 함께 보여 주고, 체크한 항목을 한 번에 옮깁니다(`task.assign`). 집중 시간 블록의 프로젝트도 함께 바뀝니다.
- 프로젝트 편집에 **키워드**(최대 12개)를 두어 이름에 없는 표현(OFD, 한투파, 4층 등)도 안분에 쓰입니다. 에이전트도 `task.assign` 카드(20개 이내)를 제안할 수 있습니다.
- 프로젝트 화면에 **그래프** 보기를 추가했습니다. 프로젝트를 허브로 할 일·키워드·목표·기록·선행 관계를 연결해 그리고, 키워드 노드가 프로젝트 ↔ 키워드 ↔ 할 일의 연결고리를 보여 줍니다. 검색·확대·이동, 노드를 눌러 열기, 완료 포함/기록/목표 토글을 지원합니다. 외부 라이브러리 없이 결정적 배치를 사용합니다.

## 2026-09-07 · v0.6 BRAINY 동반 코치

- 할 일을 쓰는 동안 코치 체크가 완료 조건(인계 기준), 사분면 A/B/C/D, 인지 등급, 최근 실적으로 보정한 예상 시간, 4시간 초과, 지난 마감, Goal Laser 후보, 적용 중인 규칙 ★을 확인하고 한 번 눌러 반영합니다. 어떤 경고도 저장을 막지 않습니다.
- 집중 세션(`task.start` / `task.stop` / `task.record`): 한 번에 한 세션, 경과 시간이 실제 시간으로 누적되고, 끝낼 때 ✓△✗·인계 확인·실제 분·이유·규칙 한 줄을 남깁니다.
- 저녁 회고가 4단계 PAFI 위저드로 바뀌었습니다(결과 → 원인·대안·규칙 → 에너지·습관 → 내가 해냄·감사). 저장 시 결과·실제 시간·규칙·습관 체크·통계를 반영하고 상세는 새 `orbit_reviews` 표(마이그레이션 0010, `/api/reviews`)에 같은 트랜잭션으로 저장한 뒤 원페이지 실행 제안 분석을 시작합니다.
- 원페이지 제안과 Goal Laser 결합: 연속 집중이 필요한 첫 우선순위(고위 인지·90분 이상·도미노 프로젝트 45분 이상)가 오늘의 Goal Laser가 되어 집중 구간에 연속 180분을 먼저 확보하고, 그 앞에 둔 짧은 선결 업무는 먼저 배치합니다. Hermes 분석 카탈로그와 지시문에 도미노 프로젝트·목표 계층·규칙 ★·습관·리스크·주간 실행률이 들어가고, 우선순위에 인지 등급·사분면을 붙일 수 있습니다. 제안 카드에 Goal Laser·반드시 종결·사분면·인지·보정률 배지를 표시합니다.
- Hermes가 연결되어 있지 않으면 규칙 기반 계획(점심·이동 버퍼 → Goal Laser → 반드시 종결 → B → A → C, D는 위임 목록)이 대신 시간을 배치하고 화면에 그 사실을 알립니다. 예상 시간 보정은 최근 30일 완료 업무의 실제÷예상 중앙값(5개 이상, ×0.5~×2)입니다.
- 목표 계층(꿈 → 중장기 → 단기 → 컨셉), 도미노 프로젝트, 지킬 1·버릴 2 습관(D+), 상시 리스크(확인일), 규칙 ★(중복 제거·40개), 주간 PAFI 결산(실행률 85% 기준선·예측 정확도·Laser 일수·상위 이유·새 규칙), 아침 Goal Laser 패널, BRAINY 리듬 설정을 추가했습니다.
- 대화 에이전트 컨텍스트에 목표·도미노·Laser·규칙·습관·리스크·주간 통계가 포함되고, 결과 기록·규칙·습관·리스크·Laser 지정 카드를 제안할 수 있습니다(목표·습관 삭제와 세션 제어는 불가).
- 새 `test:brainy` 스위트(15)와 저장·에이전트·brief 회귀 테스트를 추가하고 CI에 등록했습니다.

## 2026-09-07 · 원페이지 제안 실패 복구

- Hermes 실행이 실패하면 gateway가 돌려준 오류 문구(컨텍스트 초과·프로바이더 오류 등)를 그대로 표시합니다. 이전에는 "응답을 완료하지 못했습니다"만 보였습니다.
- 원페이지 제안의 카탈로그를 문자 수 예산(표준 90,000 → 축소 55,000 → 최소 30,000자)으로 제한하고, 넘치면 대화 → 회의록 원문 → 오래된 완료 업무 → 요약 길이 순으로 줄여 분석 범위에 표시합니다. 이전 최대 850,000자는 대부분의 모델 컨텍스트를 넘겨 실행이 실패했습니다.
- 실패한 분석은 새 세션·새 중복 방지 키로 한 단계 작은 범위에서 자동 재시도합니다(최대 3회). 인증 실패는 재시도하지 않고 API 키 확인을 안내합니다.
- 조회 결과(회의록 원문 등)를 건별·회차별로 자르고 이전 회차의 긴 결과를 줄여 실행 이력이 예산 안에 머물게 했습니다.
- gateway 재시작으로 실행 기록을 잃은 경우(404) 무한 대기 대신 즉시 종료하거나(대화) 같은 범위로 한 번 재시작하며(분석), `waiting_for_approval` 상태를 진행 중으로 처리하고, 30분 절대 한도와 중지 요청의 탈출 경로를 추가했습니다.

## 2026-09-07 · Android 공유 등록 복구

- 설치 아이콘을 manifest에 포함하여 Chrome의 쿠키 없는 아이콘 요청 의존성을 제거했습니다.
- 현재 화면의 공유 설정/수신 워커 점검과 Android 설치 대기·복구 안내를 추가했습니다.
- 웹 화면 준비와 실제 Android 앱 등록 완료를 구분합니다.

## 2026-09-06 · 공유 파일과 빠른 첨부

- Android 설치 앱에서 공유받은 파일을 대화나 일정으로 보관합니다.
- 이미지·영상·문서 첨부, 드래그앤드롭, 이미지 붙여넣기와 업로드 상태/재시도를 추가했습니다.
- 소유자 전용 원본 저장과 동영상 탐색, Hermes 이미지 미리보기·문서 텍스트 전달을 지원합니다.
- 화면 이동 시 대화 유지, 최근 대화 즉시 표시, 업무 토글의 즉각적인 반응을 적용했습니다.
- 공유 임시 보관, 원본 저장 확인 유실과 AI 중복 실행 방지를 검증했습니다. iOS는 앱 내 파일 선택을 사용하며, 영상 AI 입력은 첫 프레임으로 제한합니다.

## 2026-09-06 · 프로젝트별 AI 대화

- 새 대화, 대화 제목 편집, 프로젝트별 보관함과 프로젝트에서 대화 열기를 추가했습니다.
- 기존 단일 대화를 보존하며, Hermes의 이력과 세션을 대화별로 분리했습니다.
- 대화 전환 중 비동기 응답이 섞이지 않도록 하고, 이전 메시지 페이지와 전역 검토함을 유지합니다.
- 프로젝트 삭제 시 대화를 일반 대화로 남기며, 기존 진행 중 실행과 승인 기록을 보존하는 스키마 마이그레이션을 추가했습니다.

# Changelog

## v0.5.2 · 2026-09-06

- Fix standalone sessions that receive verified Sites email claims without the stable user ID: resolve only an email-to-ID link previously observed together in a verified request.
- Preserve existing owner IDs and encrypted integration credentials. Conflicting identities disable email-only recovery; unknown identities receive a recovery page instead of a redirect into a missing reserved sign-in route.
- Add a schema-only identity-link migration and regressions for standalone access, existing records, conflicting accounts and safe recovery redirects.

## v0.5.1 · 2026-09-06

- Extend installation to Mac (Safari, Chrome, Edge) and Windows (Edge, Chrome), retaining Android and iPhone/iPad support.
- Detect the device and browser, provide accessible device tabs and browser selection, and distinguish install requests from completed installations.
- Launch the agent before manual installation so Safari Add to Dock opens the conversation; remove setup parameters before pinning.
- Add an install entry on the first conversation screen, root-address copying, same-account guidance and desktop documentation.
- Validate desktop/mobile user-agent detection, standalone manifest launch and the protected install route. Physical OS installation remains a device-level verification.

## v0.5 · 2026-09-06

- Replaced direct OpenAI model calls and API-key setup with authenticated native Hermes Agent runs; model/provider remain managed by the existing Hermes instance.
- Added durable run IDs, native idempotency keys, foreground reconciliation, explicit stop control and owner isolation. Responses become validated approval cards; transport errors never publish partial cards.
- Added a direct read-only Plaud Streamable HTTP MCP client, independent of model-provider connectors. Google primary calendar uses its existing official Calendar adapter.
- Fixed Plaud login startup to use the app's pre-registered OAuth client; retained PKCE and one-use owner/cookie state. Connection cards show local progress/errors and an authorization link fallback.
- Added an existing-Mac Hermes setup helper and guide, plus regression coverage for failed connections, lost acknowledgements, cancellation and stale proposals.


## 0.4.0 — 2026-09-06

- Conversation is the default screen; Korean mobile composer, persistent history, source references and approval/defer inbox.
- Real Responses API tool loop uses owner-scoped workspace and document context; all changes are persisted proposal cards until explicit approval.
- Plaud official remote MCP with dedicated dynamic registration, PKCE and encrypted app credentials.
- Google Calendar MCP plus own OAuth setup, primary-calendar paging/normalization, live conflict checks and repeat-safe approved creation without attendees or notifications.
- AES-GCM owner/provider-bound secrets; one-use OAuth state, serialized token refresh, turn/action leases and workspace revision checks.
- Existing calendar/planner approvals refresh connected busy periods; imported events are edited in Google.
- Sixteen agent/integration tests and protected API tests added to CI. External API tests use synthetic responses; real OAuth and paid inference require app-side credentials and consent.
- No automatic nightly scheduler, push delivery, bulk import or physical-device QA.

## 0.3.1 — 2026-09-06

- Private `/install` guide for Galaxy/Android and iPhone, deferred install prompt, cancellation fallback and actual standalone/install event detection.
- Credentialed manifest link for authenticated hosting, maskable/Apple icons and app shortcuts.
- Mobile keyboard-aware forms, safe areas, larger touch targets and screen history for the phone Back action.
- Foreground/reconnection refresh respects open edits and unresolved saves; offline status does not claim a successful save.
- Static-only offline caching validates response types and excludes sign-in redirects, private records and APIs.
- Seven PWA policy/asset checks plus a protected installation-route check added to CI.
- GitHub connection completed; source updates are maintained in roybeee/ORBIT.
- Scope: installable web app (PWA); no store package, offline record editing, scheduled push notifications or physical-device QA.

## 0.3.0 — 2026-09-06

- Immutable document versions, on-demand bodies, paged current-body search and history.
- Atomic, lossless v2 document migration with preserved IDs and task links.
- Explicit meeting action candidates, editable acceptance and immutable source citations.
- Same-source duplicate prevention, including after unrelated meeting edits.
- Previous/current document comparison and restore as a new version.
- Streaming current-record export includes complete document bodies.
- Eleven note/migration/search tests and six built-Worker route tests, alongside eighteen existing planner/storage tests.
- GitHub creation/push script and a prefilled private-repository link prepared; actual creation remains blocked by missing callable creation/authentication.
- Limits: catalog metadata remains bounded; no LLM inference, external sync, automatic nightly scheduler, bulk imports or browser/device QA.

## 0.2.0 — 2026-09-06

- Account-scoped D1 persistence, atomic revision checks and replay-safe commands.
- Protected workspace and API; isolated `/demo` without durable sample records.
- Live dates, week navigation, project/task/note/event editing and date-based review history.
- Server proposal approval/revoke; hold reason and next review date carried across future plans.
- User workday/timezone/capacity preferences and JSON export.
- PWA manifest, app icons, privacy-conscious static offline explanation.
- Ten storage/date tests plus five built-Worker auth/API tests; original eight planner tests retained.
- Limitations: no live connectors, LLM, scheduled notifications, offline records, import/restore or real-device QA. GitHub remote still awaits repository access.

## 0.1.0 — 2026-09-06

- Product specification, information architecture, data model, approval rules and release backlog.
- Korean responsive workspace with Today, Calendar, Tasks, Projects, Wiki, Knowledge, Evening Review and Tomorrow Proposal.
- In-session creation and navigation of sample tasks, projects, events and records.
- Deterministic scheduling, fixed-event protection, capacity/energy limits and dependency checks.
- Approval, defer reason, re-review, revoke and decision-preserving regeneration.
- Scheduling tests, server render smoke test and GitHub CI/Issue/PR templates.
- Boundary: no persistent user records, live integrations, LLM, scheduler, PWA or remote GitHub connection yet.
## 2026-09-08 · 설치 앱의 새 버전 안내

- 서버와 화면의 빌드 식별자를 비교해 앱 복귀 시와 사용 중 새 버전을 알립니다. 저장 후 업데이트를 눌러 현재 화면을 다시 열 수 있으며 입력 중 강제 재시작하지 않습니다.
- 로그인된 버전 조회와 첫 화면 HTML/RSC는 캐시하지 않아 이전 화면의 재사용을 방지합니다. 기존 공유 파일과 저장된 워크스페이스는 지우지 않습니다.
