# Scheduler Extraction — Next Step

**Purpose:** Focused extraction analysis after the Project Ops PoC and the introduction of `ConflictWindowsCalendarService` and optional `CalendarService` injection. Identifies what is now closest to portable, what still blocks extraction, and the minimum viable extracted scheduler. Includes the `TaskWriter` abstraction to remove the remaining DB dependency from `SchedulingService`.

**Related:** `docs/scheduler-extraction-dependency-map.md`, `docs/project-ops-fluidcalendar-final-decision.md`.

---

## 1. What is now closest to portable

| File | Status | Notes |
|------|--------|------|
| **SlotScorer.ts** | Portable | Pure scoring logic; no DB, no store. Depends only on settings/task shapes and date-utils. |
| **CalendarService** (interface) | Portable | Interface only; already in `src/services/scheduling/CalendarService.ts`. |
| **TimeSlotManager** / **TimeSlotManagerImpl** | Portable once CalendarService provided | Uses injected `CalendarService`; no direct Prisma in slot generation. Receives settings and timezone from constructor. `updateScheduledTasks` still uses Prisma (see dependency map); for full extraction that would be a separate “scheduled task source” injectable. |
| **ConflictWindowsCalendarService** | Portable | Implements `CalendarService` with in-memory conflict windows; no DB. Lives under `src/lib/projectops/`; could move with scheduler. |
| **SchedulingService** | Portable **after TaskWriter** | With optional `TaskWriter` injected, the two remaining Prisma calls (`task.update`, `task.findMany`) are replaced by interface calls. Then SchedulingService has no direct Prisma dependency. |

---

## 2. Remaining DB dependencies that block extraction

### SchedulingService (before TaskWriter)

- **Line ~278:** `prisma.task.update(...)` — writes the chosen slot (scheduledStart, scheduledEnd, isAutoScheduled, duration, scheduleScore) back to the task. Required so the same run can treat this task as a conflict for subsequent tasks (via `timeSlotManager.addScheduledTaskConflict(updatedTask)`).
- **Line ~221:** `prisma.task.findMany({ where: { id: { in: taskIds }, userId } })` — re-fetches all tasks (including locked ones) after scheduling to return the final list.

These are the **only** remaining Prisma usages inside `SchedulingService`. The temp-task pattern in the Project Ops facade (create tasks, run scheduler, delete tasks) works around the need for real DB tasks but does not remove the dependency inside the service; it only isolates the lifecycle to the facade.

### TimeSlotManager (secondary)

- **updateScheduledTasks(userId):** Still calls `prisma.task.findMany` to load already-scheduled tasks for conflict scoring. For full extraction, this would be abstracted as a “scheduled task source” (e.g. inject a function that returns `Task[]` or `{ start, end, projectId }[]`). Not addressed in this step to keep the change set small.

---

## 3. Temp task orchestration

The facade currently:

1. Creates temporary tasks in the DB via `prisma.task.create`.
2. Calls `SchedulingService.scheduleMultipleTasks(createdTasks, userId)`; the service updates those tasks and re-fetches them via Prisma.
3. Maps results back to the request task order and returns.
4. Deletes the temporary tasks in `finally`.

**After TaskWriter:** The same flow still works: the facade continues to create temp tasks and pass them in; `SchedulingService` uses `PrismaTaskWriter` by default, so it still updates and re-fetches from Prisma. No change to facade behavior.

**Future extraction:** Once `TaskWriter` exists, an **in-memory** implementation can be added: it holds a map of task id → task and updates that map when `updateScheduledSlot` is called; `fetchTasks` returns from that map. The facade could then pass tasks in memory and use that in-memory `TaskWriter`, avoiding create/delete of DB rows. That would be a follow-up step; this phase only introduces the interface and the Prisma implementation.

---

## 4. Minimum viable extracted scheduler

The smallest set of code that could be moved to a package or service and run without FluidCalendar’s app/DB:

- **SchedulingService** — with `TaskWriter` and `CalendarService` injected (no Prisma).
- **TimeSlotManager** / **TimeSlotManagerImpl** — with `CalendarService` and (for full extraction) an abstract “scheduled task source” instead of Prisma in `updateScheduledTasks`.
- **SlotScorer** — as-is.
- **CalendarService** interface — as-is.
- **TaskWriter** interface — as defined in `src/services/scheduling/TaskWriter.ts`.
- **ConflictWindowsCalendarService** (or equivalent) — so callers can supply conflicts without a DB.
- Types from `@/types/scheduling` (and any task/settings types used by SlotScorer and TimeSlotManager).

Dependencies to carry or reimplement: `@/lib/date-utils`, `@/lib/autoSchedule` (getEnergyLevelForTime), logger. Prisma and NextAuth would **not** be required in the extracted package.

---

## 5. Interfaces for extraction

| Provider | Purpose | Status |
|----------|---------|--------|
| **Task input** | Supplies tasks to schedule (id, duration, dueDate, priority, etc.). | Today the caller (facade or TaskSchedulingService) loads tasks and passes the array. No interface yet; just function signature. |
| **Conflict window / calendar** | Supplies busy periods so the scheduler avoids them. | **CalendarService** interface; implementations: `ConflictWindowsCalendarService` (in-memory), `CalendarServiceImpl` (Prisma). |
| **Task writer** | Persists the chosen slot for a task and returns updated task; fetches tasks by id. | **TaskWriter** interface + **PrismaTaskWriter** (this step). Enables in-memory or remote writer later. |
| **Settings / timezone** | Work days, work hours, buffer, energy windows, timezone. | Passed explicitly into `SchedulingService(settings, timeZone, calendarService?, taskWriter?)` and into `TimeSlotManager`. No store dependency. |

No broad refactor: only the TaskWriter abstraction is added. CalendarService and explicit settings/timezone were already in place.

---

## 6. What not to do (this phase)

- Do **not** extract to a separate npm package or repo yet.
- Do **not** refactor `CalendarServiceImpl` (it remains for the full FC app; Project Ops path uses `ConflictWindowsCalendarService`).
- Do **not** change `TaskSchedulingService` (app-level orchestrator; stays in FC).
- Do **not** add a “scheduled task source” abstraction for `TimeSlotManager.updateScheduledTasks` in this step (can be a later extraction step).

---

## 7. Summary

- **TaskWriter** removes the last direct Prisma usage from `SchedulingService`, making it injectable and testable without a database.
- **PrismaTaskWriter** preserves current behavior; existing callers (facade, TaskSchedulingService) need no changes when the constructor defaults to it.
- The minimum viable extracted scheduler is the set of files listed in §4, with TaskWriter and CalendarService as the two key abstraction boundaries.
