# Extraction Verdict — Principal Architecture Review

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (acting as principal software architect)
**Scope:** Evaluate whether the FluidCalendar scheduler should be extracted into a service, frozen as reference, or rebuilt natively in Project Ops.

---

## 1. Executive Verdict

**Rebuild natively in Project Ops (Option D), using this work as a detailed blueprint.**

The extraction work has been thorough and well-intentioned, but it has revealed — rather than solved — the fundamental problem: **the FluidCalendar scheduler was designed as a database-mutation engine, not a compute-and-return function**. Every layer of the current architecture (SchedulingService, TimeSlotManager, CalendarServiceImpl, the facade) assumes it can read and write tasks through a persistence layer during the scheduling run. The abstractions added (TaskWriter, CalendarService injection, ConflictWindowsCalendarService) are real progress, but they wrap the mutation-centric design rather than replacing it.

The scheduling *algorithm* — the 7-factor scoring in SlotScorer, the slot generation logic in TimeSlotManager, the batch-and-sort orchestration — is solid and worth preserving. But extracting the current *code* into a service would mean carrying Prisma types, the temp-task dance, the JSON-string settings convention, and a logger/date-utils abstraction layer. At that point you're not extracting — you're forking.

A clean reimplementation of the ~400 lines of actual scheduling logic (SlotScorer + slot generation + orchestration), informed by the detailed docs and test cases produced in this evaluation, would take 1–2 weeks and produce code that Project Ops fully owns, with no FC coupling, no Prisma type dependency, and a pure `(tasks, settings, conflicts) → scheduled_slots` interface from day one.

---

## 2. What Cursor Got Right

1. **Dependency analysis was accurate.** The `scheduler-extraction-dependency-map.md` correctly identified SlotScorer as pure, TimeSlotManager as needing abstraction, SchedulingService as DB-coupled, and TaskSchedulingService as non-extractable. This saved significant analysis time.

2. **CalendarService injection was the right move.** Creating the `CalendarService` interface and `ConflictWindowsCalendarService` eliminated the hardest coupling — external calendar data. The Project Ops path can now supply conflicts without FC's database.

3. **B7 fix was clean.** Removing `useSettingsStore` from both SchedulingService and TimeSlotManager was the correct change. The scheduler engine no longer touches client-side Zustand.

4. **The API contract is well-designed.** `ProjectOpsScheduleRequest` and `ScheduleResult` DTOs are clean, sensible, and genuinely usable. The Zod validation is proper. This contract should survive into whatever the final scheduler becomes.

5. **Test coverage on the adapters is solid.** The 14 ConflictWindowsCalendarService tests (including the 6 B2 boundary tests) are good engineering. The boundary semantics (adjacent=OK, 1-minute-overlap=conflict) are correctly verified.

6. **Documentation quality is unusually high.** The docs produced (master plan, dependency map, contract, auth strategy, runbook, final decision) form a complete blueprint for reimplementation.

---

## 3. What Cursor Missed or Deferred

1. **The Prisma `Task` type is everywhere and nobody addressed it.** Every file in `src/services/scheduling/` imports `Task` from `@prisma/client`. This is not a type-only import in practice — the scheduler reads 30+ fields from this type (duration, dueDate, priority, energyLevel, preferredTime, projectId, scheduleLocked, startDate, scheduledStart, scheduledEnd, scheduleScore, id, userId, title, isAutoScheduled). For extraction, you'd need a `SchedulerTask` interface and a mapping layer. This was identified in the dependency map but never implemented.

2. **`AutoScheduleSettings` uses a JSON-string convention.** `workDays` and `selectedCalendars` are stored as JSON strings (`"[1,2,3,4,5]"`) in the Prisma model. The mappers dutifully produce these JSON strings. The scheduler then parses them via `parseWorkDays()` and `parseSelectedCalendars()`. This serialize/deserialize round-trip is a Prisma/PostgreSQL convention leaking into the scheduling interface. An extracted scheduler would use `number[]` and `string[]` directly.

3. **TimeSlotManager still has a direct Prisma import.** `updateScheduledTasks()` at line 71 calls `prisma.task.findMany(...)` directly. The TaskWriter abstraction only covers SchedulingService; TimeSlotManager's Prisma usage was explicitly deferred ("not addressed in this step to keep the change set small"). This means TimeSlotManager is **not portable** despite the docs claiming it is "portable once CalendarService provided."

