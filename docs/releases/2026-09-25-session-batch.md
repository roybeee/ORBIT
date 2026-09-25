# Releases 2026-09-25 (KST, one session) · Slack/Google/ORBIT sync follow-ups and 결재함

Every row: GitHub `main` merged through a validated PR, then `publish-sites.sh` (Codex) published that exact
tree (`published`, deployment `succeeded`), and the owner browser's same-origin `GET /api/version` reported the
same tree right after (`runtime-verified`). Each release superseded the previous one.

| main | Change | Tree | Deployment | Publish report |
|---|---|---|---|---|
| `5c92aa5` | #108 최근 30일 회의만 자동 요약(+#107 다른 세션) | `c4939dceadae…` | `appgdep_6ab584fce9c881919c74ceb6d17687ea` | [report](publish-reports/5c92aa5.md) |
| `56b7f71` | #109 보류 표시 | `710e76b2ff11…` | `appgdep_6ab5879f2614819180a3e557fe8bb60f` | [report](publish-reports/56b7f71.md) |
| `df57ce7` | #118 결재함 회의 결정 목록 | `bbcd6df16635…` | `appgdep_6ab5f2f19ca881918e00d7244a51929c` | [report](publish-reports/df57ce7.md) |
| `2dd6352` | #119 마감 미정 한 번에 승인 | `a0a5e529a258…` | `appgdep_6ab5f5a589a081919009077ae742f67a` | [report](publish-reports/2dd6352.md) |
| `fcb63f0` | #122 펼친 줄에 회의 카드 | `6a3da229bbe4…` | `appgdep_6ab61ed0408881919c6e91a2a65d3854` | [report](publish-reports/fcb63f0.md) |
| `96ea59d` | #123 처음부터 회의 카드 | `10d0fa083446…` | `appgdep_6ab6223c61e08191b3c746f1c9acc233` | [report](publish-reports/96ea59d.md) |
| `6f36e40` | #124 통합 즉시 반영·일괄 막대 상단 | `1b94d6eb1628…` | `appgdep_6ab63436b664819194b666a6d83c57f4` | [report](publish-reports/6f36e40.md) |
| `e5d6347` | #125 상한은 최근 7일만 | `d3180662e180…` | `appgdep_6ab639ae856481918c9d00c0b57186ec` | [report](publish-reports/e5d6347.md) |
| `7268443` | #126 회의 분석 한 번에 한 건 | `66ed2c60bed5…` | `appgdep_6ab648ebf5cc8191b7ce27e0d04a73cd` | [report](publish-reports/7268443.md) |
| `1006ac2` | #128 새 프로젝트 먼저(+#127 다른 세션) | `46ea7716a47f…` | `appgdep_6ab64d51d8e08191921e5b6ee10e4e07` | [report](publish-reports/1006ac2.md) |
| `49eff27` | #130 없는 프로젝트는 회의 프로젝트로 | `d61434bf9d64…` | `appgdep_6ab6588022688191ac8515f46bfc8327` | [report](publish-reports/49eff27.md) |
| `5682a30` | #131 마감일 지정하고 승인 | `cef8e5dff01a…` | `appgdep_6ab68485b0148191ab9fffd88bb44081` | [report](publish-reports/5682a30.md) |
| `a317b42` | #132 새 카드 7일 노출·반려 프로젝트 카드 이동 | `355728694aea…` | `appgdep_6ab688595ea081918238231a61763241` | [report](publish-reports/a317b42.md) |
| `62dfe28` | #133 상한은 회의 날짜 기준 | `f70a7fb8b6cf…` | `appgdep_6ab68b204f5c81918cf70d524bcd8c12` | [report](publish-reports/62dfe28.md) |
| `c3e7f1e` | #134 틀린 결재안만 제외 | `78fe2c507d62…` | `appgdep_6ab68e26edb881918fff73e2dcdbb57f` | [report](publish-reports/c3e7f1e.md) |

Production follow-up checks (real): after #125–#130 all 67 meetings recorded in the last 30 days had completed
reviews (0 failed); after #132 the six 엑스더리그 cards stranded by a rejected project proposal were moved to
the meeting project by the runtime tick. Live 결재함 test with disposable data (merge-applies, bulk approve with
shared due date, two-click reject) passed on 96ea59d/6f36e40; the test data was deleted.
