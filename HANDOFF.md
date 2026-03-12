# HANDOFF — 2026-03-07 (Project Ops Integration — Steps 1–10)

## Session Summary

Continued from the Project Ops PoC session. Executed steps 1–10 of the 10 engineering steps from `docs/project-ops-fluidcalendar-final-decision.md` (steps 7–10 in extraction-readiness phase):

1. **Zod DTO validation** — Added `validation.ts` with full Zod schema; API route now returns structured 400 errors.
2. **Facade tests** — 5 unit tests for `schedulerFacade.ts` (timezone pass-through, temp task cleanup on error, multi-task mapping).
3. **Event source adapter** — Created `ConflictWindowsCalendarService` implementing `CalendarService` interface; converts request-supplied `conflictWindows` to synthetic events. Integrated into `schedulerFacade.ts` (used when `request.conflictWindows` is present). Modified `SchedulingService` constructor to accept optional `CalendarService` injection.
4. **B7 hardened** — Removed `useSettingsStore` fallback from both `SchedulingService` (now throws if no settings) and `TimeSlotManagerImpl` (warns and defaults to UTC). No client-side Zustand dependency in scheduling engine.
5. **B2 overlap tests** — Added 6 boundary tests for `ConflictWindowsCalendarService` (exact match, inside, adjacent-before, adjacent-after, 1-min overlap, batch boundary test). All pass. B2 for `CalendarServiceImpl` (DB path) still requires integration testing with real calendar data.
6. **Steps 7–10 (extraction readiness):** API doc (`docs/project-ops-scheduler-api.md`), auth strategy (`docs/project-ops-auth-strategy.md`), extraction next-step doc (`docs/scheduler-extraction-next-step.md`), runbook (`docs/project-ops-scheduler-runbook.md`). Introduced `TaskWriter` interface and `PrismaTaskWriter`; `SchedulingService` now accepts optional `TaskWriter` (4th constructor param) and uses it for task update and fetch — no direct Prisma in SchedulingService.

## Files Changed

### Created (steps 1–6)

- **src/lib/projectops/validation.ts** — Zod schemas for ProjectOpsScheduleRequest, tasks, settings, conflict windows.
- **src/lib/projectops/__tests__/validation.test.ts** — 12 validation tests.
- **src/lib/projectops/__tests__/schedulerFacade.test.ts** — 5 facade unit tests (mocked Prisma + SchedulingService).
- **src/lib/projectops/ConflictWindowsCalendarService.ts** — CalendarService impl using in-memory conflict windows.
- **src/lib/projectops/__tests__/ConflictWindowsCalendarService.test.ts** — 14 tests (8 basic + 6 B2 boundary).

### Created (steps 7–10)

- **docs/project-ops-scheduler-api.md** — Full endpoint documentation: request/response schemas, auth, samples, conflictWindows and timezone behavior, error cases, validation gaps.
- **docs/project-ops-auth-strategy.md** — Comparison of four auth models; recommendation: HMAC service token (primary), API key (internal fallback); implementation notes.
- **docs/scheduler-extraction-next-step.md** — Portability analysis, remaining DB blockers, TaskWriter abstraction, minimum viable extracted scheduler, interfaces.
- **docs/project-ops-scheduler-runbook.md** — Local setup, manual testing, sample payloads, env vars, failure modes, debugging (timezone, overlap, auth), logs, internal-only caveats.
- **src/services/scheduling/TaskWriter.ts** — `TaskWriter` interface (`updateScheduledSlot`, `fetchTasks`) and `PrismaTaskWriter` default implementation.

### Modified

- **src/app/api/projectops/schedule/route.ts** — Replaced manual validation with Zod `safeParse`; returns 400 with `fieldErrors`.
- **src/lib/projectops/schedulerFacade.ts** — Creates `ConflictWindowsCalendarService` when `request.conflictWindows` provided; passes it to `SchedulingService`. Fixed `requestId` undefined → `""`.
- **src/services/scheduling/SchedulingService.ts** — Constructor accepts optional `CalendarService` (3rd param) and optional `TaskWriter` (4th param); uses `taskWriter.updateScheduledSlot` and `taskWriter.fetchTasks` instead of direct Prisma; removed `prisma` import.
- **src/services/scheduling/TimeSlotManager.ts** — Removed `useSettingsStore` import; timezone fallback logs warning and defaults to UTC instead of reading client store.

## What's Working

- All 35 projectops tests pass (4 mapper, 12 validation, 5 facade, 14 conflict windows).
- Type-check passes cleanly (`npx tsc --noEmit`).
- POST /api/projectops/schedule validates input with Zod, returns structured errors.
- Conflict windows from request are used for overlap detection when provided.
- Scheduling engine no longer depends on client-side Zustand store.

## What's Broken or Incomplete

- **B2 for CalendarServiceImpl** — Overlap bug on the DB-based calendar path needs integration test with running app + real calendar events.
- **Production auth implementation** — Auth strategy is documented (HMAC or API key); route still uses only NextAuth session. Service-to-server auth not yet implemented.
- **Package extraction** — TaskWriter interface exists; scheduler not yet extracted to a separate package. See `docs/scheduler-extraction-next-step.md`.

## How to Test

```bash
npm run test:unit -- --testPathPattern=projectops   # All 35 tests
npm run type-check                                   # TypeScript check
```

## Next Steps (from final-decision doc)

- [x] 1. Add request DTO validation (Zod)
- [x] 2. Add timezone integration test (via facade test)
- [x] 3. Add overlap test (ConflictWindowsCalendarService boundary tests)
- [x] 4. Implement event source adapter (ConflictWindowsCalendarService)
- [x] 5. Harden server path B7 (useSettingsStore removed)
- [x] 6. Fix overlap bug B2 (Project Ops path tested; CalendarServiceImpl path needs integration test)
- [x] 7. Document API (markdown: docs/project-ops-scheduler-api.md)
- [x] 8. Decide production auth (docs/project-ops-auth-strategy.md)
- [x] 9. Extract or not (TaskWriter interface + PrismaTaskWriter; docs/scheduler-extraction-next-step.md)
- [x] 10. Update HANDOFF and runbooks (docs/project-ops-scheduler-runbook.md)

## Context for the Next Session

- Project Ops is source of truth; FluidCalendar is evaluated as scheduling engine only.
- Primary integration path: Option C (scheduler extraction). Fallback: Option D (reference).
- Central plan: `docs/project-ops-fluidcalendar-master-plan.md` and `docs/project-ops-fluidcalendar-final-decision.md`.
- SchedulingService now accepts injected CalendarService and optional TaskWriter — key abstractions for extraction. No direct Prisma in SchedulingService.