4. **ConflictWindowsCalendarService constructs full Prisma `CalendarEvent` objects.** It manufactures 20+ fields (feedId, externalEventId, isRecurring, recurrenceRule, allDay, status, sequence, created, lastModified, organizer, attendees, isMaster, masterEventId, recurringEventId, etc.) to satisfy the `CalendarEvent` type from `@prisma/client`. Only `start`, `end`, `title`, and `id` are used. This is a clear sign that the interface boundary is wrong — it should accept a simpler type.

5. **The `CalendarServiceImpl.findBatchConflicts` also queries scheduled tasks from Prisma** (lines 230-238). This means even the "calendar conflict" interface is doing double duty — checking calendar events AND checking DB-resident scheduled tasks. These two concerns should be separated, but they weren't.

6. **No test exercises the full scheduling path.** The 35 tests cover mappers, validation, the facade (with mocked SchedulingService), and ConflictWindowsCalendarService in isolation. Zero tests run `SchedulingService.scheduleMultipleTasks()` with actual slot generation and scoring. The core algorithm remains untested.

---

## 4. Current Extraction-Readiness Assessment

| Component | Portable? | Blocking Dependencies |
|-----------|-----------|----------------------|
| **SlotScorer** | Yes (with type aliasing) | `Task` and `AutoScheduleSettings` from `@prisma/client` (type-level only); `@/lib/autoSchedule` (pure, extractable); `@/lib/date-utils` (wraps date-fns, extractable) |
| **TimeSlotManager (slot generation)** | Yes | `generatePotentialSlots`, `filterByWorkHours`, `applyBufferTimes` are pure functions of settings, timezone, and duration |
| **TimeSlotManager (conflict removal)** | No | `updateScheduledTasks()` calls `prisma.task.findMany` directly |
| **SchedulingService** | Partially | TaskWriter abstracts writes; but still imports `CalendarServiceImpl` as default; `Task` from `@prisma/client`; performance metrics use FC logger |
| **CalendarService interface** | Yes | Clean interface |
| **ConflictWindowsCalendarService** | No | Constructs full Prisma `CalendarEvent` objects; should use a simpler type |
| **TaskWriter interface** | Yes | Clean interface, but `fetchTasks` returns Prisma `Task` — couples consumers to Prisma type |
| **PrismaTaskWriter** | N/A (FC-only) | Prisma by design |
| **schedulerFacade** | No | Temp-task create/delete via Prisma; is FC-app glue, not extractable |
| **mappers** | No | Produce Prisma-compatible shapes (JSON strings, Prisma create input) |

**Verdict: ~40% portable by code, ~70% portable by algorithm/logic.**

---

## 5. Scheduler Portability Assessment

The scheduling *algorithm* is fully documented and understood:

- **Slot generation:** Generate slots at task-duration intervals within work hours/days for a configurable timezone. ~60 lines of logic.
- **Conflict removal:** Filter slots that overlap with supplied busy periods (calendar events) or already-scheduled tasks. ~40 lines.
- **7-factor scoring:** deadlineProximity (3.0), priorityScore (1.8), energyLevelMatch (1.5), timePreference (1.2), workHourAlignment (1.0), bufferAdequacy (0.8), projectProximity (0.5). ~130 lines.
- **Orchestration:** Batch-score all tasks (batch=8), sort by best score, schedule greedily (highest-scored task first), mark each scheduled slot as a conflict for subsequent tasks. ~80 lines.

**Total algorithm: ~310 lines of actual logic.** The rest is Prisma calls, performance metrics, logging, type conversions, and error handling that are specific to the FC app context.

Reimplementing this with a pure functional interface — `schedule(tasks: SchedulerTask[], settings: SchedulerSettings, conflicts: BusyPeriod[]): ScheduledSlot[]` — is straightforward. The detailed scoring formulas, weight constants, boundary handling, and decay functions are all documented in code and can be lifted directly.

---

## 6. Remaining Coupling Risks

1. **`@prisma/client` type imports in every scheduling file.** Not a runtime dependency, but makes the code structurally dependent on generating Prisma types. An extracted package would need its own type definitions.

2. **TimeSlotManager.updateScheduledTasks() — direct Prisma call.** This is the most concrete remaining DB coupling inside the "engine" files. It loads all scheduled tasks for the user to populate the project-proximity scorer. In a pure scheduler, this data should be passed in with the request.

3. **CalendarServiceImpl double-duties as both calendar and task-conflict checker.** Its `findConflicts` and `findBatchConflicts` methods query both `prisma.calendarEvent` and `prisma.task`. This conflates two different conflict sources behind one interface.

