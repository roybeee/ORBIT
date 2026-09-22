# ORBIT 병렬 작업 루프

여러 에이전트(Claude, Codex/ChatGPT, Slack/Hermes)와 사람이 동시에 개발해도 `main`과 운영 앱이 깨지지 않게 하는 절차와 도구다.
비유하면 공항 관제다. 비행기(PR)는 각자 준비하지만 활주로(`main`)에는 관제탑(머지 큐)이 한 대씩, 그 순간의 바람(최신 `main`)으로 다시 점검한 뒤에만 내려보낸다.

## 보장하는 것

| 위험 | 방지 장치 |
|---|---|
| 오래된 `main` 기준으로 green을 받은 PR이 그대로 머지 | 머지 큐가 `main` + 대기 PR을 합쳐 `Validate Orbit`을 다시 실행한 뒤 순서대로 머지 (`merge_group` 이벤트) |
| 두 브랜치가 같은 번호의 마이그레이션 생성 | `scripts/check-migrations.mjs`가 PR·큐·main 푸시마다 journal 순번, 파일, 스냅샷 체인, 기준 브랜치 대비 재번호 여부를 검사 |
| `CHANGELOG.md` 동시 편집 충돌 | `.gitattributes`의 `merge=union`으로 양쪽 섹션을 모두 보존 |
| 로컬 작업 트리가 서로 덮어씀 | 작업 하나 = 워크트리 하나, 항상 검증된 원격 `main` SHA에서 시작 |
| 어떤 소스가 운영 중인지 알 수 없음 | 빌드에 소스 tree hash를 심고 `/api/deployment-health`·`/api/version`이 `tree`로 보고. `verify-deploy.sh`가 GitHub SHA의 tree와 비교 |
| 사람이 직접 `main`에 push / 강제 push / 삭제 | `main-integration` 룰셋이 차단, 우회 대상 없음 |

## 루프

```
start.sh <slug>  →  개발·커밋  →  sync.sh  →  finish.sh  →  [머지 큐]  →  release.sh  →  Sites publish  →  verify-deploy.sh
```

### 1. 시작 — `scripts/parallel/start.sh <slug> [--type feat|fix|refactor|docs|chore]`

- `origin`이 `roybeee/ORBIT`인지, `git rev-parse origin/main`이 `git ls-remote`와 같은지 확인한다.
- `../orbit-<slug>` 워크트리를 `<type>/<slug>` 브랜치로 만들고 `npm ci`를 실행한다 (`--no-install`로 생략).
- 기준 SHA와 tree를 워크트리의 `.orbit-task.json`(git 무시)에 기록한다.

### 2. 동기화 — `scripts/parallel/sync.sh [--rebase] [--no-verify]`

- 최신 `origin/main`을 다시 검증하고 브랜치에 병합(기본) 또는 리베이스한다.
- 마이그레이션 검사 후 `npm run typecheck`, `npm run build`(전체 테스트 포함)를 실행하고 검증한 HEAD를 기록한다. Linux 전용 Python-less 회귀는 Linux에서만 실행하며 CI가 항상 실행한다.
- 충돌이 나면 멈춘다. 해결 후 다시 실행한다. 진행 중 다른 작업이 먼저 머지되면 항상 이 단계를 거친다.

### 3. 마무리 — `scripts/parallel/finish.sh [--title "..."] [--no-merge]`

- 브랜치가 최신 `main`을 포함하는지 확인하고(아니면 `sync.sh` 안내), 검증 기록이 없으면 검사를 다시 실행한다.
- push 후 PR을 만든다(있으면 본문 갱신). 본문에 시작 기준 SHA, 병합 직전 `main` SHA, PR head, 소스 tree, 검증 결과가 자동으로 들어간다.
- `gh pr merge --auto --merge`로 큐에 넣고 머지될 때까지 기다린 뒤, 새 `main` SHA와 tree를 출력한다. `DIRTY`(충돌)면 `sync.sh`를 안내하며 종료한다.

