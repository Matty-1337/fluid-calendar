# FluidCalendar Evaluation — Change Log

All notable changes and findings during the evaluation project are recorded here.

---

## 2026-03-07 — Current State Audit & Hardening Fixes

### Added (documentation)

- **docs/claude-scheduler-current-state-audit.md** — Complete inventory of all scheduler/calendar files, architecture summary, what's complete vs incomplete vs docs-only.
- **docs/claude-scheduler-hardening-verification.md** — Item-by-item verification of 13 hardening requirements with exact file/line evidence. 4 critical NO items, 3 PARTIAL, 2 YES.
- **docs/claude-calendar-writeback-readiness.md** — Writeback maturity assessment: no writeback code exists, 9 hard prerequisites for future implementation.
- **docs/claude-projectops-scheduler-readiness-verdict.md** — Fresh readiness verdict. Executive: NOT READY as-is; READY FOR INTERNAL DRY-RUN after 4 validation fixes. Top 10 next actions prioritized.
- **docs/claude-projectops-scheduler-architecture-judgment.md** — Architecture evaluation: sound design, clean outer boundaries, one inner coupling (TimeSlotManager → Prisma), keep internal for now.

### Code changes (4 critical validation fixes)

- **src/lib/projectops/validation.ts** — `estimatedMinutes`: added `.min(5).max(480)` (was `.positive()`, allowed 1-minute tasks causing 10K+ slots). `tasks`: added `.max(50)` (was unbounded). `timezone`: added `.refine()` with `Intl.DateTimeFormat` IANA validation (was `.min(1)`, accepted any string).
- **src/services/scheduling/TimeSlotManager.ts** — `generatePotentialSlots()`: added `MAX_SLOTS = 5000` cap with `break` guard on the while loop (was unbounded).
- **src/lib/projectops/__tests__/validation.test.ts** — 7 new tests: min/max estimatedMinutes, max tasks, boundary 50 tasks, invalid/valid IANA timezone.

### Findings

- All scheduler/projectops work is uncommitted local changes (not on GitHub). Latest commit `b5c0f2b` contains only repo intelligence layer.
- 0 of 7 minimum hardening actions from MVP verdict had been implemented prior to this session's fixes. Now 4 of 7 are done.
- No calendar writeback code exists anywhere — not even a stub. The `calendarWriteback` field in response types is defined but never populated.
- SlotScorer, TimeSlotManager, and SchedulingService have zero test files. The 43 existing tests cover only the integration/glue layer.

---

## 2025-03-07 (continued)

### Added
- **docs/fluidcalendar-audit.md** — Technical audit: architecture, scheduler core, auth, calendar sync, data model, risks, and extractability for Project Ops.
- **docs/change-log.md** — This file.

### Code changes (timezone fix for #161)
- **TimeSlotManager.ts:** Constructor now accepts optional `timeZoneOverride`. When provided (server path), uses it; otherwise falls back to `useSettingsStore.getState().user.timeZone ?? "UTC"`.
- **SchedulingService.ts:** Constructor now accepts optional `timeZone?: string` and passes it to `TimeSlotManagerImpl`.
- **TaskSchedulingService.ts:** Fetches `UserSettings` for the user in addition to `AutoScheduleSettings`; passes `userSettings.timeZone ?? "UTC"` into `SchedulingService`. Ensures auto-schedule runs in the user’s timezone when invoked from the API.

