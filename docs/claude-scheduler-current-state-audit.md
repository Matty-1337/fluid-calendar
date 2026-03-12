# Scheduler Current State Audit

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (principal software architect)
**Scope:** Complete inventory of scheduler/calendar implementation as it exists in the current working tree.

---

## 1. Critical Pre-Audit Finding

**All scheduler/projectops work is uncommitted.** The latest Git commit (`b5c0f2b`) contains only the repo intelligence layer (CLAUDE.md, rules, skills). Every scheduler-related file is either:
- **Modified tracked** (3 files): `SchedulingService.ts`, `TaskSchedulingService.ts`, `TimeSlotManager.ts`
- **Untracked** (12 code files, 20+ docs): the entire `src/lib/projectops/` directory, `TaskWriter.ts`, `InMemoryTaskWriter.ts`, `types.ts`, the API route, all tests, and all docs

This means the GitHub repository contains **zero** Project Ops scheduler code. The review below covers the local working tree state.

---

## 2. File Inventory

### 2.1 Scheduling Engine (`src/services/scheduling/`)

| File | Lines | Status | Purpose |
| --- | --- | --- | --- |
| `SchedulingService.ts` | 310 | Modified (uncommitted) | Orchestrator: batch=8, 7-day window, CalendarService + TaskWriter injection |
| `TimeSlotManager.ts` | 465 | Modified (uncommitted) | Slot generation, work-hour filtering, conflict checking, scoring pipeline |
| `SlotScorer.ts` | 212 | Committed (unchanged) | 7-factor weighted scoring engine |
| `CalendarService.ts` | 31 | Committed (unchanged) | Interface: findConflicts, getEvents, findBatchConflicts |
| `CalendarServiceImpl.ts` | 294 | Committed (unchanged) | DB-backed implementation with 30-min cache |
| `TaskSchedulingService.ts` | 236 | Modified (uncommitted) | FC app entry point, fully Prisma-dependent |
| `TaskWriter.ts` | 64 | Untracked | Interface + PrismaTaskWriter default |
| `InMemoryTaskWriter.ts` | 69 | Untracked | Test double using Map<string, SchedulerTask> |
| `types.ts` | 62 | Untracked | SchedulerTask + SchedulerSettings (Prisma-independent) |

### 2.2 Project Ops Integration (`src/lib/projectops/`)

| File | Lines | Status | Purpose |
| --- | --- | --- | --- |
| `types.ts` | 69 | Untracked | DTOs: ProjectOpsTask, ScheduleRequest, ScheduleResult, TaskScheduleResult |
| `validation.ts` | 79 | Untracked | Zod schemas for request validation |
| `mappers.ts` | 88 | Untracked | DTO → Prisma Task create input, DTO → AutoScheduleSettings |
| `schedulerFacade.ts` | 155 | Untracked | Orchestrates: create temp tasks → run scheduler → return results → cleanup |
| `ConflictWindowsCalendarService.ts` | 138 | Untracked | In-memory CalendarService using request-supplied busy periods |

### 2.3 API Route

| File | Lines | Status | Purpose |
| --- | --- | --- | --- |
| `src/app/api/projectops/schedule/route.ts` | 60 | Untracked | POST endpoint; authenticateRequest + Zod validation + facade |

### 2.4 Tests (5 files, 43 tests, all passing)

| File | Tests | Covers |
| --- | --- | --- |
| `projectops/__tests__/validation.test.ts` | 12 | Zod schema accept/reject |
| `projectops/__tests__/mappers.test.ts` | 4 | DTO mapping with defaults |
| `projectops/__tests__/schedulerFacade.test.ts` | 5 | Facade flow with mocked scheduler |
| `projectops/__tests__/ConflictWindowsCalendarService.test.ts` | 14 | Overlap boundary semantics (incl. 6 B2 tests) |
| `scheduling/__tests__/InMemoryTaskWriter.test.ts` | 8 | TaskWriter abstraction CRUD |

### 2.5 Additional Scheduling Routes (FC app, not Project Ops)

| File | Purpose |
| --- | --- |
| `src/app/api/tasks/schedule-all/route.ts` | FC's own "schedule all tasks" endpoint (uses TaskSchedulingService) |
| `src/app/api/auto-schedule-settings/route.ts` | CRUD for AutoScheduleSettings model |

### 2.6 Supporting Files

| File | Purpose |
| --- | --- |
| `src/lib/autoSchedule.ts` | parseWorkDays, parseSelectedCalendars, getEnergyLevelForTime, isWorkingHour |
| `src/types/scheduling.ts` | TimeSlot, Conflict, SlotScore, ScheduleResult types |
| `src/lib/date-utils.ts` | date-fns wrappers including toZonedTime |

### 2.7 No Debug UI

There is no scheduler debug UI, visualization, or admin panel for viewing scheduling results. No components reference `projectops` or the scheduler facade.

