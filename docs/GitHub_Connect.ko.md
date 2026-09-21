# Orbit GitHub 개발 연결

저장소: [roybeee/ORBIT](https://github.com/roybeee/ORBIT) · 기본 브랜치 `main` · 공개 소스

Slack·Hermes, ChatGPT·Codex, Claude의 공통 개발 기준은 **매 작업 시작 시 직접 조회한 GitHub 원격 `main`**입니다. 저장소 루트의 [AGENTS.md](../AGENTS.md)를 먼저 읽습니다. Sites에 저장된 버전이나 이전 대화의 커밋 번호를 다음 작업의 기준으로 사용하지 않습니다.

## 포함된 코드

- 일정·프로젝트·할 일·개인 위키·지식·회고·제안 승인 앱
- 사용자별 서버 저장, 문서 버전·복원·검색, 회의록 행동 검토
- 데이터베이스 스키마 변경 이력과 패키지 잠금 파일
- 제품 설계, 릴리스 안내, 아키텍처, 개발 백로그
- 테스트와 GitHub Actions CI, Issue/PR 양식

실제 회의록, 업무 데이터, 인증 정보, 의존성 설치 폴더, 빌드 출력은 소스에 포함하지 않습니다. 예시 체험 데이터는 명시적으로 구분된 샘플입니다.

## 개발 시작

```bash
git clone https://github.com/roybeee/ORBIT.git
cd ORBIT
git fetch origin --prune
git rev-parse origin/main
git ls-remote origin refs/heads/main
# 위 두 SHA가 같은지 확인하고 작업마다 고유한 브랜치를 만듭니다.
git switch -c fix/my-change origin/main
npm ci
npm run typecheck
npm test
```

Node 22.13 이상과 기존 도구 구성을 사용합니다. 서버는 Sites의 로그인과 D1 환경을 사용하며, 일반 정적 GitHub Pages에 업로드하는 방식으로 실행되지 않습니다. 인증을 우회하는 로컬 사용자나 브라우저 저장소 대체는 추가하지 않습니다.

## 기능 업데이트

1. `docs/BACKLOG.md`에서 다음 결과물과 완료 기준을 정합니다.
2. GitHub `origin` 주소와 최신 원격 `main` SHA를 확인하고 그 커밋에서 `feat/...` 또는 `fix/...` 브랜치를 만듭니다. 진행 중인 작업이 있으면 보존하고 별도 worktree를 사용합니다.
3. 타입 검사와 전체 테스트를 통과한 뒤 Pull Request에 기준 SHA와 검증 결과를 기록합니다. 병합 직전 원격을 다시 확인하고, 변경되었으면 통합 후 검사를 다시 실행합니다.
4. 현재 PR 코드의 **Validate Orbit** 성공을 확인한 뒤 병합하고 원격 `main` SHA를 다시 조회합니다.
5. 앱 업데이트가 요청된 경우 그 병합 소스로 Sites를 검증·배포합니다. GitHub SHA, Sites 버전, 실제 배포 결과를 구분해서 기록합니다.

GitHub에 소스를 올리는 것과 실행 중인 앱 배포는 별개입니다. 적용된 데이터베이스 변경 파일은 수정하지 않고 새 파일을 추가합니다.

GitHub에서 복제한 체크아웃은 일반적인 Git push/PR 흐름을 사용합니다. `scripts/connect-github.sh`는 인증된 GitHub CLI 환경에서 같은 저장소로 push하고 결과를 확인하는 보조 스크립트입니다. 별도 이력을 가진 기존 Sites 체크아웃에서 실행하면 일반 Git 이력 충돌이 발생할 수 있으므로 강제 push로 해결하지 않습니다.

## 2026-09-21 운영 수정본 통합

이 통합은 GitHub 기준 `eee170604de3952ae4064115dbb68dc5e8e07d61`에, 사용자가 선택한 Sites v101의 앱 소스 `c38a8b7299636bfb62b70600fe190801898bfbb1`을 반영합니다. 공통 앱 기준은 `3866db46b88d7740c2274912ae455ca1be70323b`이며, 기존 GitHub 개발 규칙을 보존하고 보완합니다. 원본 수정 이력은 Sites 소스 저장소에도 보존됩니다.

포함된 수정은 저장 데이터 분할 및 기존 데이터 전환, 일정·할 일의 메모·분류·전화·색상과 Google 동기화, 겹치는 일정의 명시적 승인, 대화·제안 재시도 복구입니다. 마이그레이션 `0024`~`0026`은 이 수정본의 원본을 유지합니다. 이미 배포된 데이터베이스에 같은 변경을 다른 번호로 중복 적용하지 않습니다.

위 SHA는 통합 출처를 설명하는 기록입니다. 이후 작업은 항상 새로 조회한 GitHub `main`을 기준으로 합니다. 이 소스 통합 자체는 앱 재배포나 Slack 실행 환경 설정 변경을 뜻하지 않습니다.
