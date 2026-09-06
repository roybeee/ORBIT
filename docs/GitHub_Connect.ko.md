# Orbit GitHub 연결

요청된 저장소: `roybeee/orbit-personal-os` · 비공개 · 기본 브랜치 `main`

2026-09-06 확인: GitHub 계정 `roybeee`는 연결되어 있으나 접근 가능한 설치/저장소가 0개다. 현재 연결 도구에는 저장소 생성 기능이 없으며 작업 환경에 인증된 GitHub CLI 또는 GitHub 토큰도 없다. **GitHub 저장소 생성과 소스 업로드는 아직 완료되지 않았다.** Sites의 소스 보관 원격 저장소는 GitHub와 별개다.

## 계정에서 준비할 설정

[비공개 저장소 생성 화면](https://github.com/new?owner=roybeee&name=orbit-personal-os&visibility=private&description=Orbit+personal+management+workspace)을 열고 생성한다. 기존 코드를 올릴 예정이므로 README·라이선스·gitignore 초기화는 선택하지 않는다. ChatGPT의 GitHub 연결 설정에서 이 저장소 접근을 허용한다. 이름/비공개 설정은 GitHub가 지원하는 [URL 매개변수](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository#creating-a-new-repository-from-a-url-query)로 미리 채웠다.

## 인증된 개발 환경에서 생성과 연결을 한 번에 실행

저장소를 별도로 만들지 않았어도, `roybeee`로 로그인한 GitHub CLI 환경에서 이 소스 체크아웃의 다음 스크립트를 실행하면 비공개 저장소 생성부터 코드 업로드까지 진행한다.

```bash
bash scripts/connect-github.sh
```

스크립트는 계정, 비공개 여부, 깨끗한 main 브랜치, 기존 remote를 확인한다. GitHub 저장소가 이미 있으면 재사용하고 기존 Sites remote를 유지한다. 강제 push를 사용하지 않고, 인증 정보를 파일이나 Git 설정에 기록하지 않는다. 마지막에는 로컬과 GitHub main의 전체 커밋 값이 같은지 확인한다. GitHub CLI가 없거나 인증되지 않았다면 변경 없이 종료한다.

실행 전제: [GitHub CLI 설치](https://cli.github.com/) 및 `gh auth login` 완료. [gh repo create 공식 문서](https://cli.github.com/manual/gh_repo_create).

## 업로드 후 확인

- GitHub의 main이 최신 소스와 일치하는지 확인
- Actions의 Validate Orbit 결과 확인
- `docs/BACKLOG.md`의 미완료 항목을 GitHub Issues로 등록
- 이후 feature 브랜치와 Pull Request로 변경 검토

CI, Issue 양식, Pull Request 양식은 소스에 포함되어 있다. 아직 GitHub에서 실행한 CI 결과나 생성한 Issue/PR은 없다.
