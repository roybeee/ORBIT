# Claude 계정 이전 가이드 (스킬·설정·권한)

지금 쓰는 Claude 계정의 스킬, 설정, 권한, 예약 작업을 다른 Claude 계정에 똑같이 옮기는 절차입니다.
스킬 파일은 스크립트로 묶어 옮기고, 로그인·인증이 걸린 항목(커넥터, GitHub, 비밀값)은 새 계정에서 직접 다시 연결합니다. 인증 토큰은 계정 간에 옮길 수 없고, 옮겨서도 안 됩니다.

## 0. 이전 키트 만들기 (원래 계정에서)

원래 계정의 Claude Code 세션(웹·앱·CLI 모두 가능)에서 실행합니다.

```bash
python3 scripts/claude-account/export-kit.py --routines routines.json --preferences preferences.txt
```

두 옵션은 선택입니다. `routines.json`은 Claude_Code_Remote `list_triggers` 도구 결과, `preferences.txt`는 프로필 선호 문구입니다.

결과물은 `outputs/claude-account-kit/`와 `outputs/claude-account-kit.zip`입니다(`outputs/`는 git에 올라가지 않습니다).

| 파일 | 내용 |
|---|---|
| `README.ko.md` | 이 문서 |
| `skills-inventory.csv` | 스킬 전체 목록과 항목별 조치(엑셀로 열림) |
| `skills-upload/<이름>.zip` | claude.ai에 올릴 스킬 ZIP(스킬 하나당 하나) |
| `claude-code/skills.tar.gz`, `install-skills.sh` | Claude Code CLI·데스크톱용 개인 스킬 설치 |
| `claude-code/settings.template.json` | 현재 세션과 같은 권한 설정 |
| `routines.md` | 예약 작업(Routines) 스케줄·프롬프트·필요 커넥터 |
| `profile-preferences.txt` | claude.ai 프로필 선호 문구 |
| `secret-scan.txt` | 스킬 파일 안에 API 키·토큰이 섞여 있는지 검사한 결과 |

## 1. 프로필 설정

새 계정 claude.ai → Settings → Profile의 선호 문구 칸에 `profile-preferences.txt` 내용을 그대로 붙여넣습니다. 응답 언어·말투 등 나머지 일반 설정도 원래 계정 화면과 나란히 놓고 맞춥니다.

메모리는 파일로 내보낼 수 없습니다. 원래 계정에서 Claude에게 "내 메모리에 저장된 내용을 전부 목록으로 보여줘"라고 요청해 복사한 뒤, 새 계정에서 `import-memory` 스킬(Anthropic 예제 스킬, 2단계에서 켬)로 붙여넣습니다.

## 2. 스킬

`skills-inventory.csv`의 `action` 열대로 처리합니다.

- **설정에서 켜기 (Anthropic 기본 스킬)** — docx, pdf, pptx, xlsx, google-workspace, import-memory, morning, skill-creator. Settings → Capabilities(기능)에서 켭니다. ZIP으로 올리지 않습니다(같은 이름이 겹침).
- **플러그인 재설치 또는 ZIP 업로드** — 마케팅·디자인·영상 스킬 59개. 원래 계정에서 플러그인 디렉터리로 설치한 것들입니다.
  - 권장: 새 계정에서 같은 플러그인을 디렉터리에서 다시 설치합니다. 업데이트를 계속 받습니다. `plugin_id` 열이 원래 계정의 플러그인 ID입니다.
  - 디렉터리에서 찾을 수 없는 것(예: `humanize-korean`, `fable5-parity`, `watch`처럼 따로 추가한 것)은 Settings → Capabilities → Skills → 스킬 업로드에서 `skills-upload/<이름>.zip`을 올립니다.
- Claude Code CLI·데스크톱에서도 쓰려면 `claude-code/install-skills.sh`를 실행합니다. `~/.claude/skills/`에 설치되고, 이미 있는 스킬은 건너뜁니다(`--force`로 덮어쓰기).

## 3. 커넥터 (다시 연결)

토큰은 계정마다 따로이므로 새 계정 Settings → Connectors에서 하나씩 로그인합니다. 같은 서비스 계정으로 로그인해야 데이터가 같습니다.

