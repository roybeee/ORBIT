# Orbit · 나의 운영실

일정, 프로젝트, 개인 위키, 지식창고, 저녁 회고와 다음 날 제안을 연결하는 개인 매니지먼트 앱.

**현재: v0.5 헤르메스 실행 연결과 Plaud 인증 수정.** 첫 화면에서 내 Hermes Agent와 대화하고, 제안을 승인하거나 이유와 검토일을 남겨 보류합니다. [Mac의 Hermes 연결 안내](docs/Hermes_Setup.ko.md)에 따라 HTTPS gateway 주소와 연결 암호를 등록합니다. Plaud 공식 MCP와 Google Calendar OAuth를 통해 기록을 조회합니다. 자동 야간 실행·푸시 알림은 아직 제공하지 않습니다.

## Phone installation

[Orbit 설치 안내](https://orbit-personal-os.hflameb.chatgpt.site/install)를 폰의 Chrome에서 열고 같은 ChatGPT 계정으로 로그인하세요. 설치 버튼 또는 브라우저 메뉴로 설치한 뒤 홈 화면의 Orbit 아이콘으로 실행합니다. iPhone은 Safari의 공유 → 홈 화면에 추가를 사용합니다. [자세한 모바일 안내](docs/Orbit_Mobile.ko.md).

## Use

1. `/` 대화 화면의 **연결**에서 AI와 필요한 계정을 설정합니다. 첫 프로젝트의 목표를 이야기하거나 직접 추가합니다.
2. 회의록·지식을 프로젝트에 연결하고, 명시한 할 일을 검토해 등록합니다.
3. 저녁 회고를 저장하고 다음 날 제안을 생성합니다.
4. 개별 승인 또는 다음 검토일을 지정한 보류를 선택합니다.
5. 승인한 날짜의 일정에서 집중 시간을 확인합니다.

`/demo`는 저장되지 않는 예시입니다. 설정에서 시간대·업무 시간·요일·핵심 결과물 개수·여유 시간 비율을 바꾸거나 저장한 데이터를 JSON으로 내보낼 수 있습니다.

## Documents

- [AI 에이전트·Plaud·Google 연결과 사용 안내](docs/Orbit_Agent.ko.md)

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

## Storage and mobile scope

D1 stores atomic workspace metadata and request receipts, with immutable document versions in separate owner-scoped rows. Bodies load on demand, current-body search returns 24 records per page, and revision history returns 10. Legacy notes migrate atomically on the next acknowledged write. The metadata aggregate remains bounded to 950,000 UTF-8 bytes; each document to 100,000 characters, subject to the 400,000-byte request limit. Large collections still need a normalized/paged metadata catalog before bulk ingestion. JSON export streams current document versions; it excludes historical revisions, agent conversations/decisions, connection secrets and unsaved forms.

The app includes an authenticated install guide, supported-browser install prompt, standalone detection, credentialed manifest, regular/maskable/Apple icons and scoped shortcuts. Mobile forms account for the keyboard and safe areas. Reconnecting or returning to the foreground refreshes saved records when no edit or unresolved mutation is pending. A static offline fallback never caches private records or authenticated HTML. Offline data editing is not supported. The source, Worker routes and service worker policies are automatically checked; actual installation and touch interaction on a physical phone still require device verification.

## GitHub source and workflow

Source repository: [roybeee/ORBIT](https://github.com/roybeee/ORBIT). The repository is public; the running personal workspace remains protected by Sites sign-in and owner access. Real workspace records are held separately in D1.

The repository contains the complete application, locked dependencies, schema migrations, design/release documents, tests, and CI/Issue/PR templates. The initial import preserves the source snapshot; earlier development commits are retained in the separate Sites source repository.

For each update, create a feature branch, open a pull request and check **Validate Orbit**. GitHub CI installs dependencies, checks types, runs planner/storage/document/agent/calendar/OAuth tests, builds the Worker and checks its HTTP routes. Deployment is a separate verified Sites release; pushing code does not automatically change the running app.

See [GitHub development instructions](docs/GitHub_Connect.ko.md) and [contribution workflow](CONTRIBUTING.md).

## Privacy

Do not commit real meetings, calendars, tokens, local databases, account credentials or exports. Use synthetic fixtures. Keep the Site private; owner identity and reference checks belong on the server.
