# ORBIT 병렬 작업 루프

여러 에이전트(Claude, Codex/ChatGPT, Slack/Hermes)와 사람이 동시에 개발해도 `main`과 운영 앱이 깨지지 않게 하는 절차와 도구다.
비유하면 공항 관제다. 비행기(PR)는 각자 준비하지만 활주로(`main`)에는 관제탑이 한 대씩, 그 순간의 바람(최신 `main`)으로 다시 점검한 뒤에만 내려보낸다. GitHub의 머지 큐는 조직 소유 저장소 전용이라 이 저장소에서는 쓸 수 없고, 대신 "검사받은 head가 최신 `main`을 포함해야 한다"는 규칙이 같은 역할을 한다.

## 보장하는 것

| 위험 | 방지 장치 |
|---|---|
| 오래된 `main` 기준으로 green을 받은 PR이 그대로 머지 | 룰셋의 strict required check: 검사받은 head가 최신 `main`을 포함해야 머지된다. 앞 PR이 먼저 들어가면 뒤 PR은 `BEHIND`가 되어 `main`을 반영하고 CI를 다시 받아야 한다 |
| 두 브랜치가 같은 번호의 마이그레이션 생성 | `scripts/check-migrations.mjs`가 PR·큐·main 푸시마다 journal 순번, 파일, 스냅샷 체인, 기준 브랜치 대비 재번호 여부를 검사 |
| `CHANGELOG.md` 동시 편집 충돌 | `.gitattributes`의 `merge=union`으로 양쪽 섹션을 모두 보존 |
| 로컬 작업 트리가 서로 덮어씀 | 작업 하나 = 워크트리 하나, 항상 검증된 원격 `main` SHA에서 시작 |
| 어떤 소스가 운영 중인지 알 수 없음 | 빌드에 소스 tree hash를 심고 `/api/deployment-health`·`/api/version`이 `tree`로 보고. `verify-deploy.sh`가 GitHub SHA의 tree와 비교 |
| 사람이 직접 `main`에 push / 강제 push / 삭제 | `main-integration` 룰셋이 차단, 우회 대상 없음 |

## 루프

```
start.sh <slug>  →  개발·커밋  →  sync.sh  →  finish.sh  →  [auto-merge, main 최신화 필수]  →  release.sh  →  publish-sites.sh  →  verify-deploy.sh
```

### 1. 시작 — `scripts/parallel/start.sh <slug> [--type feat|fix|refactor|docs|chore]`

- `origin`이 `roybeee/ORBIT`인지, `git rev-parse origin/main`이 `git ls-remote`와 같은지 확인한다.
- `../orbit-<slug>` 워크트리를 `<type>/<slug>` 브랜치로 만들고 `npm ci`를 실행한다 (`--no-install`로 생략).
- 기준 SHA와 tree를 워크트리의 `.orbit-task.json`(git 무시)에 기록한다.
- **워크트리는 작업 하나당 하나이며 재사용하지 않는다.** PR이 머지된 워크트리에서 다음 작업을 이어 하면 안 된다. 머지 후에는 `cleanup.sh`로 지우고 새 slug로 다시 `start.sh`를 실행한다. 같은 브랜치 이름을 다시 쓰면 `finish.sh`는 새 PR을 열지만(이전에는 머지된 PR에 잘못 붙었다), 브랜치가 이미 main에 포함되어 있어 혼동이 생긴다.

### 2. 동기화 — `scripts/parallel/sync.sh [--rebase] [--no-verify]`

- 최신 `origin/main`을 다시 검증하고 브랜치에 병합(기본) 또는 리베이스한다.
- 마이그레이션 검사 후 `npm run typecheck`, `npm run build`(전체 테스트 포함)를 실행하고 검증한 HEAD를 기록한다. Linux 전용 Python-less 회귀는 Linux에서만 실행하며 CI가 항상 실행한다.
- 충돌이 나면 멈춘다. 해결 후 다시 실행한다. 진행 중 다른 작업이 먼저 머지되면 항상 이 단계를 거친다.