4. **The `CalendarEvent` type from Prisma in ConflictWindowsCalendarService.** The adapter constructs fake CalendarEvent objects with 20+ unused fields. This means the CalendarService interface is over-specified — it should accept `{ start: Date; end: Date; title?: string }[]`, not the full Prisma model.

5. **JSON-string encoding of arrays in settings.** The `AutoScheduleSettings` type stores `workDays` as `"[1,2,3,4,5]"` (string) instead of `number[]`. Every consumer calls `parseWorkDays()`. This convention would be eliminated in a clean implementation.

6. **FC's `@/lib/date-utils` wrapper.** The scheduler uses `newDate()` instead of `new Date()`, `addMinutes` from date-utils, etc. These are thin wrappers over `date-fns`. For extraction, you'd either carry date-fns directly or use the same wrappers — but the import paths would all break.

7. **FC's logger.** Used in SchedulingService and TimeSlotManager. A logging interface or console-based fallback would be needed.

---

## 7. Assessment of Temp-Task Orchestration

**This is the single biggest architectural problem.**

The facade:
1. Creates real Prisma Task rows in the database for every request task
2. Passes those DB tasks to SchedulingService, which reads and writes them via Prisma/TaskWriter
3. Maps the Prisma Task results back to the API response
4. Deletes all temporary tasks in a `finally` block

**Why this is bad:**

- **Concurrency hazard:** Two simultaneous schedule requests create tasks in the same DB, visible to each other during conflict checks (CalendarServiceImpl.findBatchConflicts queries `prisma.task.findMany` for ALL scheduled tasks for the user).
- **Failure mode:** If the process crashes between create and finally-delete, orphaned temp tasks remain in the database. There is no cleanup mechanism.
- **Performance:** 2N+2 database round-trips per request (N creates + 1 findMany + scheduler updates + 1 deleteMany) for what should be a pure computation.
- **Semantics violation:** Project Ops is source of truth for tasks. Creating task rows in FC's database — even temporarily — contradicts this. If FC were deployed separately, these temp tasks would exist in a database that Project Ops doesn't control.

**The right design:** The scheduler should be a pure function: `(tasks[], settings, busyPeriods[]) → scheduledSlots[]`. No database reads or writes inside the scheduling computation. The caller decides what to persist where.

The TaskWriter abstraction partially addresses this — you could create an InMemoryTaskWriter — but the facade still creates real DB tasks to get valid Prisma `Task` objects to pass to SchedulingService. The root cause is that every function in the scheduler pipeline expects `Task` from `@prisma/client`, not a lightweight input type.

---

## 8. Assessment of TaskWriter Abstraction

**Correct direction, insufficient scope.**

TaskWriter successfully abstracts the two Prisma calls inside SchedulingService:
- `updateScheduledSlot(taskId, slot, duration, userId)` — replaces `prisma.task.update`
- `fetchTasks(taskIds, userId)` — replaces `prisma.task.findMany`

**What it does well:**
- Makes SchedulingService testable with an in-memory implementation (though none exists yet)
- Establishes the pattern for dependency injection in the scheduler

**What it doesn't address:**
- `TimeSlotManager.updateScheduledTasks()` still calls `prisma.task.findMany` directly — the second DB read in the engine
- `TaskWriter.fetchTasks()` and `TaskWriter.updateScheduledSlot()` both return `Task` from `@prisma/client` — the interface is coupled to the Prisma type, not a scheduler-internal type
- `CalendarServiceImpl.findConflicts/findBatchConflicts` still calls `prisma.task.findMany` for task-conflict checking — a third DB read that TaskWriter doesn't cover
- No InMemoryTaskWriter exists to prove the abstraction works

**Net assessment:** TaskWriter reduces direct Prisma imports in SchedulingService from 2 to 0, but it doesn't change the fundamental data flow. The scheduler still mutates tasks (via TaskWriter) and relies on those mutations being visible to subsequent conflict checks. The abstraction layer is thin enough that an InMemoryTaskWriter would need to replicate the "updated task is visible to conflict checks" semantic, which means reimplementing the state management that Prisma currently provides.

---

## 9. Assessment of API Contract and Auth Strategy

### API Contract

**The contract is good and should be preserved regardless of implementation choice.**

- `ProjectOpsScheduleRequest` is clean: timezone (required), tasks (required), settings (optional with sensible defaults), conflictWindows (optional).
- `ScheduleResult` / `TaskScheduleResult` are well-shaped: per-task success/failure, scheduled slot, score, reason.
- Zod validation is correct and covers enum values, date formats, numeric bounds.

