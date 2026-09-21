# ORBIT conversation execution

Ordinary text chat uses OpenAI Responses directly when `OPENAI_API_KEY` is configured on the server and `ORBIT_DIRECT_CHAT_ENABLED` is not `false`. `ORBIT_CHAT_MODEL` defaults to `gpt-5.6-luna`. Configure the key as a Sites secret through the OpenAI Developers key workflow; never put it in source, browser storage or the hosting manifest. With no key, new turns use the existing Hermes connection. No new external account is required for the latency improvements.

The provider and model are recorded when each durable job is created. Existing jobs with no provider field remain Hermes. Planning briefs, full-corpus analysis, attachments and approved execution orders retain their Hermes routes. Changing the feature flag affects new turns only. No fallback occurs after an ambiguous OpenAI submission; it fails visibly so inference is not silently duplicated. This is not a promise of provider-level exactly-once inference.

Both transports feed the same validated read/proposal protocol. Owner isolation, evidence verification, full-note revision checks, workspace conflict checks, cancellation, approval cards and idempotent writes remain unchanged. Direct chat does not execute a proposed mutation. Final output and cards are exposed only after validation.

Normal chat reads the saved calendar cache and includes its update time and coverage in the model context. It does not wait for a calendar import or export. Existing calendar sync routes and the runtime continue to synchronize; an explicit `google_calendar_read` still fetches live data. Calendar write-time conflict validation remains in place.

After durable acknowledgement, the server advances consecutive preparation, read, submission and finalization steps within a bounded execution window. A live authenticated progress stream reconnects to the saved job and updates the UI. The stream sends status only, not raw provider JSON or unvalidated answer text. A remote running state yields instead of tight-looping; legacy polling remains a recovery path. Closing a stream does not cancel the job; the explicit stop button does.

`orbit.agent.timing` worker log records contain the turn ID, provider, phase, round, duration and elapsed milliseconds, never prompts, keys, retrieved records or generated content. Compare prepare/submit/poll/read and total durations before making latency claims. Mock transport tests validate behavior, not actual model response time.

Enablement: add the server secret, optionally choose an accessible model with `ORBIT_CHAT_MODEL`, and deploy the runtime configuration. Confirm direct replies in timing logs with a new text conversation. Remove/disable only for new turns when rolling back; let existing direct requests complete or explicitly cancel them.
