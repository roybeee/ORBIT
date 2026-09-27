# 저장 및 일괄 반려 수정 — 2026-09-28

일정·할 일·프로젝트의 일반 저장을 기기에 먼저 보관하고 즉시 표시하며, 서버 확인 전에는 동기화 중으로 구분합니다. 요청은 순서대로 전송하고 응답 유실은 같은 요청 번호로 복구합니다. 관계없는 변경과 서로 다른 필드는 자동으로 병합하고, 같은 필드의 충돌은 입력을 보관합니다. 회의 일괄 반려는 선택한 승인 대기 항목에만 적용됩니다.

- Source: merged.
- Deployment: published (deployment service reported success).
- Typecheck and 938 application tests: passed. SQLite storage is real; delayed/lost/offline network scenarios use mocked transport.
- Python-less cold/warm setup checks: five passed each.
- Runtime verification: blocked. Authenticated version reading was unavailable (401 before publication; timeout on the post-publication read). No live version or physical-device latency is claimed.
- Actual Google round-trip latency and Android physical-device checks: not_run.

This public summary intentionally excludes internal deployment identifiers, runtime credentials and private operational URLs.
