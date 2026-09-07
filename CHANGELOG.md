## 2026-09-07 · Android 공유 등록 복구

- 설치 아이콘을 manifest에 포함하여 Chrome의 쿠키 없는 아이콘 요청 의존성을 제거했습니다.
- 현재 화면의 공유 설정/수신 워커 점검과 Android 설치 대기·복구 안내를 추가했습니다.
- 웹 화면 준비와 실제 Android 앱 등록 완료를 구분합니다.

## 2026-09-06 · 공유 파일과 빠른 첨부

- Android 설치 앱에서 공유받은 파일을 대화나 일정으로 보관합니다.
- 이미지·영상·문서 첨부, 드래그앤드롭, 이미지 붙여넣기와 업로드 상태/재시도를 추가했습니다.
- 소유자 전용 원본 저장과 동영상 탐색, Hermes 이미지 미리보기·문서 텍스트 전달을 지원합니다.
- 화면 이동 시 대화 유지, 최근 대화 즉시 표시, 업무 토글의 즉각적인 반응을 적용했습니다.
- 공유 임시 보관, 원본 저장 확인 유실과 AI 중복 실행 방지를 검증했습니다. iOS는 앱 내 파일 선택을 사용하며, 영상 AI 입력은 첫 프레임으로 제한합니다.

## 2026-09-06 · 프로젝트별 AI 대화

- 새 대화, 대화 제목 편집, 프로젝트별 보관함과 프로젝트에서 대화 열기를 추가했습니다.
- 기존 단일 대화를 보존하며, Hermes의 이력과 세션을 대화별로 분리했습니다.
- 대화 전환 중 비동기 응답이 섞이지 않도록 하고, 이전 메시지 페이지와 전역 검토함을 유지합니다.
- 프로젝트 삭제 시 대화를 일반 대화로 남기며, 기존 진행 중 실행과 승인 기록을 보존하는 스키마 마이그레이션을 추가했습니다.

# Changelog

## v0.5.2 · 2026-09-06

- Fix standalone sessions that receive verified Sites email claims without the stable user ID: resolve only an email-to-ID link previously observed together in a verified request.
- Preserve existing owner IDs and encrypted integration credentials. Conflicting identities disable email-only recovery; unknown identities receive a recovery page instead of a redirect into a missing reserved sign-in route.
- Add a schema-only identity-link migration and regressions for standalone access, existing records, conflicting accounts and safe recovery redirects.

## v0.5.1 · 2026-09-06

- Extend installation to Mac (Safari, Chrome, Edge) and Windows (Edge, Chrome), retaining Android and iPhone/iPad support.
- Detect the device and browser, provide accessible device tabs and browser selection, and distinguish install requests from completed installations.
- Launch the agent before manual installation so Safari Add to Dock opens the conversation; remove setup parameters before pinning.
- Add an install entry on the first conversation screen, root-address copying, same-account guidance and desktop documentation.
- Validate desktop/mobile user-agent detection, standalone manifest launch and the protected install route. Physical OS installation remains a device-level verification.

## v0.5 · 2026-09-06

- Replaced direct OpenAI model calls and API-key setup with authenticated native Hermes Agent runs; model/provider remain managed by the existing Hermes instance.
- Added durable run IDs, native idempotency keys, foreground reconciliation, explicit stop control and owner isolation. Responses become validated approval cards; transport errors never publish partial cards.
- Added a direct read-only Plaud Streamable HTTP MCP client, independent of model-provider connectors. Google primary calendar uses its existing official Calendar adapter.
- Fixed Plaud login startup to use the app's pre-registered OAuth client; retained PKCE and one-use owner/cookie state. Connection cards show local progress/errors and an authorization link fallback.
- Added an existing-Mac Hermes setup helper and guide, plus regression coverage for failed connections, lost acknowledgements, cancellation and stale proposals.


## 0.4.0 — 2026-09-06

- Conversation is the default screen; Korean mobile composer, persistent history, source references and approval/defer inbox.
- Real Responses API tool loop uses owner-scoped workspace and document context; all changes are persisted proposal cards until explicit approval.
- Plaud official remote MCP with dedicated dynamic registration, PKCE and encrypted app credentials.
- Google Calendar MCP plus own OAuth setup, primary-calendar paging/normalization, live conflict checks and repeat-safe approved creation without attendees or notifications.
- AES-GCM owner/provider-bound secrets; one-use OAuth state, serialized token refresh, turn/action leases and workspace revision checks.
- Existing calendar/planner approvals refresh connected busy periods; imported events are edited in Google.
- Sixteen agent/integration tests and protected API tests added to CI. External API tests use synthetic responses; real OAuth and paid inference require app-side credentials and consent.
- No automatic nightly scheduler, push delivery, bulk import or physical-device QA.

## 0.3.1 — 2026-09-06

- Private `/install` guide for Galaxy/Android and iPhone, deferred install prompt, cancellation fallback and actual standalone/install event detection.
- Credentialed manifest link for authenticated hosting, maskable/Apple icons and app shortcuts.
- Mobile keyboard-aware forms, safe areas, larger touch targets and screen history for the phone Back action.
- Foreground/reconnection refresh respects open edits and unresolved saves; offline status does not claim a successful save.
- Static-only offline caching validates response types and excludes sign-in redirects, private records and APIs.
- Seven PWA policy/asset checks plus a protected installation-route check added to CI.
- GitHub connection completed; source updates are maintained in roybeee/ORBIT.
- Scope: installable web app (PWA); no store package, offline record editing, scheduled push notifications or physical-device QA.

## 0.3.0 — 2026-09-06

- Immutable document versions, on-demand bodies, paged current-body search and history.
- Atomic, lossless v2 document migration with preserved IDs and task links.
- Explicit meeting action candidates, editable acceptance and immutable source citations.
- Same-source duplicate prevention, including after unrelated meeting edits.
- Previous/current document comparison and restore as a new version.
- Streaming current-record export includes complete document bodies.
- Eleven note/migration/search tests and six built-Worker route tests, alongside eighteen existing planner/storage tests.
- GitHub creation/push script and a prefilled private-repository link prepared; actual creation remains blocked by missing callable creation/authentication.
- Limits: catalog metadata remains bounded; no LLM inference, external sync, automatic nightly scheduler, bulk imports or browser/device QA.

## 0.2.0 — 2026-09-06

- Account-scoped D1 persistence, atomic revision checks and replay-safe commands.
- Protected workspace and API; isolated `/demo` without durable sample records.
- Live dates, week navigation, project/task/note/event editing and date-based review history.
- Server proposal approval/revoke; hold reason and next review date carried across future plans.
- User workday/timezone/capacity preferences and JSON export.
- PWA manifest, app icons, privacy-conscious static offline explanation.
- Ten storage/date tests plus five built-Worker auth/API tests; original eight planner tests retained.
- Limitations: no live connectors, LLM, scheduled notifications, offline records, import/restore or real-device QA. GitHub remote still awaits repository access.

## 0.1.0 — 2026-09-06

- Product specification, information architecture, data model, approval rules and release backlog.
- Korean responsive workspace with Today, Calendar, Tasks, Projects, Wiki, Knowledge, Evening Review and Tomorrow Proposal.
- In-session creation and navigation of sample tasks, projects, events and records.
- Deterministic scheduling, fixed-event protection, capacity/energy limits and dependency checks.
- Approval, defer reason, re-review, revoke and decision-preserving regeneration.
- Scheduling tests, server render smoke test and GitHub CI/Issue/PR templates.
- Boundary: no persistent user records, live integrations, LLM, scheduler, PWA or remote GitHub connection yet.
