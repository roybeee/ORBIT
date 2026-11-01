# 카카오톡 비서실장 검증 기록

개발 기준: GitHub `roybeee/ORBIT` main `1fb6524efcb05accf9cc94ada3bf630232793dfb`.
작업 브랜치: `feat/kakao-chief`. 운영 게시 전 기록이다.

| 검사 | 결과 | 실제/모의 범위 |
|---|---|---|
| `npm run typecheck` | passed · real | TypeScript 전체 |
| `npm test` | passed · 1139/1139, 0 failed | build 포함, SQLite/암호화 real; 외부 서비스 mocked 포함 |
| 카카오 관련 Node 회귀 | passed · 66/66 | HTTP/SQLite/암호화 real; 모델/카카오 AX mocked |
| 신규 `lib/orbit/kakao/*.ts` 커버리지 | 줄 96.94%, 분기 84.92%, 함수 88.64% | 관련 66개 테스트 |
| `ORBIT_E2E_PORT=4329 npx playwright test e2e/kakao-review.spec.ts` | passed · 12/12 | Chromium·로컬 worker real, 카카오·분석 API mocked |
| `bash integrations/orbit-kakao-mac/build.sh` | passed · real | Swift 컴파일; 대화 수집 실행 아님 |
| ZIP 명시적 manifest·시간대 간 바이트 동일성 | passed · real | 소스만 패키징; 연결 키·대화·바이너리 없음 |
| `git diff --check` | passed · real | 공백/패치 검사 |
| 독립 코드·보안 리뷰 | 승인, 미해결 CRITICAL/HIGH/MEDIUM 없음 | 실제 수집/외부 모델을 검증한 것으로 간주하지 않음 |
| Native 실제 대화 수집 | not_run | 앱 구조는 CUA로 관측; 별도 Native 실증 필요 |
| 외부 모델 실응답·Google 실등록 | not_run | 실제 계정 변경 없음 |
| Linux 전용 Python-less 회귀 | not_run | macOS에서 script가 skip; Linux CI 대상 |

회귀 RED: 신규 모듈 부재, 진입 버튼 일시 제거, 기존 자동 재검토/일반 대화 우회, 인증정보 변형 문구로 실패를 확인한 뒤 수정했다. 브라우저 4개 핵심 여정의 이전 반복 실행은 24/24 통과했고, 이후 삭제 확인·분석 키 설정 여정을 추가한 최종 실행은 12/12다.

전체 검사 최초 실패 10건은 `tests/meeting-automation.test.mjs`, `tests/provider-hold.test.mjs`의 고정된 2026-09 회의 fixture 때문이었다. 독립 detached main `1fb6524`에서도 같은 10건 실패(5 passed/10 failed)를 확인했고, baseline 실행 날짜만 2026-09-25로 고정하면 15/15 통과했다. 테스트의 회의 날짜만 현재·상대 날짜로 바꾼 뒤 15/15 및 전체 1139/1139 통과했다. 관련 운영 로직은 바꾸지 않았다.

실제 CUA 확인은 카카오톡 bundle `com.kakao.KakaoTalkMac`, 버전 파일 metadata `26.9.0`, 목록 배지·메시지 날짜 Help 구조에 한정했다. 첫 기본 AX 조회가 미읽음 미리보기를 포함해 반환한 사실을 사용자에게 알렸으며, 그 내용을 분석·저장하지 않고 이후 관측은 내용을 제외해 수행했다. 실제 구현은 목록 미리보기의 Value를 읽지 않는 선택적 AX 조회다.

제한: 자동 방 이동·스크롤은 비활성이다. UI 확인과 새 메시지 도착을 원자적으로 묶을 수 없고 앱 자체 읽음 처리를 되돌리지 못한다. 현재 기능을 전체 대화방 자동조사 완료나 운영 연동 완료로 보고하지 않는다. 일부 행은 발신자/날짜 불명으로 건너뛰므로 부분 검토다.

기존 의존성 보안 부채: 독립 리뷰의 `npm audit --omit=dev` 결과 8건(critical 1/high 6/moderate 1). package/lockfile을 이번 기능에서 변경하지 않았으며 별도 의존성 작업 대상이다.
