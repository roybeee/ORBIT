# Orbit · 나의 운영실

일정, 프로젝트, 개인 위키, 지식창고, 저녁 회고와 다음 날 제안을 연결하는 개인 매니지먼트 앱.

**현재: v0.2 첫 실사용 기반.** 로그인한 사용자별 서버 저장을 지원합니다. 실제 업무 화면과 저장되지 않는 예시 체험을 분리했습니다. 제안은 규칙 기반이며, AI·외부 캘린더·예약 알림은 아직 연결하지 않았습니다.

## Use

1. `/`에서 첫 프로젝트와 할 일을 추가합니다.
2. 회의록·지식을 프로젝트에 연결합니다.
3. 저녁 회고를 저장하고 다음 날 제안을 생성합니다.
4. 개별 승인 또는 다음 검토일을 지정한 보류를 선택합니다.
5. 승인한 날짜의 일정에서 집중 시간을 확인합니다.

`/demo`는 저장되지 않는 예시입니다. 설정에서 시간대·업무 시간·요일·핵심 결과물 개수·여유 시간 비율을 바꾸거나 저장한 데이터를 JSON으로 내보낼 수 있습니다.

## Documents

- [v0.2 사용 안내와 현재 범위](docs/Orbit_Release_v0.2.ko.md)
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
npm run build
npm run test:smoke
```

Use the Sites skills for development/hosting inside ChatGPT Work. The current Site identity and D1 binding are in `.openai/hosting.json`. `npm run db:generate` creates schema migrations. Migrations are applied by Sites publication; runtime handlers never create tables. The smoke test loads the built Worker with a test-only Cloudflare binding adapter.

The authenticated app deliberately does not fall back to a public dev identity or browser-only record storage. Local development must use the supported authenticated environment. Product dates default to Asia/Seoul; data timestamps and date-only values are kept distinct.

## Storage and mobile scope

D1 stores a versioned owner aggregate and request receipts. This initial aggregate is bounded to 950 KB; individual notes to 100,000 characters. Split note bodies into paged per-record storage before bulk knowledge ingestion. Preserve data across that migration.

The app includes a web manifest, 192/512px icons and a static offline fallback. Private user content is not cached by the service worker. Real device installation and browser interaction have not been verified. Offline data editing is not supported.

## GitHub status

The user's GitHub account still returned no accessible repositories or installations. CI and Issue/PR templates are prepared; remote GitHub CI has not run. A private repository URL and GitHub app access are needed before pushing. The separate Sites Git repository is not GitHub.

## Privacy

Do not commit real meetings, calendars, tokens, local databases, account credentials or exports. Use synthetic fixtures. Keep the Site private; owner identity and reference checks belong on the server.
