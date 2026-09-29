# ORBIT-20260928-01 운영 릴리스 계약

기준 main: 959612be0bf5062d4bcf86a51f628e9b7e72ec4f. 코드 병합(`merged`), 플랫폼 게시(`published`), 운영 계약 완료(`verified`)를 구분한다. 운영 tree만 일치한 이전 `runtime-verified`와도 구분하며 이제 `verify-deploy.sh`는 전체 계약을 요구한다.

## 계약과 판정

`lib/orbit/release/contract.json`은 마이그레이션 저널과 최신 Drizzle snapshot으로부터 생성한다. 마지막 번호뿐 아니라 모든 파일 이름/SHA-256, 테이블/컬럼, API 경로, Hermes 최소 버전/필수 훅을 포함한다. 스키마 변경 시 `node scripts/release-contract-manifest.mjs`로 갱신하며 빌드가 오래된 계약을 차단한다.

읽기 검사는 실제 `sqlite_master`와 `PRAGMA table_info`를 조회한다. `d1_migrations.name` 또는 `__drizzle_migrations.hash`에 모든 이력이 있어야 통과한다. 테이블이 존재해도 적용 기록이 불명확하면 `blocked`다. 이름 목록의 일부만 반환하는 외부 도구를 완전한 DB 증거로 취급하지 않는다.

2026-09-29 조회: Sites 최신 버전은 170. DB 개요 도구는 알파벳 순 50개만 반환하며 `orbit_slack_directives`에서 끝났고 `orbit_workspaces`도 포함하지 않았다. 출력의 omitted_tables=0만으로 전체성을 증명할 수 없다. 따라서 제안서의 orbit_task_starts/orbit_slack_requests 누락은 독립적인 DB 검사 전까지 **미확정**이다. 테이블 목록만 보고 운영 DDL을 재실행하지 않는다.

## 인증 경계

- `ORBIT_RELEASE_CONTRACT_TOKEN`: 새 전용 32 random bytes/64 lowercase hex secret. 기존 ORBIT_RELEASE_HEALTH_TOKEN을 회전하지 않는다.
- `ORBIT_RELEASE_CONTRACT_OWNER`: 이미 존재하는 실제 ORBIT owner_id. 이메일이나 임의 ID로 가장하지 않는다.
- `ORBIT_SITES_BEARER`: Sites dispatch에 사용하는 기존 승인된 bearer.
- 서비스 토큰은 `/api/release-health` 및 3개 GET 경로의 `?release_probe=1`에서만 유효하다. 쓰기 API/일반 데이터 응답에 사용자 로그인을 부여하지 않는다.
- `/api/version`, `/api/slack-requests`, `/api/gotem/metrics`의 probe는 같은 읽기 함수를 실행하고 상태·경로·tree만 반환한다. 요청 내용, 개인 일정, 비밀, 원시 예외는 반환하지 않는다.
- 실제 HTTP 응답, JSON 형태, 응답 tree와 path를 검사한다. redirect 거부, 각 호출 10초 제한. 서버의 대상 origin은 고정된 ORBIT 운영 주소다.

소유자 UI는 설정 → 운영 건강. 현재 소스의 증거가 없거나 24시간이 지나면 검증 대기. 관측된 DB drift 또는 Hermes 증거 만료도 이전 녹색 상태를 유지하지 않는다. 검사는 DB를 쓰거나 역마이그레이션하지 않는다. R2에 개인 데이터 없는 검사 보고서만 owner별로 보관한다. `/api/release-health` POST는 서버에서 재검사하며 클라이언트가 보낸 passed 불리언은 수용하지 않는다.

## 게시 절차

1. forward migration을 적용할 운영자/플랫폼을 확인한다. 이번 구현은 새 업무 테이블·DDL을 추가하지 않는다.
2. 서비스 자격 증명을 환경으로 제공한다. `publish-sites.sh <sha>`는 해당 sha의 계약과 운영 DB를 비교한다. 누락·401·404·timeout·기록 불명확은 종료 코드 1로 게시를 중단한다.
3. 정확한 GitHub source tree를 Sites 게시하고 native 결과의 deployment ID/updated_at를 기록한다. 이 시점의 상태는 `published`, 계약 완료는 아직 아니다.
4. `ORBIT_DEPLOYMENT_ID`, `ORBIT_PUBLISHED_AT`(플랫폼 결과)를 설정하고 `scripts/parallel/verify-deploy.sh <sha>` 실행. API/DB/Hermes 검사 모두 통과해야 종료 코드 0 및 verified. 플랫폼 증거는 운영자가 제공하며 이 API는 Sites 관리 권한을 갖지 않는다.
5. 실패해도 JSON 증거를 docs/releases에 보존한다. 계약 실패 릴리스는 완료 횟수에 포함하지 않는다. 기존 앱은 게시됨·실패/대기로 남는다. 자동 DB rollback/자동 삭제/토큰 출력은 없다.

**최초 설치:** 이전 게시에는 `/api/release-health`가 없으므로 normal preflight는 의도적으로 실패한다. 신규 업무 기능을 준비 완료로 승격하지 않는 초기 검사기 설치가 필요하다. 마이그레이션 변경이 없는 이 검사기만 최초 게시할 때 native 배포 ID, preflight의 API 부재를 기록하고 `published · 검증 대기`로 유지한다. 설치 후 반드시 DB/API 검사와 별도 Hermes rollout을 수행한다. bootstrap을 verified로 간주하거나 404를 성공으로 처리하는 코드/상시 우회 플래그는 없다. 후속 릴리스는 normal preflight로 수행한다.

## Hermes

플러그인 v2.2.1은 네 훅 등록이 끝난 뒤, 그리고 실제 pre-dispatch 시 시간당 최대 한 번 별도 daemon thread로 버전·훅 목록만 보고한다. 메시지 본문·LLM 호출 없음. 기존 scoped Slack 인증으로 소유자를 결정한다. 보고가 실패하면 Slack 처리는 유지하지만 readiness는 만료/미확인으로 남는다. v2.2.0 이상 + 모든 훅 + 최근 24시간 실행 증거가 필요하다. 파일이 저장소에 있다는 사실은 서버 적용 증거가 아니다.

`integrations/hermes-orbit-commands/deploy.sh`는 release_health.py도 복사하고 서버 단위 테스트/게이트웨이 재시작/훅 등록을 확인한다. 서버 접근 불가 시 미배포로 기록한다. ORBIT endpoint를 먼저 게시한 뒤 플러그인을 배포한다.

## 측정과 복구

R2 `release-health/<owner>/checks/<id>.json`에는 deployment ID, publishedAt, checkedAt, source tree, status, elapsedSeconds와 개별 검사 결과를 보관한다. 14일 전후 또는 10회 릴리스의 verified 건만 완료로 집계한다. deployment ID별 최초 verified의 elapsedSeconds로 중앙값을 계산하고 verified가 없는 배포는 미검증 잔존으로 센다. 재검사 건수는 릴리스 수로 합산하지 않는다. 기준값은 소급 조작하지 않는다.

실패 시 정확한 테이블/컬럼·미적용 파일 또는 API 상태를 확인 → 올바른 운영 DB에 forward migration → 인증/서비스 principal/플러그인 수정 → 같은 release 재검사. DB 원복을 자동 시도하지 않는다. 업무 기능 자동 비활성화 대신 **완료 승격을 차단**하는 최소 범위 구현이다.

근거: [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)의 적용 이력 방식. 테이블 존재와 마이그레이션 완료를 별도로 검증한다.