| 커넥터 | 쓰는 곳 |
|---|---|
| Gmail, Google Calendar, Google Drive | 모닝 브리프, 회의록 동기화, 일정 |
| Notion | 문서·데이터베이스 |
| Plaud | 회의 녹음·전사 |
| Figma, Canva, Adobe for creativity | 디자인 |
| Higgsfield (원래 계정 커넥터 ID `fe58c4f1-…`) | 이미지·영상 생성 |
| Shopify | 스토어 관리 |
| Render | 배포·서버 |
| GitHub | ORBIT 저장소 작업 |

연결 후 커넥터마다 도구 권한(항상 허용/매번 확인)을 원래 계정과 같게 맞춥니다.

## 4. Claude Code 환경·권한

- **GitHub**: 새 계정에서 https://claude.ai/connect-github 로 GitHub를 연결하고, `roybeee/ORBIT` 저장소에 Claude GitHub App 접근을 허용합니다. 저장소의 `CLAUDE.md`·`AGENTS.md`는 저장소에 들어 있으므로 따로 옮길 필요가 없습니다.
- **클라우드 환경**: 원래 계정의 환경은 `Default`(Anthropic 클라우드) 하나입니다. 세션 제목 표시줄의 환경 메뉴 → Edit에서 네트워크 정책, 설정 스크립트(Setup script), 환경 변수를 원래 계정 화면과 똑같이 입력합니다. 환경 변수의 비밀값은 키트에 포함하지 않았으니 원본(비밀번호 관리자 등)에서 다시 넣습니다.
- **권한**: 클라우드 세션의 기본 권한(`Skill` 허용)과 Stop 훅은 클라우드가 자동으로 넣어 줍니다. CLI에서 같게 하려면 `claude-code/settings.template.json`을 `~/.claude/settings.json`에 합칩니다.

## 5. 예약 작업 (Routines)

`routines.md`에 두 개가 있습니다.

| 이름 | 원래 스케줄 | 필요 조건 |
|---|---|---|
| 모닝 브리프 | 평일 08:00 KST (`0 23 * * 0-4` UTC) | `morning` 스킬, Gmail·Calendar 등 |
| 데이터저장소 회의록 일일 동기화 | 매일 07:00 KST 무렵 (`0 22 * * *` UTC) | Gmail, **Claude 프로젝트 "데이터저장소"** |

커넥터(3단계)를 먼저 연결한 뒤, 새 계정의 Claude Code 세션에서 "routines.md의 두 예약 작업을 같은 스케줄·프롬프트로 만들어줘"라고 요청합니다. 회의록 동기화는 Claude 프로젝트 "데이터저장소"의 파일(`claude/ops/동기화-규칙.md`, `claude/ops/sync-log.md`, `claude/meetings/…` 등)을 읽고 쓰므로, 그 프로젝트를 새 계정에 먼저 만들고 파일을 옮겨야 합니다. 프로젝트 파일은 원래 계정의 프로젝트 화면에서 내려받아 새 프로젝트에 올립니다.

원래 계정의 예약 작업은 새 계정 쪽이 한 번 정상 실행된 것을 확인한 뒤에 끕니다. 둘 다 켜 두면 같은 회의록을 두 번 처리합니다.

## 6. 옮겨지지 않는 것

- 대화 기록, 아티팩트: 원래 계정 소유로 남습니다. 필요한 아티팩트는 공유 링크로 넘기거나 새 계정에서 다시 게시합니다.
- 커넥터·GitHub 인증 토큰, 환경 변수 비밀값: 새 계정에서 직접 입력합니다.
- 조직(Team/Enterprise) 관리자 설정: 조직 관리자가 새 계정을 초대하고 권한을 줍니다.

## 확인 체크리스트

- [ ] 프로필 선호 문구 입력
- [ ] Anthropic 기본 스킬 8개 켜기
- [ ] 플러그인 스킬 59개 설치(또는 ZIP 업로드) 후 스킬 목록 개수 확인
- [ ] 커넥터 연결 및 도구 권한 맞춤
- [ ] GitHub 연결, `roybeee/ORBIT` 접근 확인
- [ ] 클라우드 환경(네트워크·설정 스크립트·환경 변수) 입력
- [ ] "데이터저장소" 프로젝트 파일 이전
- [ ] 예약 작업 2개 생성, 첫 실행 성공 확인 후 원래 계정 작업 끄기