### 3. 마무리 — `scripts/parallel/finish.sh [--title "..."] [--no-merge]`

- 브랜치가 최신 `main`을 포함하는지 확인하고(아니면 `sync.sh` 안내), 검증 기록이 없으면 검사를 다시 실행한다.
- push 후 PR을 만든다(있으면 본문 갱신). 본문에 시작 기준 SHA, 병합 직전 `main` SHA, PR head, 소스 tree, 검증 결과가 자동으로 들어간다.
- PR head의 `Validate Orbit`이 성공할 때까지 기다린 뒤에만 `gh pr merge --auto --merge`를 켠다(필수 검사가 없는 상태에서 `--auto`는 즉시 머지되므로). 머지될 때까지 기다리며 `BEHIND`면 `gh pr update-branch`로 최신 `main`을 반영해 CI를 다시 받고, `DIRTY`(충돌)면 `sync.sh`를 안내하며 종료한다. 끝나면 새 `main` SHA와 tree를 출력한다.

### 4. 현황 — `scripts/parallel/status.sh`

모든 워크트리의 브랜치, `main` 대비 뒤처짐/앞섬, 미커밋 변경, **열려 있는** PR의 상태, `validate` 결과, auto-merge 설정 여부를 한 표로 보여 준다. 머지된 PR은 표시하지 않는다.

### 5. 정리 — `scripts/parallel/cleanup.sh --merged | <slug>...`

`origin/main`에 머지된 브랜치의 워크트리와 로컬·원격 브랜치를 제거한다. 미커밋 변경이나 미머지 브랜치는 `--force` 없이는 건너뛴다.

### 6. 릴리스 — `scripts/parallel/release.sh [--sites-remote <url>] [--record-pr]`

