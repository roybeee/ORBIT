# ORBIT 현황판

작업을 시작하는 모든 에이전트와 사람은 이 파일을 먼저 읽고, 아래 내용을 **실제 원격 상태와 대조**한다(`git ls-remote origin refs/heads/main`, `gh pr list -R roybeee/ORBIT`, `scripts/parallel/status.sh`). 이 파일은 기억 보조일 뿐 증거가 아니다. 상태가 바뀌면 같은 PR 안에서 갱신한다. 자동 구역은 `scripts/parallel/status.sh --write`로 다시 만든다.

상태 용어는 `AGENTS.md`의 "State vocabulary"를 따른다: 소스는 `merged`, 배포는 `published`(Sites 배포 성공) / `runtime-verified`(운영 tree 일치), 검사 결과는 `passed|failed|blocked|not_run`에 `real|mocked`를 붙인다.

## 현재 단계

- GitHub `main`은 병렬 작업 루프(`scripts/parallel/`, `main-integration` 룰셋) 아래에서 PR 단위로만 바뀐다.
- 마지막으로 `published` + `runtime-verified`된 소스는 `aab5c62`이다(2026-09-24T15:01Z 확인, [기록](releases/2026-09-24-aab5c62.md), 소유자 브라우저 `/api/version` tree `bd2fbfc0…`). PR #91(AI 한도 공동 대기, `f98cbb9`)이 이 릴리스에 포함됐다. 이전 확인분 `d73694d`는 이것으로 대체됐다.
- 이 PR(`docs/status-d73694d`)은 d73694d 게시 기록을 반영한다. 열린 후속은 `fix/plan-stale-basis`(별도 작업)만 남았다.

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

1. 게시할 때는 Hermes 계획 분석과 시간대를 나누고, 여러 머지를 한 번에 묶어 게시한다(같은 계정이라 쿼터를 함께 쓴다).
2. Hermes `openai-codex`의 `relogin_required` 경고(2026-09-21 기록)는 `hermes auth status openai-codex`로 확인한다.
3. 다음 게시는 `release.sh` → `publish-sites.sh` → 브라우저/`verify-deploy.sh` 순서로 한다.
4. AI 한도 공동 대기 효과 확인: 적용 전 기준값 `limitFailures7d` = 541(2026-09-24T15:01Z). 2026-10-02 이후 `/api/ai-hold`에서 에피소드별 `leaked`(0이 목표, `probes`는 별도)와 `completed/affected`, `limitFailures7d`를 다시 읽는다.

## 마지막 갱신(UTC)

- 수동 구역: 2026-09-24T13:54Z (Claude, feat/provider-hold 작업 추가)

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