---

## 3. Architecture Summary

```
POST /api/projectops/schedule
  │
  ├── authenticateRequest (NextAuth session)
  ├── Zod validation (projectOpsScheduleRequestSchema)
  │
  └── schedulerFacade.runProjectOpsSchedule()
        │
        ├── mappers: DTOs → Prisma Task create inputs + AutoScheduleSettings
        ├── prisma.task.create() × N  (temporary tasks)
        ├── ConflictWindowsCalendarService (if conflictWindows provided)
        │     └── In-memory CalendarEvent[] from request busy periods
        │
        ├── SchedulingService(settings, timezone, calendarService)
        │     ├── TimeSlotManagerImpl(settings, calendarService, timezone)
        │     │     ├── generatePotentialSlots(duration, start, end)
        │     │     ├── filterByWorkHours()
        │     │     ├── removeConflicts() → CalendarService.findBatchConflicts()
        │     │     ├── applyBufferTimes()
        │     │     └── scoreSlots() → SlotScorer.scoreSlot()
        │     │
        │     ├── scheduleMultipleTasks(): batch-8 greedy assignment
        │     │     ├── Pass 1: findAvailableSlots() per task for sort ordering
        │     │     └── Pass 2: findAvailableSlots() + assign best slot per task
        │     │
        │     └── TaskWriter.updateScheduledSlot() + fetchTasks()
        │           ├── PrismaTaskWriter (default — DB persistence)
        │           └── InMemoryTaskWriter (test double)
        │
        ├── Map results back to TaskScheduleResult[]
        └── finally: prisma.task.deleteMany() (cleanup temp tasks)
```

---

## 4. What Appears Complete

1. **Request validation**: Zod schema validates all fields, enums, datetime formats. 12 tests.
2. **DTO mapping**: Project Ops task/settings → FC internal types. 4 tests, correct defaults.
3. **Conflict windows**: In-memory CalendarService implementation. 14 tests including boundary cases.
4. **Facade orchestration**: Create temp tasks → schedule → return → cleanup. 5 tests including error path.
5. **TaskWriter abstraction**: Interface + Prisma default + InMemoryTaskWriter test double. 8 tests.
6. **Prisma-independent types**: SchedulerTask (14 fields) and SchedulerSettings (12 fields).
7. **CalendarService injection**: SchedulingService accepts custom CalendarService.
8. **Timezone handling**: TimeSlotManager uses injected timezone, warns on missing.
9. **Settings hardening**: SchedulingService throws if no settings (no Zustand fallback).
10. **API route**: POST with auth + validation + structured error responses.

## 5. What Appears Incomplete

1. **No minimum task duration validation** — `estimatedMinutes` accepts any positive integer (including 1).
2. **No max task count** — tasks array has `.min(1)` but no `.max()`.
3. **No slot generation cap** — `generatePotentialSlots` while-loop is unbounded.
4. **No IANA timezone validation** — `z.string().min(1)` accepts any non-empty string.
5. **No `workHourStart < workHourEnd` validation** — inverted hours produce zero slots silently.
6. **No `end > start` validation on conflictWindows** — inverted windows silently ignored.
7. **No request timeout** — no `AbortController`, no `Promise.race`, no deadline.
8. **No concurrent request protection** — simultaneous requests create interleaving temp tasks.
9. **No SlotScorer tests** — zero tests for the 7 scoring formulas.
10. **No slot generation tests** — zero tests for `generatePotentialSlots`.
11. **No full-pipeline integration tests** — no test exercises real slot generation + scoring + assignment.
12. **No production auth** — route uses NextAuth session only; no HMAC/API key for service-to-service.
13. **No calendar writeback** — results are data only, no events created anywhere.
14. **No audit logging** — facade logs errors but no structured audit trail.
15. **Calendar cache has no invalidation** — `CalendarServiceImpl` TODO explicitly preserved.

## 6. What Is Documented vs Implemented

| Capability | Documented? | Implemented? |
| --- | --- | --- |
| Zod request validation | Yes (API doc) | **Yes** |
| ConflictWindows adapter | Yes (master plan) | **Yes** |
| TaskWriter abstraction | Yes (extraction doc) | **Yes** |
| HMAC service auth | Yes (auth strategy doc) | **No** — only NextAuth session |
| Scheduler extraction to package | Yes (extraction doc) | **No** — still embedded in FC |
| Calendar writeback | Yes (readiness doc prerequisites) | **No** — not started |
| Slot generation cap | Yes (MVP verdict) | **No** |
| IANA timezone validation | Yes (MVP verdict) | **No** |
| SlotScorer tests | Yes (MVP verdict) | **No** |
| Request timeout | Yes (readiness doc) | **No** |
| Rate limiting | Yes (readiness doc) | **No** |
| Rollback capability | Yes (readiness doc) | **No** |
