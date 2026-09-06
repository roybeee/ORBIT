# Orbit · 나의 운영실

일정, 프로젝트, 개인 위키, 지식창고, 저녁 회고와 다음 날 제안을 연결하는 개인 매니지먼트 앱.

**현재: v0.5.2 설치 앱 로그인 복구와 Mac·Windows·휴대폰 설치 지원.** 첫 화면에서 내 Hermes Agent와 대화하고, 제안을 승인하거나 이유와 검토일을 남겨 보류합니다. [Mac의 Hermes 연결 안내](docs/Hermes_Setup.ko.md)에 따라 HTTPS gateway 주소와 연결 암호를 등록합니다. Plaud 공식 MCP와 Google Calendar OAuth를 통해 기록을 조회합니다. 자동 야간 실행·푸시 알림은 아직 제공하지 않습니다.

## Mac, Windows and phone installation

[Orbit 설치 안내](https://orbit-personal-os.hflameb.chatgpt.site/install)를 설치할 기기의 브라우저에서 열고 같은 ChatGPT 계정으로 로그인하세요. 기기와 브라우저를 감지해 설치 버튼 또는 메뉴 안내를 제공합니다. 첫 대화 화면의 **앱 설치**에서도 들어갈 수 있습니다.

- **Mac:** Safari(macOS Sonoma 14 이상)의 파일 → Dock에 추가, 또는 Chrome·Edge의 앱 설치 메뉴를 사용합니다.
- **Windows:** Edge 또는 Chrome으로 설치하고 시작 메뉴·작업표시줄에서 실행합니다.
- **휴대폰:** Android는 Chrome, iPhone·iPad는 Safari의 홈 화면에 추가를 사용합니다.

설치 안내의 **Orbit 열고 설치**로 대화 화면을 연 뒤 설치하면 Orbit 아이콘에서 에이전트 대화로 시작합니다. 설치형 웹 앱(PWA)이며 업무 저장과 Hermes 대화에는 인터넷 연결이 필요합니다. [컴퓨터 안내](docs/Orbit_Desktop.ko.md) · [휴대폰 안내](docs/Orbit_Mobile.ko.md).

## Use

1. `/` 대화 화면의 **연결**에서 AI와 필요한 계정을 설정합니다. 첫 프로젝트의 목표를 이야기하거나 직접 추가합니다.
2. 회의록·지식을 프로젝트에 연결하고, 명시한 할 일을 검토해 등록합니다.
3. 저녁 회고를 저장하고 다음 날 제안을 생성합니다.
4. 개별 승인 또는 다음 검토일을 지정한 보류를 선택합니다.
5. 승인한 날짜의 일정에서 집중 시간을 확인합니다.

`/demo`는 저장되지 않는 예시입니다. 설정에서 시간대·업무 시간·요일·핵심 결과물 개수·여유 시간 비율을 바꾸거나 저장한 데이터를 JSON으로 내보낼 수 있습니다.

## Documents

- [AI 에이전트·Plaud·Google 연결과 사용 안내](docs/Orbit_Agent.ko.md)

- [Mac·Windows 설치와 사용 안내](docs/Orbit_Desktop.ko.md)
- [휴대폰 설치와 사용 안내](docs/Orbit_Mobile.ko.md)
- [v0.3 사용 안내와 현재 범위](docs/Orbit_Release_v0.3.ko.md)
- [GitHub 생성·연결 준비](docs/GitHub_Connect.ko.md)
- [원본 제품 설계 v0.1](docs/Orbit_Design_v0.1.ko.md)
- [아키텍처와 저장 경계](docs/ARCHITECTURE.md)
- [개발 백로그](docs/BACKLOG.md)
- [기여 / GitHub 운영](CONTRIBUTING.md)
- [변경 이력](CHANGELOG.md)

## Development and checks

Node 22.13+ is required. The Node 22 release line is used in CI.

```bash
npm ci
npm run typecheck
npm run test:planner
npm run test:storage
npm run test:notes
npm run test:pwa
npm run test:agent
npm run build
npm run test:smoke
```

Use the Sites skills for development/hosting inside ChatGPT Work. The current Site identity and D1 binding are in `.openai/hosting.json`. `npm run db:generate` creates schema migrations. Migrations are applied by Sites publication; runtime handlers never create tables. The smoke test loads the built Worker with a test-only Cloudflare binding adapter.

The authenticated app deliberately does not fall back to a public dev identity or browser-only record storage. Local development must use the supported authenticated environment. Product dates default to Asia/Seoul; data timestamps and date-only values are kept distinct.

## Storage and installation scope

D1 stores atomic workspace metadata and request receipts, with immutable document versions in separate owner-scoped rows. Bodies load on demand, current-body search returns 24 records per page, and revision history returns 10. Legacy notes migrate atomically on the next acknowledged write. The metadata aggregate remains bounded to 950,000 UTF-8 bytes; each document to 100,000 characters, subject to the 400,000-byte request limit. Large collections still need a normalized/paged metadata catalog before bulk ingestion. JSON export streams current document versions; it excludes historical revisions, agent conversations/decisions, connection secrets and unsaved forms.

The app includes an authenticated guide for Mac, Windows, Android and iOS, browser-specific menu instructions, a supported-browser install prompt, standalone detection, credentialed manifest, regular/maskable/Apple icons and scoped shortcuts. Manual installation opens the agent route first so Safari does not pin the help page as the launch URL. Mobile forms account for the keyboard and safe areas. Reconnecting or returning to the foreground refreshes saved records when no edit or unresolved mutation is pending. A static offline fallback never caches private records or authenticated HTML. Offline data editing is not supported. The source, Worker routes and service worker policies are automatically checked; actual OS installation, login hand-off and touch interaction still require verification on the user’s device.

## GitHub source and workflow

Source repository: [roybeee/ORBIT](https://github.com/roybeee/ORBIT). The repository is public; the running personal workspace remains protected by Sites sign-in and owner access. Real workspace records are held separately in D1.

The repository contains the complete application, locked dependencies, schema migrations, design/release documents, tests, and CI/Issue/PR templates. The initial import preserves the source snapshot; earlier development commits are retained in the separate Sites source repository.

For each update, create a feature branch, open a pull request and check **Validate Orbit**. GitHub CI installs dependencies, checks types, runs planner/storage/document/agent/calendar/OAuth tests, builds the Worker and checks its HTTP routes. Deployment is a separate verified Sites release; pushing code does not automatically change the running app.

See [GitHub development instructions](docs/GitHub_Connect.ko.md) and [contribution workflow](CONTRIBUTING.md).

## Privacy

Do not commit real meetings, calendars, tokens, local databases, account credentials or exports. Use synthetic fixtures. Keep the Site private; owner identity and reference checks belong on the server.


### 여러 AI 대화와 프로젝트별 보관

- AI 에이전트의 **새 대화**로 주제별 대화를 만듭니다. 첫 메시지로 제목이 자동 지정되고, 제목 옆 연필 버튼에서 제목과 보관할 프로젝트를 바꿀 수 있습니다.
- **대화 보관함**에서 모든 대화, 일반 대화, 특정 프로젝트를 골라 다시 이어갈 수 있습니다. 작은 화면에서는 **대화 목록**을 엽니다.
- 프로젝트 카드의 **대화 보기**는 해당 프로젝트의 대화 목록을 엽니다. 이 목록에서 만든 새 대화는 그 프로젝트에 연결됩니다.
- 이전 버전의 단일 대화는 **이전 대화**로 보존합니다. 기존 메시지·승인 카드·진행 중인 Hermes 실행 ID는 바꾸지 않습니다. 프로젝트를 삭제하면 연결 대화는 일반 대화로 남습니다.
- Hermes의 대화 이력과 세션 키는 대화별로 분리합니다. 같은 소유자의 일정·할 일·위키 등 워크스페이스 정보는 공통 참고 자료입니다. 검토함은 모든 대화의 미결 제안을 모읍니다.
- 한 번에 하나의 Hermes 응답을 진행합니다. 응답 중에도 다른 대화를 열거나 새 대화를 만들 수 있고, 응답이 끝나면 다음 메시지를 보낼 수 있습니다.
- 대화와 프로젝트 연결은 로그인한 계정의 서버에 자동 저장됩니다. 기존 워크스페이스 JSON 내보내기의 범위는 변경하지 않습니다.

## 파일 공유와 첨부

- 갤럭시: Chrome으로 설치한 Orbit이 Android 공유 대상에 등록됩니다. 갤러리/파일 앱에서 공유 → Orbit → 대화 또는 일정 선택. 기존 설치의 공유 목록 갱신에는 하루 이상 걸릴 수 있으므로 먼저 앱을 다시 열고, 대기 중에는 앱 안의 파일 첨부를 사용합니다.
- iOS에서는 OS 공유 대상으로 받기를 지원하지 않습니다. 대화·일정의 파일 선택기를 사용합니다. Mac/Windows는 파일 선택, 드래그앤드롭, 대화 입력란에 이미지 붙여넣기를 지원합니다.
- 한 메시지/일정에 최대 8개, 이미지·문서 25 MB/개, 영상 100 MB/개. OS 공유는 전체 150 MB 이내입니다. PDF, Office, 텍스트와 주요 이미지/영상 형식을 받으며 재생/미리보기 가능 여부는 기기 코덱에 따릅니다.
- 공유 파일은 우선 기기에 24시간 임시 보관됩니다. 로그인 후 원본을 업로드하며, 실제 메시지/일정 저장 전까지 받은 파일에서 다시 시작할 수 있습니다. 임시 항목 정리는 서버에 보관한 원본을 지우지 않습니다.
- 사진과 PDF 첫 페이지, 영상 첫 프레임의 작은 JPEG를 Hermes 네이티브 `/v1/runs` 입력에 전달합니다. 문서는 추출 가능한 텍스트 최대 12,000자(PDF 최대 30페이지)를 전달합니다. 영상 음성/전체 영상 분석은 제공하지 않으며, 구형 Office/지원하지 않는 코덱은 원본 보관만 가능합니다. 연결된 Hermes가 멀티모달 durable runs 입력을 지원해야 합니다.
- 원본/미리보기는 소유자 인증을 거쳐 R2에서 스트리밍하며 D1에는 메타데이터와 소유 관계만 저장합니다. 영상 탐색은 HTTP Range를 사용합니다. 개인 파일·HTML/API를 서비스 워커 캐시에 저장하지 않습니다.
- 화면 이동 중 대화와 작성 내용을 유지하고, 최근 대화는 즉시 표시한 뒤 최신 내용을 확인합니다. 완료/핵심 업무 토글은 즉시 반영하고 저장 실패 시 되돌립니다. PDF/Office 처리 코드는 해당 파일을 첨부할 때만 불러옵니다.
- JSON 내보내기는 업무·문서 기록을 내보내며 첨부 원본을 포함하지 않습니다. 첨부 원본은 해당 대화/일정에서 별도로 내려받으세요.

자동 검사에는 임시 공유 트랜잭션, 파일 소유권, 첨부 원자성, 업로드 확인 유실, 동영상 범위 전송, Hermes 동일 요청 재개가 포함됩니다. 실제 휴대폰의 공유 목록 등록과 연결된 Hermes의 이미지 답변은 사용자 기기에서 확인해야 합니다.