### 4. 현황 — `scripts/parallel/status.sh`

모든 워크트리의 브랜치, `main` 대비 뒤처짐/앞섬, 미커밋 변경, PR 상태, `validate` 결과, 큐 대기 여부와 현재 머지 큐 항목을 한 표로 보여 준다.

### 5. 정리 — `scripts/parallel/cleanup.sh --merged | <slug>...`

`origin/main`에 머지된 브랜치의 워크트리와 로컬·원격 브랜치를 제거한다. 미커밋 변경이나 미머지 브랜치는 `--force` 없이는 건너뛴다.

### 6. 릴리스 — `scripts/parallel/release.sh [--sites-remote <url>] [--record-pr]`

- 검증된 `origin/main`의 `Validate Orbit`이 success인지 확인한다(아니면 중단, `--allow-unverified`는 사유 기록 필수).
- `--sites-remote`(또는 `ORBIT_SITES_REMOTE_URL`)를 주면 토큰을 비표시 입력으로 받아 그 SHA를 Sites 소스 `main`으로 fast-forward push한다. 토큰은 인수·파일·로그에 남기지 않는다. Sites 쪽에 GitHub에 없는 커밋이 있으면 중단한다.
- `docs/releases/<날짜>-<sha7>.md`에 GitHub SHA → tree → CI → Sites push 결과를 기록한다. `--record-pr`은 이 기록을 별도 docs PR로 큐에 올린다.
- Sites publication(배포 ID 생성) 자체는 Sites 도구에서 실행한다. 이 단계는 "검증된 소스 인계"이며 배포 완료가 아니다.

### 7. 배포 검증 — `scripts/parallel/verify-deploy.sh <github-sha> [--url ...]`

`ORBIT_RELEASE_HEALTH_TOKEN`으로 `/api/deployment-health`를 호출해 보고된 `tree`가 GitHub SHA의 tree와 같은지 확인한다. 같을 때만 "운영 반영"으로 보고한다. `unknown`이면 이 변경 이전 빌드이거나 git 없는 빌드다(`ORBIT_SOURCE_TREE` 환경변수로 주입 가능).

## GitHub 설정 — `scripts/parallel/github-setup.sh [--dry-run] [--remove]`

- 저장소: `delete_branch_on_merge`, `allow_auto_merge`, `allow_update_branch` 켬. 머지 커밋 방식 유지.
- 룰셋 `main-integration`(기본 브랜치): PR 필수(merge 방식만), required check `validate`, 머지 큐(MERGE, 1~5개, 대기 0분, 응답 시한 30분), 삭제·non-fast-forward 금지, 우회 대상 없음.
- 긴급 시 소유자가 룰셋을 비활성화하거나 `--remove`로 삭제한다. 그 사실을 기록한다.

## 규칙 요약 (모든 에이전트 공통, AGENTS.md와 동일)

1. 머지 = 큐 진입. REST merge 직접 호출 금지.
2. 마이그레이션은 append-only. 번호가 겹치면 통합된 `main` 위에서 다시 생성.
3. 의존성·lockfile 변경은 단독 소형 PR.
4. `CHANGELOG.md`는 날짜 섹션 단위로 추가.
5. GitHub 머지 = 소스 릴리스. `verify-deploy.sh`가 tree 일치를 확인했을 때만 운영 배포로 보고.

## 알려진 한계

- 큐는 PR을 순차 검증하므로 동시 PR 5개면 최대 10분 안팎 지연된다(CI 약 2분).
- `merge=union`은 같은 위치에 삽입된 두 섹션의 순서를 바꿀 수 있다. 내용은 잃지 않는다.
- Sites publication은 자동화 대상 밖이다. `release.sh`는 소스 push와 기록까지만 담당한다.
- 이 변경 이전에 배포된 빌드는 `tree`를 `unknown`으로 보고한다.
