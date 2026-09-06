# Changelog

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
