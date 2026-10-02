# ORBIT 현황판

작업을 시작하는 모든 에이전트와 사람은 이 파일을 먼저 읽고, 아래 내용을 **실제 원격 상태와 대조**한다(`git ls-remote origin refs/heads/main`, `gh pr list -R roybeee/ORBIT`, `scripts/parallel/status.sh`). 이 파일은 기억 보조일 뿐 증거가 아니다. 상태가 바뀌면 같은 PR 안에서 갱신한다. 자동 구역은 `scripts/parallel/status.sh --write`로 다시 만든다.

상태 용어는 `AGENTS.md`의 "State vocabulary"를 따른다: 소스는 `merged`, 배포는 `published`(Sites 배포 성공) / `runtime-verified`(운영 tree 일치), 검사 결과는 `passed|failed|blocked|not_run`에 `real|mocked`를 붙인다.

## 현재 단계

- 2026-10-02 UI/UX 3차(기준 main `b03c81e` = PR #157 merged): 휴대폰 프로젝트 화면 목표 사다리 한 줄 3단·중복 도시 배너 숨김 → 진행 중 탭이 첫 화면에. e2e `ux-focus.spec.ts` 4개(휴대폰)+2개(노트북) passed · 로컬 worker+D1, 인증 헤더 mocked.

- 2026-10-02 UI/UX 2차(기준 main `f9e6123` = PR #156 merged): 아침·낮·저녁 전환을 오늘 카드 위 오버레이로(별도 줄 제거), 한 번 완료 시 채움·취소선 피드백(동작 줄이기 존중). 데모 측정 '오늘의 할 일' 제목 y 618 → 594(휴대폰) · 655 → 603(노트북), 44px 미만 0 유지. typecheck passed · real, 단위 1017 passed, e2e 67 passed(로컬 worker+D1, 인증 헤더 mocked).

- 2026-10-02 UI/UX 집중(`claude/orbit-current-score-eval-uw23yu`, 기준 main `ad6324e` = PR #155 merged): 오늘 화면 위계 재배치(할 일·일정이 히어로 바로 아래), 작업 화면 테마 배너 → 한 줄 띠, 휴대폰 터치 영역 44px, 할 일 목표 태그, 칩 줄 가장자리 흐림, 빠른 기록 버튼 비키기. 데모 10개 화면 측정(390×844 · 1280×800): 휴대폰 44px 미만 누름 대상 7–23개/화면 → 0, '오늘의 할 일' 제목 위치 y≈2080 → 618(휴대폰) · 1129 → 655(노트북). typecheck passed · real, 단위 1017 passed, e2e(로컬 worker+D1, 인증 헤더 mocked) 62+5 passed.

- 2026-10-02 실행 루프 2차(`claude/orbit-current-score-eval-uw23yu`, 기준 main `e074d2b5217ab831cd3f1492cf15188265834672` = PR #153 merged, tree `bc6aabc`): 완료·기록·승인·습관 체크·문서 수정 즉시 저장, 오늘 할 일 한 번 완료(되돌리기), 아침 계획 자동 승인(선택, 기본 꺼짐) 및 결재함 1회 제안, 목표 연결 제안, 월요일 궤도 리포트, 규칙 효과 표시, 모바일 가로 넘침·히스토리 실행률 표시 수정. typecheck passed · real, 전체 회귀 1016개 passed(외부 서비스 stub 포함 mocked), E2E 60개 passed(Chromium 실제 입력, 로컬 worker+D1 real, 로그인 헤더 mocked). PR #153 소스는 merged이며 Sites published/runtime-verified는 not_run(소유자 `publish-sites.sh` 필요).

- 2026-10-02 실행 루프 강화(PR #153, `claude/orbit-current-score-eval-uw23yu`, 기준 main `57e22a1941cfbdd751147b9179b983a357876713`): 빠른 기록(어디서든 한 번에, 메모·회의록 새로 쓰기 즉시 저장, 빠른 기록함 자동 정리), 궤도 추적(목표별 최근 7일 기록·흐름, 오늘의 궤도 점검, AI 브리프 `goalMomentum`), 회고 규칙 ★의 결정적 계획 반영(`plan-rules.ts`), 기록 탭 첫 화면 히스토리, 결재함 하루 계획 일괄 승인, 가끔 여는 화면 지연 로딩(워크스페이스 번들 gzip 약 347KB→211KB), 저녁 1분 회고 알림 1회. typecheck passed · real, 전체 회귀 1006개 passed(외부 서비스 stub 포함 mocked), E2E 56개 passed(Chromium 실제 입력, 로컬 worker+D1 real, 로그인 헤더 mocked). 실제 휴대폰 키보드·설치 앱 바로가기 확인은 not_run(실기기 필요). Sites published/runtime-verified는 not_run.

- 2026-09-29 인터랙션 햅틱: `feat/interaction-haptics`, 기준 main `0ef42ce45ae4d8b8ce5846e41364c236d94a34b7`. 버튼·탭·확인 창 10ms, 확정 날짜 스와이프·롱프레스 18ms; 80ms 중복 제한. 미지원·거부·예외·숨김·동작 줄이기는 무음으로 처리한다. typecheck/build passed · real, 전체 회귀 981개 passed(외부 서비스 mocked 포함), 모바일 햅틱 브라우저 7개 passed(실제 Chromium 입력, 진동 API·demo 인증 mocked). Python-less 검사는 macOS에서 not_run, Linux CI에서 확인한다. 이 변경의 Sites published/runtime-verified는 아직 not_run.

- 2026-09-29 일간 시간표 날짜 스와이프: `fix/day-grid-date-swipe`, 기준 main `3cf5cc468eacdce799048bac9d79c30117a1f5a7`. 빈 시간대·일정·종일 카드에서 왼쪽은 다음 날, 오른쪽은 전날. 세로 스크롤·멀티터치·터치 취소와 활성 롱프레스는 날짜를 바꾸지 않는다. typecheck/build passed · real, 전체 회귀 970개 passed(외부 서비스 mocked 포함), 모바일 브라우저 9개 passed(Chromium 실제 터치 입력, demo/인증 mocked). Python-less 검사는 macOS에서 not_run이며 Linux CI에서 확인한다. PR #151 merged `0ef42ce`; Sites published `appgdep_6abb2befedd4819193f51a00fea2d014` (tree `bcae61cf2eda7d1a5e2eaa621cecf387038e629e`). 인증 브라우저 새 시간표 안내 확인 passed · real. 운영 `/api/version` tree 읽기는 브라우저 API 탐색 차단으로 blocked · real이므로 runtime-verified는 아님.

- PR #149 merged `af62ccd`, Sites v172 published/runtime-verified: 실제 필수 54개 테이블·컬럼과 인증 읽기 3개 통과. 적용 원장은 운영에서 `__appgarden_migrations(id,name,applied_at)`로 확인되어 표준 원장만 읽던 계약 검사기에 호환 추가 중. Hermes 실행 증거 미확인으로 전체 완료 승격은 pending.

- PR #148 merged `b192f3a`: 운영 계약 최초 게시 후 DB metadata 검사가 blocked, 내부 API 읽기도 blocked로 기록되어 완료 승격되지 않음. 외부 인증 읽기 3개 HTTP 200 확인(두 테이블 조회 포함), 내부 자기 호출만 blocked. 성공한 API가 서버에 직접 기록하는 5분 유효 증거로 제한된 자기 호출 환경을 지원한다. 후속 수정은 메타데이터 쿼리 수를 최대 3회로 제한하고 provider 내부 테이블을 제외한다. ZIP 생성의 현지 시간대 의존성으로 tree가 dirty가 되는 원인은 파일 내용 동일·ZIP 시각 차이로 확인하여 재현 가능한 시각으로 고정한다.

- ORBIT-20260928-01 운영 릴리스 계약 개발: `feat/release-contract`, 기준 main `959612be0bf5062d4bcf86a51f628e9b7e72ec4f`. DB 실제 테이블·컬럼·적용 이력, 인증된 읽기 API, Hermes 버전·훅·최근 증거를 분리 검사한다. R2 검증 증거와 설정의 운영 건강 화면, 게시 전 검사/검증 완료 승격 차단 구현. [설계·운영 절차](Release_Contract.ko.md). 운영 DB 개요는 50개에서 끝나 전체성 미확정: 제안서의 두 테이블 누락은 아직 확정하지 않는다. 신규 DDL/역마이그레이션 없음.

- 2026-09-28 이동 후 이전 일정 잔상: `fix/calendar-move-duplicate`, 검증 기준 main `5477a903c2923de499feaa22a0ed5cd7067a59d6`. Google 캐시가 이전 시간을 보유하면 연결 ID가 같은 이벤트를 별도 일정으로 반환하는 경로 재현(추가 회귀 2건 수정 전 failed). 읽기 병합을 ID 기준으로 수정, 이동·실행 취소·다른 날짜 이동·관련 없는 일정 보존 회귀 passed (SQLite real, Google HTTP mocked). PR #145/#146은 merged; 해당 tree는 Sites published, 인증된 `/api/version` 확인은 소유자 세션 부재로 blocked · real. [게시 기록](releases/2026-09-28-5477a90.md).

- 2026-09-28 Render 실패: `fix/runtime-transient-http`, 기준 main `be0098ba000608eb77f7cee246102e605b0643cb`. 운영 9/27 HTTP 503·9/28 HTTP 502 직후 exit 1, 다음 실행 성공 확인. main 스크립트에서 동일 종료 경로 재현(HTTP mocked, Node 실행 real). 제한된 502/503/504 재시도 및 회귀 검사 추가. 운영은 archived branch + inline start command이므로 main 변경만으로 반영되지 않음. 원인 범위 및 운영 조치는 [실패 추적](Runtime_Failures_2026-09-28.ko.md) 참조. PR #146 merged `5477a90`; Render branch main + 파일 명령 변경, deploy `dep-dat4ahp7lnhs73bjpri0` live, 10:47:21Z 실행 성공 passed · real.

- 2026-09-28 시간표 길게 누르기: `fix/day-grid-long-press`, 기준 main `be0098ba000608eb77f7cee246102e605b0643cb`. 일 보기에서 420ms 길게 누른 뒤 15분 단위 이동, 기존 일정 길이 유지, 겹침 표시, 가장자리 스크롤, 놓아서 저장 및 기존 실행 취소 연결. 일반 스크롤·짧은 탭·Esc·멀티터치·포커스 해제는 저장하지 않는다. Google에서 가져온 일정·보호 시간·승인된 제안은 기존 수정 경로를 유지한다. 관련 회귀 25건 passed (외부 Calendar mocked), 타입 검사 passed · real. GitHub CI 브라우저 E2E 28건 passed (run 36408709278), PR #145 merged `4aa4933`. Sites published (기록 참조); runtime-verified는 소유자 세션 부재로 blocked · real. 실기기 재현 검증 not_run. 기존 날짜 의존 테스트 실패는 수정 전 main에서도 재현했고 테스트 시계만 고정했다. 열린 PR #89, #144는 별도 문서 작업으로 확인했다.

- 2026-09-28 저장 지연·일괄 반려 수정: `fix/responsive-save-selection`, 검증 기준 main `8f56f8e8bb077e6a1ebc890262cbc93b184d2725`. 일정·할 일·프로젝트 입력을 기기에 먼저 보관하고 즉시 표시, 순차 전송·동일 요청 재생·필드 단위 충돌 병합을 적용한다. 실제 충돌 입력은 보관·복사 가능하며 관계없는 새 저장을 막지 않는다. 회의 일괄 반려는 **선택한 pending 항목만** 처리한다. typecheck 및 최종 전체 회귀 938건, Python-less 검사 5건씩 cold/warm 모두 passed (외부 네트워크 지연/유실은 mocked, SQLite 저장은 real). source/배포 상태는 PR merge 및 Sites 성공·운영 tree 관측으로 각각 갱신한다.

- GitHub `main`은 병렬 작업 루프(`scripts/parallel/`, `main-integration` 룰셋) 아래에서 PR 단위로만 바뀐다.
- 마지막으로 `published` + `runtime-verified`된 소스는 **`e609378`**이다(2026-09-27 KST, [기록](releases/2026-09-27-e609378.md), 소유자 브라우저 `/api/version` tree `360e6130…`). PR #141(일정 화면 월 달력 + 시간별 타임라인)이 포함된다.
- 그 이전 `published` + `runtime-verified` 소스는 **`e1f5079`**이다(2026-09-27 KST, [기록](releases/2026-09-27-e1f5079.md), 소유자 브라우저 `/api/version` tree `70ef4f9f…`). PR #139(Slack 지시 선저장·한도 후 1회 재개)가 포함된다. Hermes 플러그인 v2.2.0은 아직 서버 미배포.
- 그 이전 `published` + `runtime-verified` 소스는 `c3e7f1e`이다(2026-09-26 00:1x KST, [기록](releases/2026-09-25-session-batch.md), 소유자 브라우저 `/api/version` tree `78fe2c50…`). 2026-09-25 하루 게시 15건(#108–#134, 결재함 회의 카드·일괄 처리, 회의 분석 안정화)이 같은 기록에 있다.
- 그 이전 `published` + `runtime-verified` 소스는 **`4bb5318`**이다(2026-09-25 KST, [기록](releases/2026-09-25-4bb5318.md), 소유자 브라우저 `/api/version` tree `bcf024ca…`). PR #120(Slack "오늘 할 일"을 ORBIT에서 조회하는 `orbit_slack_today`, Hermes 플러그인 v2.1.0 서버 배포 포함)이 포함된다.
- 그 이전 `published` + `runtime-verified` 소스는 **`2c9ae43`**이다(2026-09-25 KST, [기록](releases/2026-09-25-2c9ae43.md), 소유자 브라우저 `/api/version` tree `9dd746c3…`). PR #115(결재함 배지는 최근 7일 결정만 · 쌓인 회의 결재 일괄 보류 · 닫힌 제안 보류 금지)와 #116(로딩 중 표시)이 포함된다. 직전 `f97d082`도 같은 날 게시·검증됐다([기록](releases/2026-09-25-f97d082.md)).
- 그 이전 `published` + `runtime-verified` 소스는 **`c72838b`**이다(2026-09-25 KST, [기록](releases/2026-09-25-c72838b.md), 소유자 브라우저 `/api/version` tree `5eaa8827…`). PR #113(수정 후 등록에서 기존 프로젝트 연결·새 프로젝트 생성, 프로젝트 합치기)이 포함된다.
- 그 이전 `published` + `runtime-verified` 소스는 `b5dc876`이다(2026-09-25 KST 09:46, [기록](releases/2026-09-25-b5dc876.md), 소유자 브라우저 `/api/version` tree `f8bf1013…`). 정보 구조 v2(PR #105·#106·#107·#110·#111) 전체가 포함된다.
- 그 이전 `published` + `runtime-verified` 소스는 `d41061e`이다(2026-09-25 KST, [기록](releases/2026-09-25-d41061e.md), 소유자 브라우저 `/api/version` tree `443f269e…`). PR #99·#101·#102·#103(Slack 지시 → Google+ORBIT 동시 등록, 캘린더·할 일 양방향 동기화, 목록 1회 조회)이 포함된다. Hermes 플러그인(`integrations/hermes-orbit-commands`)은 서버에 배포됨(해시 `de92e9e2…`, 도구 4개 등록 확인), Google Calendar는 Tasks 권한 포함 재연결됨.
- **정보 구조 v2(한 궤도)** 5단계가 `merged`되었다: PR #105(탭 4개·Orbit 버튼·결재함·찾기·나), #106(결재함에서 바로 처리·알림→소식), #107(오늘 시간 모드), #110(Orbit 도크), 그리고 이 PR(프로젝트 목표 사다리·상세 탭). 설계와 근거는 [docs/Orbit_IA_v2.ko.md](Orbit_IA_v2.ko.md). 2026-09-25 `b5dc876`으로 묶어 게시했다(`published` · `runtime-verified`). 운영에서 결재함 206건(Orbit 제안 200)이 드러났다 — 후속 과제.
- 이전 PR(`docs/status-d73694d`)은 d73694d 게시 기록을 반영했다. 열린 후속은 `fix/plan-stale-basis`(별도 작업)만 남았다.

## 검증된 결과

| 항목 | 상태 | 증거 |
|---|---|---|
| `main` = `3d72623ac120dc30c54e60934dce962025a38e24` (PR #62 머지) | merged | `git ls-remote origin refs/heads/main` (2026-09-23T04:30Z UTC 확인) |
| `3d72623` Sites 배포 | published · runtime-verified | [docs/releases/2026-09-23-3d72623.md](releases/2026-09-23-3d72623.md): `appgdep_6ab33bed…` succeeded, 소유자 브라우저의 `/api/version` tree `591cfe57…` = GitHub tree |
| 전체 자료 분석 20% 시범 (263/1313 단위) | passed · real | 206 신규 단위 94.8분(27.6초/단위), 재준비 시 `reused: 263`·잔여 1050 — [3d72623 기록](releases/2026-09-23-3d72623.md) |
| `41016f9` Sites 배포 | published · runtime-verified (3d72623으로 대체) | [docs/releases/2026-09-23-41016f9.md](releases/2026-09-23-41016f9.md): `appgdep_6ab320f3…` succeeded, 소유자 브라우저의 `/api/version` tree `9c83abe7…` = GitHub tree |
| `b0c9c58` Sites 배포 (version 119) | published · runtime-verified | [docs/releases/2026-09-22-b0c9c58.md](releases/2026-09-22-b0c9c58.md): `appgdep_6ab28768…` succeeded, 소유자 브라우저의 `/api/version` tree `f52deca2…` = GitHub tree |
| `e45d200` Sites 배포 | published · runtime-verified | [docs/releases/2026-09-22-e45d200.md](releases/2026-09-22-e45d200.md) |
| `1935840`, `4b7a2d4`, `cd2d439`, `921b3c7`, `b9b9454`, `1a418b6` | published (runtime 미검증, 다음 릴리스로 대체) | [docs/releases/](releases/) 각 기록, Codex 보고 원본은 [docs/releases/publish-reports/](releases/publish-reports/) |
| 열린 PR | 없음 (이 PR 제외) | `gh pr list -R roybeee/ORBIT --state open` (2026-09-23T00:51Z UTC) |
| `main`에 머지되지 않은 원격 브랜치 | 16개 (`archive/main-76769c8` 포함) | `git for-each-ref refs/remotes/origin` 중 `git merge-base --is-ancestor <b> origin/main` 실패 수 |

## 막힌 것

- **2026-09-24 계획 생성 — 해소(2026-09-24T03:17Z)**: `9e57e1b`에서 재실행 `312fff89…`(29분, Hermes 18회, 재사용 1,700·신규 11)이 전체 분석 기반 계획을 처음 게시했다(우선순위 3건, 근거 23건). 이날 확정한 원인 두 가지가 모두 수정·검증됐다: (1) 근거 ID 오타 → 합성 단계 보정 턴(`f108f10`)이 운영에서 `plan:2026-09-24`, `chief:2026-09-24`, `task:meeting-…` 3건을 잡아 두 번째 응답에서 실제 기록 인용으로 교정됐다. (2) 실행 중 수집으로 CONFLICT → A안(`9e57e1b`)으로 스냅샷 기준 완주 + 경고 `분석 시작 후 기록이 변경되었습니다(내용 수정)`가 계획에 남았다. '정체불명 예외'는 재실행 3회 모두 미발생(발생 시 실제 오류 표시됨). **후속:** 이전 계획 `plan:<date>`·chief 컨텍스트 인용은 이 PR(`fix/frame-citations`)이 `completeBrief`에서 제외(실제 근거가 함께 있을 때)하고 지시문에 허용 ID 종류를 명시해 보정 턴을 절약한다. 계획 상태가 게시 직후 `stale`로 뜨는 표시는 A안의 결과이며, 판정 방식 자체는 `incremental`/`fix/plan-stale-basis`(별도 작업, 미커밋)가 다루고 있어 여기서는 건드리지 않았다.

- **Hermes 계획 생성**: Hermes와 Codex CLI가 같은 OpenAI 계정으로 로그인되어 있어 `publish-sites.sh`의 Codex 실행이 Hermes 주간 쿼터를 함께 소모했다. 2026-09-23 계획 분석이 `429 quota exhausted (retry after 393141s)`로 실패했다([b0c9c58 기록](releases/2026-09-22-b0c9c58.md)). 소유자 결정(2026-09-23): 계정을 분리하지 않고 같은 계정을 유지한다. 그래서 `preflight-quota.mjs`는 같은 계정을 경고만 하고(exit 0), 실제로 쿼터가 소진된 경우(재설정 시각이 미래인 429)만 차단한다. 대응: 게시를 Hermes 계획 분석 시간대와 분리하고, 게시를 묶어서 횟수를 줄인다.
- **자동 runtime 검증**: `verify-deploy.sh`에 필요한 `ORBIT_RELEASE_HEALTH_TOKEN`이 이 머신에 없어, 운영 tree 확인은 소유자 브라우저의 same-origin `/api/version` 조회에 의존한다.

## 작동 중인 에이전트/작업

| 작업 | 워크트리 / 브랜치 | 담당 | 상태 |
|---|---|---|---|
| 같은 계정 경고 전환 | `orbit-shared-account-warn` / `fix/shared-account-warn` | Claude | 이 PR |
| 계획 stale-basis 수정 | `incremental` / `fix/plan-stale-basis` | 별도 작업 | 미커밋 변경 있음, 건드리지 말 것 |

## 다음 행동

-1. ORBIT-20260927-01(Slack 지시 선저장·한도 후 1회 재개, 마이그레이션 0039): 머지 후 Sites 게시 → 소유자가 `integrations/hermes-orbit-commands/deploy.sh`(플러그인 v2.2.0, 훅 4개 등록 확인) 실행. 순서가 바뀌면 플러그인의 영수증 전달이 404로 버려진다. 효과 측정: 14일간 Slack 이벤트 수 ↔ `orbit_slack_requests` 고유 영수증 수, 한도 대기 후 재입력 없이 완료된 비율(`status='done'` + 승인 카드).
0. 정보 구조 v2 후속: (a) 결재함 배지 노이즈 — 해결(#115·#116, 운영 배지 206→23, 쌓인 회의 결재 183건은 소유자가 일괄 보류 여부 결정). (b) 휴대폰에서 하단 탭·Orbit 도크(키보드 열림)·결재함 승인 1건 실기기 확인.
1. 게시할 때는 Hermes 계획 분석과 시간대를 나누고, 여러 머지를 한 번에 묶어 게시한다(같은 계정이라 쿼터를 함께 쓴다).
2. Hermes `openai-codex`의 `relogin_required` 경고(2026-09-21 기록)는 `hermes auth status openai-codex`로 확인한다.
3. 다음 게시는 `release.sh` → `publish-sites.sh` → 브라우저/`verify-deploy.sh` 순서로 한다.
4. AI 한도 공동 대기 효과 확인: 적용 전 기준값 `limitFailures7d` = 541(2026-09-24T15:01Z). 2026-10-02 이후 `/api/ai-hold`에서 에피소드별 `leaked`(0이 목표, `probes`는 별도)와 `completed/affected`, `limitFailures7d`를 다시 읽는다.

## 마지막 갱신(UTC)

- 수동 구역: 2026-09-25T01:50Z (Claude, c72838b 게시·운영 검증 기록)

<!-- status:auto:start -->
_`scripts/parallel/status.sh --write`가 생성한 구역입니다. 손으로 고치지 마세요._

- 생성 시각(UTC): 2026-10-02T12:16:39Z
- `origin/main`: `57e22a1941cfbdd751147b9179b983a357876713` (GitHub `ls-remote`와 일치 확인)
- 소스 tree: `3d05d03f344b5dd6c8fd56b4bc1eb5b3930b3d9e`

### 워크트리 (이 머신)

| 워크트리 | 브랜치 | HEAD | main 대비 뒤/앞 | 미커밋 |
|---|---|---|---|---|
| ORBIT | claude/orbit-current-score-eval-uw23yu | `26f303f` | 0 / 6 | no |

### 열린 PR

- (gh pr list failed)
<!-- status:auto:end -->
