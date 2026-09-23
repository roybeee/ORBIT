# ORBIT 현황판

작업을 시작하는 모든 에이전트와 사람은 이 파일을 먼저 읽고, 아래 내용을 **실제 원격 상태와 대조**한다(`git ls-remote origin refs/heads/main`, `gh pr list -R roybeee/ORBIT`, `scripts/parallel/status.sh`). 이 파일은 기억 보조일 뿐 증거가 아니다. 상태가 바뀌면 같은 PR 안에서 갱신한다. 자동 구역은 `scripts/parallel/status.sh --write`로 다시 만든다.

상태 용어는 `AGENTS.md`의 "State vocabulary"를 따른다: 소스는 `merged`, 배포는 `published`(Sites 배포 성공) / `runtime-verified`(운영 tree 일치), 검사 결과는 `passed|failed|blocked|not_run`에 `real|mocked`를 붙인다.

## 현재 단계

- GitHub `main`은 병렬 작업 루프(`scripts/parallel/`, `main-integration` 룰셋) 아래에서 PR 단위로만 바뀐다.
- 마지막으로 `published` + `runtime-verified`된 소스는 `b0c9c58`(Sites version 119)이다. 그 뒤 `main`에 머지된 PR #53~#56은 `merged` 상태이며 아직 `published`가 아니다.
- 이 PR(`chore/ops-guardrails`)은 게시 전 쿼터 검사, 게시 클론 정리, 이 현황판, 위임 계약을 추가한다.

## 검증된 결과

| 항목 | 상태 | 증거 |
|---|---|---|
| `main` = `41016f97928957d543ebfb254173ae2fa88f465b` (PR #56 머지) | merged | `git ls-remote origin refs/heads/main` (2026-09-23T00:49Z UTC 확인) |
| `b0c9c58` Sites 배포 | published · runtime-verified | [docs/releases/2026-09-22-b0c9c58.md](releases/2026-09-22-b0c9c58.md): `appgdep_6ab28768…` succeeded, 소유자 브라우저의 `/api/version` tree `f52deca2…` = GitHub tree |
| `e45d200` Sites 배포 | published · runtime-verified | [docs/releases/2026-09-22-e45d200.md](releases/2026-09-22-e45d200.md) |
| `1935840`, `4b7a2d4`, `cd2d439`, `921b3c7`, `b9b9454`, `1a418b6` | published (runtime 미검증, 다음 릴리스로 대체) | [docs/releases/](releases/) 각 기록, Codex 보고 원본은 [docs/releases/publish-reports/](releases/publish-reports/) |
| 열린 PR | 없음 (이 PR 제외) | `gh pr list -R roybeee/ORBIT --state open` (2026-09-23T00:49Z UTC) |
| `main`에 머지되지 않은 원격 브랜치 | 16개 (`archive/main-76769c8` 포함) | `git for-each-ref refs/remotes/origin` 중 `git merge-base --is-ancestor <b> origin/main` 실패 수 |

## 막힌 것

- **Hermes 계획 생성**: Hermes와 Codex CLI가 같은 OpenAI 계정으로 로그인되어 있어 `publish-sites.sh`의 Codex 실행이 Hermes 주간 쿼터를 함께 소모했다. 2026-09-23 계획 분석이 `429 quota exhausted (retry after 393141s)`로 실패했다([b0c9c58 기록](releases/2026-09-22-b0c9c58.md)). 2026-09-23T00:49Z UTC 기준 `node scripts/parallel/preflight-quota.mjs`는 `account: same account`와 Hermes `openai-codex` 재로그인 필요(`relogin_required`)를 보고하며 `blocked`(exit 2)다. 해결: Codex를 다른 계정으로 로그인하거나 Hermes 공급자 자격 증명을 다시 로그인한다(소유자 조치).
- **자동 runtime 검증**: `verify-deploy.sh`에 필요한 `ORBIT_RELEASE_HEALTH_TOKEN`이 이 머신에 없어, 운영 tree 확인은 소유자 브라우저의 same-origin `/api/version` 조회에 의존한다.

## 작동 중인 에이전트/작업

| 작업 | 워크트리 / 브랜치 | 담당 | 상태 |
|---|---|---|---|
| 게시 쿼터 검사·클론 정리·STATUS·위임 계약 | `orbit-ops-guardrails` / `chore/ops-guardrails` | Claude (orbit-ops) | 이 PR |
| E2E 스모크 테스트 | `orbit-e2e-smoke` / `chore/e2e-smoke` | Claude (orbit-e2e) | 진행 중 |
| 계획 stale-basis 수정 | `incremental` / `fix/plan-stale-basis` | 별도 작업 | 미커밋 변경 있음, 건드리지 말 것 |

## 다음 행동

1. 소유자: Codex CLI를 Hermes와 다른 OpenAI 계정으로 로그인하고, Hermes `openai-codex` 재로그인 후 `node scripts/parallel/preflight-quota.mjs`가 `ok`인지 확인한다.
2. 이 PR 머지 후 `scripts/parallel/cleanup.sh --publish-clones`로 남은 게시 클론(`orbit-publish-*`, 약 7GB)을 정리한다. 보고가 없는 `orbit-publish-a6f4ee0`은 확인 후 `--force`로만 지운다.
3. PR #53~#56을 포함한 `main`을 `release.sh` → `publish-sites.sh` → 브라우저/`verify-deploy.sh` 순서로 게시·검증한다(1번 해결 후).

## 마지막 갱신(UTC)

- 수동 구역: 2026-09-23T00:49Z (Claude orbit-ops, 위 증거 명령으로 확인)

<!-- status:auto:start -->
_`scripts/parallel/status.sh --write`가 생성한 구역입니다. 손으로 고치지 마세요._

- 생성 시각(UTC): 2026-09-23T00:50:12Z
- `origin/main`: `1d3779b135d2dee62aaff12aaddb7a273592de52` (GitHub `ls-remote`와 일치 확인)
- 소스 tree: `90d34f1d3eab7ba866ce8b21b9ad09eaea812a80`

### 워크트리 (이 머신)

| 워크트리 | 브랜치 | HEAD | main 대비 뒤/앞 | 미커밋 |
|---|---|---|---|---|
| incremental | fix/plan-stale-basis | `919679a` | 44 / 0 | yes |
| orbit-e2e-smoke | chore/e2e-smoke | `41016f9` | 2 / 0 | yes |
| orbit-ops-guardrails | chore/ops-guardrails | `41016f9` | 2 / 0 | yes |

### 열린 PR

- 없음
<!-- status:auto:end -->