- 검증된 `origin/main`의 `Validate Orbit`이 success인지 확인한다(아니면 중단, `--allow-unverified`는 사유 기록 필수).
- `--sites-remote`(또는 `ORBIT_SITES_REMOTE_URL`)를 주면 토큰을 비표시 입력으로 받아 **exact-tree projection**을 push한다. Sites 소스 저장소는 자체 히스토리를 가지므로 GitHub main을 fast-forward할 수 없다. 대신 Sites main 위에 "GitHub tree와 정확히 같은 tree"를 가진 커밋 하나를 만들어 push한다(PR #22, #24의 방식). 토큰은 인수·파일·로그에 남기지 않는다.
- `docs/releases/<날짜>-<sha7>.md`에 GitHub SHA → tree → CI → Sites 결과를 기록한다. `--record-pr`은 이 기록을 별도 docs PR로 올린다.

### 6-1. Sites 게시 — `scripts/parallel/publish-sites.sh <github-sha>` (소유자 실행)

- Sites publication(버전 저장·배포 ID 생성)은 ChatGPT/Codex 안의 Sites 연결로만 가능하다. 이 스크립트는 로컬 Codex CLI(`codex exec`, bundled `sites-hosting` 스킬)에 정확한 지시문을 전달한다: 검증된 SHA의 detached 워크트리에서 exact-tree projection push → 빌드·패키지 → `save_version_and_deploy_private` → 배포 상태 폴링 → 구조화된 보고.
- Codex가 승인을 요청하므로 터미널에서 소유자가 직접 실행한다(무인 전권 실행은 하지 않는다). `--print`로 지시문과 명령만 확인할 수 있다.
- 끝나면 보고의 DEPLOYMENT_ID·버전을 릴리스 기록에 적고 `verify-deploy.sh`로 운영 tree를 대조한다.

### 7. 배포 검증 — `scripts/parallel/verify-deploy.sh <github-sha> [--url ...]`

`ORBIT_RELEASE_HEALTH_TOKEN`으로 `/api/deployment-health`를 호출해 보고된 `tree`가 GitHub SHA의 tree와 같은지 확인한다. 같을 때만 "운영 반영"으로 보고한다. `unknown`이면 이 변경 이전 빌드이거나 git 없는 빌드다(`ORBIT_SOURCE_TREE` 환경변수로 주입 가능).

## GitHub 설정 — `scripts/parallel/github-setup.sh [--dry-run] [--remove]`

- 저장소: `delete_branch_on_merge`, `allow_auto_merge`, `allow_update_branch` 켬. 머지 커밋 방식 유지.
- 룰셋 `main-integration`(기본 브랜치): PR 필수(merge 방식만), required check `validate`에 strict 최신화 요구, 삭제·non-fast-forward 금지, 우회 대상 없음. `--merge-queue`는 저장소를 조직으로 옮긴 뒤에만 의미가 있으며, 그때는 strict 요구를 끄고 큐가 그 역할을 맡는다.
- 긴급 시 소유자가 룰셋을 비활성화하거나 `--remove`로 삭제한다. 그 사실을 기록한다.

## 규칙 요약 (모든 에이전트 공통, AGENTS.md와 동일)

1. 머지 = 큐 진입. REST merge 직접 호출 금지.
2. 마이그레이션은 append-only. 번호는 머지 전까지 잠정값이다. 번호가 겹치면 `drizzle/meta/`를 `main` 것으로 되돌리고(`git checkout origin/main -- drizzle/meta/`) 초안 SQL을 지운 뒤 `npm run db:generate`로 다시 생성한다. 이름을 바꾸려면 SQL 파일명과 journal `tag`를 함께 바꾸고, 스냅샷의 `id`/`prevId`는 손으로 고치지 않는다.
3. 의존성·lockfile 변경은 단독 소형 PR.
4. `CHANGELOG.md`는 날짜 섹션 단위로 추가.
5. GitHub 머지 = 소스 릴리스. `verify-deploy.sh`가 tree 일치를 확인했을 때만 운영 배포로 보고.

## 알려진 한계

- 동시 PR이 많을수록 뒤 PR은 앞 PR이 머지될 때마다 최신화·재검증을 반복한다. 동시 5개면 마지막 PR은 10분 안팎 지연된다(CI 약 2분).
- `merge=union`은 **로컬 머지에만** 적용된다. GitHub이 서버에서 수행하는 머지에는 적용되지 않으므로, `CHANGELOG.md`가 양쪽에서 바뀌면 PR이 `DIRTY`가 되고 `sync.sh`로 로컬에서 해결해야 한다(이때 union이 동작한다).
- `finish.sh`가 대기 시한(기본 45분)을 넘겨 종료해도 **auto-merge는 켜진 채로 남는다.** 조건이 갖춰지면 나중에 사람 없이 머지된다. 원치 않으면 `gh pr merge --disable-auto <n>`으로 끈다.
- CI가 간헐적으로 실패하면 `finish.sh`는 그 자리에서 중단한다. 실패가 이 변경과 무관하면 `gh run rerun <id> --failed` 후 `finish.sh`를 다시 실행한다.
- 워크트리는 재사용하지 않는다(1단계 참조). `cleanup.sh`는 자기 커밋이 있고 PR이 머지된 워크트리만 지우며, 방금 시작해 아직 커밋이 없는 다른 에이전트의 워크트리는 건너뛴다.
- Sites publication은 Codex의 Sites 연결을 통해서만 가능하다. `release.sh`는 소스 push와 기록, `publish-sites.sh`는 소유자가 실행하는 Codex 게시 지시를 담당한다.
- 이 변경 이전에 배포된 빌드는 `tree`를 `unknown`으로 보고한다. 작업 트리가 더러운 상태에서 빌드하면 `tree`가 `unknown`이 되어 `verify-deploy.sh`가 실패한다(거짓 검증 방지).
- tree 일치는 "배포된 소스가 그 커밋의 파일과 같다"는 뜻이다. 파일이 같은 서로 다른 커밋은 같은 tree를 가지므로, 커밋 자체를 특정하지는 않는다.