### Findings (documented in audit)
- Scheduler previously used client-side Zustand store for timezone in `TimeSlotManagerImpl` when run from API (root cause of issue #161).
- `SchedulingService` can still fall back to client store for auto-schedule settings when none passed; invalid on server (mitigated when called from `TaskSchedulingService`, which always passes settings from DB).
- Scheduling logic is rule-based/heuristic and extractable once timezone and settings are supplied from server/DB.

### Documentation deliverables
- **docs/local-setup-log.md** — Docker and local install steps, blockers (Docker daemon, better-sqlite3, Node 25), exact commands.
- **docs/bug-triage.md** — Bug table (B1–B10), prioritization, B1 (timezone) marked fixed.
- **docs/testing-hardening.md** — Current Jest/Playwright coverage, gaps (scheduler, timezone, overlap), suggested tests.
- **docs/railway-deploy.md** — Railway suitability, env vars, Option A (Nixpacks) and B (Docker), DB/migrations, auth callbacks, pitfalls.
- **docs/project-ops-integration-plan.md** — Options A–D, iframe assessment, API exposure, data coupling, field mapping, recommended approach.
- **docs/final-recommendation.md** — Executive summary, what works/broken, effort estimates, go/no-go recommendation, top 10 risks, next steps.

---

## 2025-03-07 — Project Ops Integration PoC Phase

### Added (documentation)

- **docs/project-ops-fluidcalendar-master-plan.md** — Master plan: Phase 1 current state (repo status, scheduler files, bugs, fixes, deployment, risks, posture); Phase 2 integration architecture comparison (Options A–D) with primary C (extraction) and fallback D (reference).
- **docs/project-ops-scheduler-contract.md** — Field mapping table (Project Ops ↔ FluidCalendar), normalized ProjectOpsScheduleRequest and ScheduleResult DTOs.
- **docs/scheduler-extraction-dependency-map.md** — Dependency map: pure vs DB vs store vs provider by file; what to extract now, what needs abstraction, what not to extract.
- **docs/project-ops-sample-payloads.md** — Four sample payloads for POST /api/projectops/schedule (success, conflict, timezone, impossible).
- **docs/project-ops-integration-testing.md** — Tests added (mapper unit), tests missing, highest-risk untested areas.
- **docs/project-ops-hosting-strategy.md** — Hosting options (FC on Railway, scheduler in Project Ops, hybrid, internal only); recommendation (internal PoC first, then extraction or sidecar).
- **docs/project-ops-fluidcalendar-final-decision.md** — Final decision: best model (C), fallback (D), what was implemented, what worked/failed, what remains coupled, continue-invest recommendation, next 10 engineering steps.

### Added (code)

- **src/lib/projectops/types.ts** — ProjectOpsTask, ProjectOpsScheduleRequest, ProjectOpsScheduleSettings, ScheduleResult, TaskScheduleResult.
- **src/lib/projectops/mappers.ts** — projectOpsTaskToCreateInput, projectOpsSettingsToAutoScheduleSettings.
- **src/lib/projectops/schedulerFacade.ts** — runProjectOpsSchedule: create temp tasks, run SchedulingService(settings, timezone), return ScheduleResult, delete temp tasks.
- **src/app/api/projectops/schedule/route.ts** — POST /api/projectops/schedule (authenticated); accepts ProjectOpsScheduleRequest, returns ScheduleResult.
- **src/lib/projectops/__tests__/mappers.test.ts** — Unit tests for mappers (4 tests).

### Not modified

- Existing scheduler files (SchedulingService, TimeSlotManager, TaskSchedulingService, SlotScorer, CalendarServiceImpl); all PoC changes are additive.

---

## 2026-03-07 — Internal Readiness Assessment

### Added (documentation)

- **docs/claude-native-scheduler-internal-readiness.md** — Internal route readiness assessment. Finding: 0 of 7 minimum hardening actions from the MVP verdict were implemented. Code is byte-identical to MVP verdict state. 4 hard blockers for trusted internal use (min duration, max tasks, slot cap, IANA validation), 9 prerequisites for calendar writeback. Recommends dry-run-only integration as next step.

---

## 2026-03-07 — Native Scheduler MVP Verdict

### Added (documentation)

- **docs/claude-native-scheduler-mvp-verdict.md** — Strict architecture review of the scheduling engine as native MVP blueprint. Covers engine design (SlotScorer clean, TimeSlotManager has unbounded slot generation risk), orchestration adequacy, memory/CPU analysis with quantified slot counts, guardrail assessment (7 present, 7 missing), test suite assessment (42 tests, 0 on scoring/slot generation/full pipeline), service-vs-internal recommendation (stay internal), and 7 minimum actions before production use.

---

## 2026-03-07 — Post-Verdict Refactors

### Added (code)

- **src/services/scheduling/types.ts** — `SchedulerTask` and `SchedulerSettings` interfaces: Prisma-independent types that mirror the exact subset of fields the scheduling engine reads. Enables tests, extracted services, or native rebuilds to use the algorithm without importing `@prisma/client`.
- **src/services/scheduling/InMemoryTaskWriter.ts** — `InMemoryTaskWriter` class implementing `TaskWriter` with an in-memory `Map<string, SchedulerTask>`. No database dependency. Includes `getTask()` and `getAllTasks()` test helpers.
- **src/services/scheduling/__tests__/InMemoryTaskWriter.test.ts** — 8 unit tests validating updateScheduledSlot persistence, error handling, fetchTasks filtering, copy isolation, and round-trip consistency.

### Context

These refactors implement the "optional high-value, low-risk" improvements identified in `docs/claude-extraction-verdict.md`. They serve as useful blueprint regardless of whether the team proceeds with Option C (extraction) or Option D (native rebuild):
- `SchedulerTask`/`SchedulerSettings` document exactly which fields the algorithm needs (14 task fields, 12 settings fields vs 30+ in Prisma's Task)
- `InMemoryTaskWriter` validates the TaskWriter abstraction boundary and provides a test double for SchedulingService integration tests

All 43 tests pass (8 new + 35 existing projectops).

---

## 2026-03-07 — Extraction Readiness Phase (Steps 7–10)

### Added (documentation)

- **docs/project-ops-scheduler-api.md** — API documentation for POST /api/projectops/schedule: request/response schemas, auth requirements, sample payloads reference, success/unschedulable examples, conflictWindows and timezone behavior, error cases, validation expectations and gaps.
- **docs/project-ops-auth-strategy.md** — Production auth strategy: comparison of NextAuth session, HMAC service token, API key, mTLS/network; recommendation (HMAC primary, API key for internal fallback); risks and implementation notes.
- **docs/scheduler-extraction-next-step.md** — Extraction analysis: portability of scheduler files, remaining DB blockers, temp-task orchestration note, minimum viable extracted scheduler, interfaces (task input, conflict/calendar, TaskWriter, settings/timezone); TaskWriter abstraction summary.
- **docs/project-ops-scheduler-runbook.md** — Operational runbook: local setup, manual testing, sample payloads, required env, common failure modes, debugging (timezone, overlap, auth), logs to inspect, internal-only caveats.

### Added (code)

- **src/services/scheduling/TaskWriter.ts** — `TaskWriter` interface (`updateScheduledSlot`, `fetchTasks`) and `PrismaTaskWriter` implementation. Enables SchedulingService to run without direct Prisma dependency.

### Modified

- **src/services/scheduling/SchedulingService.ts** — Constructor accepts optional `TaskWriter` (4th param); uses `this.taskWriter.updateScheduledSlot` and `this.taskWriter.fetchTasks` instead of `prisma.task.update` and `prisma.task.findMany`; removed `prisma` import. Default `taskWriter` is `new PrismaTaskWriter()` so existing callers unchanged.
- **HANDOFF.md** — Steps 7–10 marked complete; new docs and TaskWriter noted; “What’s Broken or Incomplete” updated.
