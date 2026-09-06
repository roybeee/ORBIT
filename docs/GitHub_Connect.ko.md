# Orbit GitHub 개발 연결

저장소: [roybeee/ORBIT](https://github.com/roybeee/ORBIT) · 기본 브랜치 `main` · 공개 소스

ChatGPT Codex Connector 설치 후 저장소 쓰기가 활성화되었습니다. 초기 가져오기는 기존 v0.3 소스의 전체 스냅샷이며, 이전 개발 커밋은 Sites의 소스 원격에도 보관되어 있습니다. GitHub와 Sites의 커밋 번호는 서로 다를 수 있습니다.

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
npm ci
npm run typecheck
npm run test:planner
npm run test:storage
npm run test:notes
npm run test:pwa
npm run build
npm run test:smoke
```

Node 22.13 이상과 기존 도구 구성을 사용합니다. 서버는 Sites의 로그인과 D1 환경을 사용하며, 일반 정적 GitHub Pages에 업로드하는 방식으로 실행되지 않습니다. 인증을 우회하는 로컬 사용자나 브라우저 저장소 대체는 추가하지 않습니다.

## 기능 업데이트

1. `docs/BACKLOG.md`에서 다음 결과물과 완료 기준을 정합니다.
2. `main`에서 `feat/...` 또는 `fix/...` 브랜치를 만듭니다.
3. 구현 후 Pull Request를 열고 **Validate Orbit** 결과를 확인합니다.
4. 검토한 변경을 합치고 Sites에서 별도로 검증·배포합니다.

GitHub에 소스를 올리는 것과 실행 중인 앱 배포는 별개입니다. 적용된 데이터베이스 변경 파일은 수정하지 않고 새 파일을 추가합니다.

GitHub에서 복제한 체크아웃은 일반적인 Git push/PR 흐름을 사용합니다. `scripts/connect-github.sh`는 인증된 GitHub CLI 환경에서 같은 저장소로 push하고 결과를 확인하는 보조 스크립트입니다. 별도 이력을 가진 기존 Sites 체크아웃에서 실행하면 일반 Git 이력 충돌이 발생할 수 있으므로 강제 push로 해결하지 않습니다.
