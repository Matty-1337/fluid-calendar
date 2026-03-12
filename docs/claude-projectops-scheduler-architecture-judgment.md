# Project Ops Scheduler Architecture Judgment

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (principal software architect)

---

## 1. The Intended Architecture

```
Project Ops (source of truth)
  → POST /api/projectops/schedule
    → Request validation (Zod)
    → Scheduler facade
      → DTO mapping (Project Ops → FC internal types)
      → Conflict source injection (ConflictWindowsCalendarService)
      → Native scheduler engine (SchedulingService → TimeSlotManager → SlotScorer)
      → TaskWriter for slot persistence during run
    → Response with per-task results + scores
    → Optional writeback boundary (not yet implemented)
```

---

## 2. Is This Architecture Still Sound?

**Yes.** The layered approach is correct:

1. **Request validation at the edge** — Zod schemas catch malformed input before touching the engine. This is the right place for it.

2. **Facade as orchestration boundary** — `schedulerFacade.ts` translates between Project Ops DTOs and FC internal types, manages the temp-task lifecycle, and maps results back. It's a clean adapter.

3. **CalendarService as conflict source abstraction** — The interface allows swapping between DB-backed conflicts (CalendarServiceImpl) and request-supplied conflicts (ConflictWindowsCalendarService). This is the right pattern — Project Ops doesn't need FC's calendar infrastructure.

4. **TaskWriter as persistence abstraction** — Separates "where results go" from "how scheduling works". Enables testing without Prisma and future extraction.

5. **Scheduler engine as pure algorithm** — SlotScorer is stateless and pure. TimeSlotManager is mostly pure (except the Prisma dependency). SchedulingService orchestrates without knowing where tasks or conflicts come from.

---

## 3. Are the Boundaries Clean Enough?

**The outer boundaries are clean. One inner boundary leaks.**

### Clean boundaries:

- **Route → Facade**: Clean. Route handles auth + validation + error formatting. Facade handles scheduling orchestration.
- **Facade → SchedulingService**: Clean. Settings, timezone, and CalendarService are injected via constructor.
- **SchedulingService → TaskWriter**: Clean. Interface injection with PrismaTaskWriter default.
- **SchedulingService → CalendarService**: Clean. Interface injection with CalendarServiceImpl default.

### Leaking boundary:

- **TimeSlotManager → Prisma**: `TimeSlotManager.ts:18` imports `prisma` directly. Line 71 calls `prisma.task.findMany()` to load scheduled tasks for project-proximity scoring. This means:
  - TimeSlotManager cannot run without a database connection
  - The `InMemoryTaskWriter` abstraction is undermined — scheduling still touches Prisma even with an in-memory writer
  - Extraction to a standalone package would require abstracting this query

**Impact assessment:** For internal Project Ops use, this is LOW risk. The query loads the user's existing FC scheduled tasks for proximity scoring. If the user has no FC tasks, it returns empty and scoring proceeds normally. For standalone extraction, this is a BLOCKER that requires making `updateScheduledTasks` take data from an injected source rather than querying Prisma directly.

---

## 4. Is the Scheduler Still Too Coupled Anywhere?

### Coupling to Prisma types

Both `SchedulingService.ts` and `TimeSlotManager.ts` use `Task` from `@prisma/client` in their method signatures:

```typescript
// SchedulingService.ts:118
async scheduleMultipleTasks(tasks: Task[], userId: string): Promise<Task[]>

// TimeSlotManager.ts:30
findAvailableSlots(task: Task, ...): Promise<TimeSlot[]>
```

The `SchedulerTask` interface exists as a Prisma-independent equivalent, but the engine methods still require the full Prisma `Task` type. This means callers must construct objects satisfying all 30+ Prisma Task fields even when the algorithm only reads 14.

**Impact:** Medium. For Project Ops, the facade creates real Prisma Task records (temp tasks), so this coupling is hidden. For extraction, the signatures would need to accept `SchedulerTask` instead.

### Coupling to FC's date-utils

Both `SchedulingService` and `TimeSlotManager` import from `@/lib/date-utils`. This is a thin wrapper around `date-fns` and `date-fns-tz`. The wrapper is small enough that extracting it alongside the scheduler would be trivial.

### Coupling to FC's autoSchedule helpers

`TimeSlotManager` imports `parseWorkDays` and `parseSelectedCalendars` from `@/lib/autoSchedule`. These are simple JSON.parse wrappers. Trivially extractable.

### Coupling to FC's logger

All scheduler files use `@/lib/logger`. This is a structured logger that could be swapped for any logger with the same interface. Not a real coupling concern.

---

## 5. Should It Remain an Internal Module for Now?

**Yes, unequivocally.**

Reasons to keep it internal:

1. **Single consumer.** Only Project Ops will call this scheduler. Extracting to a separate package adds build complexity, versioning overhead, and deployment coordination for zero benefit.

2. **API surface still evolving.** The SchedulerTask/SchedulerSettings types, the TaskWriter interface, and the ConflictWindowsCalendarService pattern are all recent additions that haven't been validated by real use. Extracting now freezes an unvalidated API.

3. **Tests are insufficient.** The engine has zero tests on its core logic. Extracting code that's never been verified in isolation would multiply the debugging surface.

4. **Temp-task pattern is a DB dependency.** The facade creates and deletes real database records. Until this is eliminated (by having the engine work entirely on in-memory representations), extraction requires carrying Prisma along.

5. **Internal iteration speed.** Modifying the scheduler as an in-repo module is instant. As a separate package, every change requires publish + update + rebuild.

---

## 6. When Should It Become a Separate Service?

**When ALL of the following are true:**

1. **A second consumer needs scheduling.** If only Project Ops uses it, extraction is overhead.

2. **The engine is validated by tests.** SlotScorer, TimeSlotManager, and SchedulingService all have test coverage. The full pipeline has integration tests.

3. **The temp-task pattern is eliminated.** The engine operates on in-memory task representations (using SchedulerTask and InMemoryTaskWriter) rather than creating real database records.

4. **The Prisma coupling in TimeSlotManager is resolved.** The `updateScheduledTasks` method accepts injected data rather than querying Prisma directly.

5. **The API surface is stable.** The request/response DTOs, the CalendarService interface, and the TaskWriter interface have been used in production for long enough that breaking changes are unlikely.

At that point, extraction to a separate npm package or standalone service makes sense. The `SchedulerTask`, `SchedulerSettings`, `TaskWriter`, and `CalendarService` interfaces already define the extraction boundary — they just need to be the actual method signatures instead of parallel types.

---

## 7. Architecture Recommendations

### Keep as-is (correct decisions):
- Facade pattern separating Project Ops concerns from engine
- CalendarService injection for conflict sources
- TaskWriter injection for persistence
- Fixed 7-day window (don't expose to callers yet)
- Greedy batch-and-sort heuristic (correct for <50 tasks)

### Fix soon (before internal dry-run):
- Add validation guardrails (items 1-4 from verdict)
- These are not architecture changes — they're input validation additions

### Fix when pursuing extraction:
- Replace `Task` from `@prisma/client` with `SchedulerTask` in engine method signatures
- Make `TimeSlotManager.updateScheduledTasks` accept injected data instead of querying Prisma
- Eliminate the temp-task pattern in the facade (operate on in-memory SchedulerTask[])

### Do not change:
- The single-service deployment model (keep scheduler in FC repo)
- The 7-factor scoring weights (they need tests, not changes)
- The batch-8 orchestration (adequate for current scale)
- The CalendarService / TaskWriter interface designs (they're correct)
