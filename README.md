# Orbit · 나의 운영실

일정, 프로젝트, 개인 위키, 지식창고, 저녁 회고와 다음 날 제안을 연결하는 개인 매니지먼트 앱.

**현재: v0.1 인터랙티브 설계 시안.** 예시 데이터이며 변경 내용은 새로고침하면 초기화됩니다. AI·외부 캘린더·서버 저장·예약 실행·PWA 설치는 아직 연결하지 않았습니다.

## Design

- [전체 설계서](docs/Orbit_Design_v0.1.ko.md)
- [아키텍처와 구현 경계](docs/ARCHITECTURE.md)
- [개발 백로그](docs/BACKLOG.md)
- [기여 / GitHub 운영](CONTRIBUTING.md)
- [변경 이력](CHANGELOG.md)

## Try the prototype

1. 오늘의 핵심 결과물의 상세와 연결 회의록을 확인합니다.
2. 프로젝트 또는 위키에서 할 일을 추가합니다.
3. 저녁 회고에서 에너지를 선택하고 내일 제안을 생성합니다.
4. 제안을 승인한 뒤 9월 7일 일정에 집중 시간이 생겼는지 확인합니다.
5. 보류 사유 기록, 승인 취소와 재생성을 확인합니다.

All source records are synthetic examples. Do not enter important information into this prototype expecting persistence.

## Development

Node 22.13+ is required by the supplied toolchain. The Node 22 release line is used in CI.

```bash
npm ci
npm run typecheck
npm run test:planner
npm run build
npm run test:smoke
npm run dev
```

This is a React / TypeScript / Vinext project with a Worker-compatible build. Use the Sites skills for publication in ChatGPT Work; the source identity is in `.openai/hosting.json`. For local development, follow the project's existing npm commands. The Worker environment is typed to the capabilities used by this prototype.

## GitHub status

The requested private GitHub remote is **not connected yet**: the linked account returned no accessible repositories or installations during this session. CI and issue/PR templates are prepared; CI has not run remotely. Supply a private repository URL and allow the GitHub app to access it before pushing. Never describe the separate Sites source repository as GitHub.

## Privacy

Keep real meetings, calendars, databases, tokens and source credentials out of this repository. Public release is not configured. See the design document for the production owner boundary and approval model.
