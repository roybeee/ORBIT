# Orbit GitHub 연결

지정 저장소: [roybeee/ORBIT](https://github.com/roybeee/ORBIT) · 기본 브랜치 `main`

## 확인된 현재 상태

- 저장소가 존재하며 공개 상태입니다. 확인 시점에는 비어 있었습니다.
- 로컬 소스의 `github` 원격 주소를 `https://github.com/roybeee/ORBIT.git`으로 설정했습니다.
- 실제 파일 생성 요청이 GitHub의 **HTTP 403: Resource not accessible by integration** 응답으로 거절됐습니다. 계정 권한 메타데이터와 연결 앱의 실제 쓰기 권한은 다릅니다.
- **GitHub 코드 업로드와 CI 실행은 아직 완료하지 못했습니다.** 기존 앱은 별도의 비공개 Sites에서 동작합니다.

## 필요한 연결 설정

ChatGPT의 GitHub 연결 설정에서 `roybeee/ORBIT` 저장소를 사용할 수 있도록 GitHub 앱 설치/접근 범위를 확인해야 합니다. GitHub의 설치된 앱 설정에서 해당 ChatGPT/Codex 연결을 찾아 저장소 접근 대상에 `ORBIT`를 포함하고, 요청된 코드 쓰기 권한을 승인합니다. 설치 항목이 없다면 ChatGPT의 GitHub 연결을 다시 설정합니다.

저장소를 다시 생성할 필요는 없습니다. 토큰이나 비밀번호를 대화에 붙여 넣지 않아도 됩니다. 저장소 접근이 반영되면 준비된 소스를 업로드하고 결과를 확인할 수 있습니다.

## 인증된 개발 환경에서 직접 업로드

GitHub CLI가 설치되어 있고 `roybeee`로 로그인된 개발 환경에서는 다음 명령으로 전체 소스를 지정한 저장소에 업로드할 수 있습니다.

```bash
bash scripts/connect-github.sh
```

스크립트는 `main` 브랜치와 저장 상태, 기존 원격 주소를 확인하고, `roybeee/ORBIT`를 재사용합니다. 기존 이력을 덮어쓰는 강제 push를 사용하지 않습니다. 업로드 후 로컬과 GitHub의 전체 커밋 값이 같은지 확인합니다. GitHub 인증이 필요한 작업이며 이 환경에서는 실제 실행을 완료하지 않았습니다.

## 전달받은 소스 ZIP으로 시작하기

ZIP을 압축 해제하면 앱 소스, 문서, 데이터베이스 변경 이력, CI와 Issue/PR 양식이 들어 있습니다. 실제 업무 데이터와 인증 정보, 의존성 설치 폴더, 빌드 결과물은 들어 있지 않습니다.

압축을 해제한 폴더에 `.git`이 없다면 로컬 Git 이력을 먼저 만듭니다. Git 작성자 이름과 이메일이 설정되어 있어야 합니다.

```bash
git init -b main
git add .
git commit -m "feat: import Orbit personal management app"
bash scripts/connect-github.sh
```

현재 준비한 코드는 기존 로컬 검증 35개를 통과한 앱입니다. 이번 연결 준비에서는 앱 동작을 변경하지 않았습니다. 업로드가 성공하면 GitHub Actions의 Validate Orbit 결과를 확인하고 이후 기능 업데이트는 Issue → feature 브랜치 → Pull Request로 관리합니다. GitHub에 소스를 올리는 것만으로 운영 중인 앱이 자동 재배포되지는 않습니다.