**Gaps:**
- No IANA timezone validation (the string "notazone" would pass validation and cause undefined behavior in date-fns)
- No `end > start` validation on conflictWindows
- `candidates` and `conflicts` fields in `TaskScheduleResult` are defined but never populated — the facade doesn't return alternative slots or conflict details for failed tasks

### Auth Strategy

**HMAC recommendation is sound for server-to-server.** The four-option comparison is clear and well-reasoned. API key as fallback for internal use is pragmatic.

**But none of it is implemented.** The route only supports NextAuth session auth. For the current "internal PoC" posture this is fine, but it means the auth strategy document is purely advisory — no code exists to validate it.

---

## 10. Recommendation

### Primary: **Rebuild natively in Project Ops (Option D)**

**Rationale:**

| Factor | Extract FC | Rebuild in PO |
|--------|-----------|---------------|
| **Lines of algorithm to carry** | ~310 | ~310 (same logic, clean types) |
| **Lines of glue/adapter to carry** | ~500+ (TaskWriter, mappers, facade, type conversions, JSON-string handling, logger wrapper) | 0 |
| **Prisma type dependency** | Must define replacement types AND mapping layer | Use native PO types from the start |
| **DB coupling to eliminate** | TimeSlotManager.updateScheduledTasks, CalendarServiceImpl task queries, temp-task lifecycle | None — designed as pure compute |
| **Ongoing maintenance** | Two codebases (FC + extracted scheduler) or fork | One codebase |
| **Time to useful production value** | 3–4 weeks (extract + abstract + test + deploy) | 1–2 weeks (reimplement algorithm + test) |
| **Risk of regression** | High (carrying untested FC scheduler internals) | Low (clean implementation with tests) |
| **Fits PO architecture** | Must be adapted | Native |

### What to carry from this evaluation:

1. **The API contract** (`ProjectOpsScheduleRequest`, `ScheduleResult`, Zod schema) — use as-is
2. **The scoring algorithm** — lift the 7 formulas and weights directly from `SlotScorer.ts`
3. **The slot generation logic** — lift from `TimeSlotManager.generatePotentialSlots` and `filterByWorkHours`
4. **The orchestration pattern** — batch-score, sort, greedy assignment, mark-as-conflict
5. **The boundary test cases** — the 14 ConflictWindowsCalendarService tests verify the right overlap semantics
6. **The auth strategy** — HMAC primary, API key fallback
7. **The detailed docs** — contract, dependency map, field mapping, sample payloads

### What NOT to carry:

1. The temp-task create/delete pattern
2. Any `@prisma/client` type imports
3. The JSON-string settings encoding
4. CalendarServiceImpl (too coupled to FC's Prisma schema)
5. The FC-specific logger wrapper
6. Performance metrics instrumentation (add later if needed, with PO's own observability)

### Why not "continue extracting":

The extraction path requires:
1. Define scheduler-internal types for Task (~20 fields), Settings (~15 fields), CalendarEvent → ~80 lines of interfaces
2. Create mapping layers from Prisma types to scheduler types → ~60 lines
3. Abstract TimeSlotManager.updateScheduledTasks() → ~30 lines of interface + implementation
4. Fix CalendarServiceImpl to not query tasks (separate concerns) → ~50 lines
5. Create InMemoryTaskWriter to prove TaskWriter abstraction works → ~40 lines
6. Replace CalendarEvent with a simpler BusyPeriod type in ConflictWindowsCalendarService → ~30 lines
7. Replace `@/lib/date-utils` wrapper imports with direct date-fns imports → mechanical but touches every file
8. Replace `@/lib/logger` → every file
9. Package and publish or deploy as service → build config, CI, versioning

That's **at least 300 lines of new abstraction code** to make ~310 lines of algorithm portable. Meanwhile, reimplementing those 310 lines from scratch with native Project Ops types would produce cleaner code, with tests, in less time.

---

## 11. Top 5 Next Refactors or Experiments

If the decision is to rebuild natively:

1. **Spike: Pure scheduler function in Project Ops.** Implement `scheduleTasksToSlots(tasks: SchedulerTask[], settings: SchedulerSettings, busyPeriods: BusyPeriod[]): ScheduledSlot[]` as a pure function. Lift the scoring formulas from SlotScorer.ts. Target: 1 day, <400 lines, no DB dependency. Validate with the ConflictWindowsCalendarService boundary test patterns.

2. **Port the API contract.** Copy `ProjectOpsScheduleRequest`, `ScheduleResult`, and the Zod schema into Project Ops. Expose as an internal API endpoint. The contract is already clean and doesn't need FC.

3. **Integrate with Project Ops calendar data.** Project Ops supplies busy periods from its own calendar provider (or passes Google Calendar events from its own OAuth). No FC CalendarServiceImpl needed.

4. **Add tests the FC codebase never had.** Test the actual scoring: given a task with priority HIGH and dueDate tomorrow, assert it scores higher than a task with priority LOW and no dueDate. Test the slot generation: given workHours 9–17 and timezone America/New_York, assert all returned slots are within 9–17 ET. These tests are straightforward but don't exist in the FC codebase.

5. **Decide on the orchestration pattern.** The greedy batch-and-sort approach (score all tasks, schedule highest first, mark slot as conflict, repeat) is effective but has known limitations (e.g., a high-scoring task may "steal" the only slot from a task with a hard deadline). Evaluate whether Project Ops needs a more sophisticated approach (e.g., backtracking, constraint solving) or whether the heuristic is sufficient.

If the decision is to continue extraction despite the above:

1. **Define `SchedulerTask` and `SchedulerSettings` interfaces** that are independent of `@prisma/client`. Map at the facade boundary.
2. **Abstract `TimeSlotManager.updateScheduledTasks()`** — accept `existingScheduledTasks: { start: Date; end: Date; projectId?: string }[]` as constructor parameter instead of querying Prisma.
3. **Create InMemoryTaskWriter** to prove the abstraction end-to-end: facade passes in-memory tasks, scheduler updates them in memory, facade reads results from memory. No temp DB tasks.
4. **Simplify CalendarService interface** — use `BusyPeriod { start: Date; end: Date }` instead of `CalendarEvent`. Separate calendar-event conflicts from scheduled-task conflicts.
5. **Add integration test** that runs the full scheduling path (slot generation → conflict removal → scoring → assignment) without Prisma, using InMemoryTaskWriter and ConflictWindowsCalendarService with simplified types.

---

## 12. What Should Never Reach Production in Its Current Form

1. **The temp-task create/delete pattern.** Creating real DB rows for a computation, then deleting them in `finally`, is a concurrency hazard and a data integrity risk. Not production-safe under any load.

2. **NextAuth-only authentication for server-to-server calls.** The route at `src/app/api/projectops/schedule/route.ts` only supports browser session auth. Production server-to-server requires API key or HMAC (documented but not implemented).

3. **CalendarServiceImpl as the default CalendarService.** When `conflictWindows` is not provided, the scheduler falls back to `CalendarServiceImpl`, which queries FC's own CalendarEvent table. For Project Ops usage, this makes the scheduler depend on FC having the right calendar data — which it won't unless FC is also syncing Project Ops users' calendars.

4. **The `CalendarServiceImpl` cache.** 30-minute TTL with no invalidation on event create/update/delete (the TODO at line 39 is explicit about this). Stale cache means the scheduler may place tasks in slots that are now occupied.

5. **Buffer time scoring without enforcement.** `bufferAdequacy` is scored (0.8 weight) but the buffer is never enforced — the scheduler will happily place a task immediately after another task even if both prefer a buffer. The TODO at line 410–414 of TimeSlotManager acknowledges this.

6. **The JSON-string settings convention in the API boundary.** `projectOpsSettingsToAutoScheduleSettings` converts `number[]` to `"[1,2,3,4,5]"` (JSON string) because that's what Prisma expects. This should not leak to any external consumer.

7. **Performance metrics that call `logger.debug` with a stringified JSON blob.** The `logMetrics()` method (SchedulingService lines 61–88) stringifies the entire metrics array into a single log line. For any production observability, use structured metrics, not debug log strings.

---

## Summary

The evaluation work has produced excellent documentation and a clear understanding of the FluidCalendar scheduler's internals. The algorithm is sound and well-characterized. The adapters (ConflictWindowsCalendarService, TaskWriter) demonstrate good engineering instincts. But the fundamental architecture — a scheduler that mutates database rows during computation — is the wrong foundation for a standalone service. The right move is to take the algorithm, the API contract, the test patterns, and the docs, and build a clean implementation in Project Ops that is a pure function from day one.

The FC codebase should be preserved as a reference and for its own product use, but it should not be the runtime dependency for Project Ops scheduling.
