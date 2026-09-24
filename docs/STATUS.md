# ORBIT 현황판

작업을 시작하는 모든 에이전트와 사람은 이 파일을 먼저 읽고, 아래 내용을 **실제 원격 상태와 대조**한다(`git ls-remote origin refs/heads/main`, `gh pr list -R roybeee/ORBIT`, `scripts/parallel/status.sh`). 이 파일은 기억 보조일 뿐 증거가 아니다. 상태가 바뀌면 같은 PR 안에서 갱신한다. 자동 구역은 `scripts/parallel/status.sh --write`로 다시 만든다.

상태 용어는 `AGENTS.md`의 "State vocabulary"를 따른다: 소스는 `merged`, 배포는 `published`(Sites 배포 성공) / `runtime-verified`(운영 tree 일치), 검사 결과는 `passed|failed|blocked|not_run`에 `real|mocked`를 붙인다.

## 현재 단계

- GitHub `main`은 병렬 작업 루프(`scripts/parallel/`, `main-integration` 룰셋) 아래에서 PR 단위로만 바뀐다.
- 마지막으로 `published` + `runtime-verified`된 소스는 `80fff22`이다(2026-09-24T02:19Z, [기록](releases/2026-09-24-80fff22.md), 소유자 브라우저 `/api/version` tree `5beef34b…` 확인). 같은 날 오전의 `a4fdd50` → `34ec890` → `69f17dc` → `ac3e955` → `14d8348` → `e40bfc9` → `f108f10`은 이것으로 대체됐다. `f108f10`의 근거 보정 턴은 `80fff22`에 포함되어 운영에 있다.
- 이 PR(`docs/status-f108f10`)은 f108f10 게시 기록과 9/24 계획 재실행 2회의 진단 결과를 반영한다.

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

- **2026-09-24 계획 생성**: 전수 분석은 끝났고 재실행은 전량 재사용한다. 원인 두 가지가 확정됐다.
  1. **근거 ID 오타** — `ac3e955` 재실행(01:07Z~01:31Z)에서 모델이 실제 회의록 `plaud:of_…a16c0f7f8f`를 `…a16f0f7f8f`로 한 글자 틀리게 인용하고 `note:plaud:1:0` 같은 조회 참조를 근거로 적어 `completeBrief`가 거부(정당). `f108f10`이 합성 단계 `BRIEF_EVIDENCE`에 보정 턴(최대 2회)을 추가했다. 보정 턴이 실제로 작동하는지는 **아직 운영에서 확인하지 못했다**(아래 2번이 먼저 걸림).
  2. **실행 중 기록 변경으로 CONFLICT** — `f108f10` 재실행(01:52Z~02:24Z, 33분, Hermes 호출 28회)은 합성 직전마다 워크스페이스가 바뀌어 재검증 2회 후 `분석 중 관련 기록이 계속 변경되고 있습니다`로 종료됐다. 변경의 출처는 실행과 동시에 돌아가는 수집이다: Plaud 임포트(대기 73건, 큐 2건)와 Hermes 대화 수집(대기 57건)이 몇 분마다 노트·대화를 추가해 revision이 1256(01:23Z) → 1264(02:15Z) → 1268(02:27Z)로 올라갔다(오늘 추가된 Plaud 노트 5건). 재검증 판정은 `captureWorkspaceBasis`의 **워크스페이스 전체 해시**(노트 본문만 제외)라 무관한 기록 하나가 추가돼도 처음부터 다시 돈다. 30분짜리 실행과 수 분 간격 수집은 이 판정과 공존할 수 없다.
  - 소유자 결정(2026-09-24): **A안** — 계획은 시작 시점 스냅샷 기준으로 완주하고 변경분은 커버리지 경고(`분석 시작 후 기록이 변경되었습니다(노트 +2, …)`)로 남긴 뒤 다음 실행이 증분 반영. 이 PR(`fix/plan-snapshot-basis`)이 구현했다(재검증·CONFLICT 분기 제거, 승인 시 action-guard 재검사는 그대로). 게시 후 9/24 계획 재실행으로 1번 보정 턴과 함께 검증할 것.
  - '정체불명 예외'는 두 재실행 모두에서 발생하지 않았다. 발생하면 `ac3e955`부터 실제 오류가 그대로 보인다.

- **Hermes 계획 생성**: Hermes와 Codex CLI가 같은 OpenAI 계정으로 로그인되어 있어 `publish-sites.sh`의 Codex 실행이 Hermes 주간 쿼터를 함께 소모했다. 2026-09-23 계획 분석이 `429 quota exhausted (retry after 393141s)`로 실패했다([b0c9c58 기록](releases/2026-09-22-b0c9c58.md)). 소유자 결정(2026-09-23): 계정을 분리하지 않고 같은 계정을 유지한다. 그래서 `preflight-quota.mjs`는 같은 계정을 경고만 하고(exit 0), 실제로 쿼터가 소진된 경우(재설정 시각이 미래인 429)만 차단한다. 대응: 게시를 Hermes 계획 분석 시간대와 분리하고, 게시를 묶어서 횟수를 줄인다.
- **자동 runtime 검증**: `verify-deploy.sh`에 필요한 `ORBIT_RELEASE_HEALTH_TOKEN`이 이 머신에 없어, 운영 tree 확인은 소유자 브라우저의 same-origin `/api/version` 조회에 의존한다.

## 작동 중인 에이전트/작업

| 작업 | 워크트리 / 브랜치 | 담당 | 상태 |
|---|---|---|---|
| 같은 계정 경고 전환 | `orbit-shared-account-warn` / `fix/shared-account-warn` | Claude | 이 PR |
| 계획 stale-basis 수정 | `incremental` / `fix/plan-stale-basis` | 별도 작업 | 미커밋 변경 있음, 건드리지 말 것 |

## 다음 행동

1. 게시할 때는 Hermes 계획 분석과 시간대를 나누고, 여러 머지를 한 번에 묶어 게시한다(같은 계정이라 쿼터를 함께 쓴다).
2. Hermes `openai-codex`의 `relogin_required` 경고(2026-09-21 기록)는 `hermes auth status openai-codex`로 확인한다.
3. 다음 게시는 `release.sh` → `publish-sites.sh` → 브라우저/`verify-deploy.sh` 순서로 한다.

## 마지막 갱신(UTC)

- 수동 구역: 2026-09-24T02:38Z (Claude, A안 구현 반영)

<!-- status:auto:start -->
_`scripts/parallel/status.sh --write`가 생성한 구역입니다. 손으로 고치지 마세요._

- 생성 시각(UTC): 2026-09-23T01:48:12Z
- `origin/main`: `b5d9be64f1aee67553fba030e17b4ee8a299b063` (GitHub `ls-remote`와 일치 확인)
- 소스 tree: `cc6edd1e5709b688428462e71b64f8410122dafc`

### 워크트리 (이 머신)

| 워크트리 | 브랜치 | HEAD | main 대비 뒤/앞 | 미커밋 |
|---|---|---|---|---|
| incremental | fix/plan-stale-basis | `919679a` | 54 / 0 | yes |
| orbit-e2e-smoke | chore/e2e-smoke | `cfe2567` | 3 / 0 | no |
| orbit-shared-account-warn | fix/shared-account-warn | `b5d9be6` | 0 / 0 | yes |

### 열린 PR

- 없음
<!-- status:auto:end -->
