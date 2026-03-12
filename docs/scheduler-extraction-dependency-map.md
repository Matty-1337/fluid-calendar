# Scheduler Extraction — Dependency Map

**Date:** 2025-03-07  
**Purpose:** Trace coupling in the FluidCalendar scheduler core to determine what can be extracted, what needs an abstraction layer, and what should not be extracted yet.

---

## 1. Summary Matrix

| File | Pure logic | App-coupled | DB-coupled | Provider-coupled | UI/store-coupled |
|------|------------|-------------|------------|------------------|------------------|
| SlotScorer.ts | Scoring algorithm | None | None | None | None |
| TimeSlotManager.ts | Slot generation, filtering, scoring delegation | — | prisma.task.findMany (updateScheduledTasks) | CalendarService interface | useSettingsStore (timezone fallback) |
| SchedulingService.ts | Batch orchestration, window loop | — | prisma.task.update, prisma.task.findMany | None | useSettingsStore (settings fallback) |
| TaskSchedulingService.ts | None (glue) | — | All: findUnique (settings, userSettings), findMany (tasks), updateMany, update | None | None |
| CalendarServiceImpl.ts | Overlap detection, cache logic | — | prisma.task.findMany, prisma.calendarEvent.findMany | Calendar feed IDs from settings | None |
| CalendarService.ts | Interface only | — | None | None | None |

---

## 2. Pure Scheduling Logic (Extractable Immediately)

### SlotScorer.ts

- **Dependencies:** `@prisma/client` (AutoScheduleSettings, Task types only — can be replaced by interfaces), `@/lib/autoSchedule` (getEnergyLevelForTime), `@/lib/date-utils` (differenceInHours, differenceInMinutes, newDate), `@/types/scheduling`, `@/types/task` (Priority).
- **Functions:** `scoreSlot(slot, task)`, `updateScheduledTasks(tasks)`, and all private score* methods.
- **Verdict:** **Extractable now.** Replace Prisma types with plain interfaces (Task with duration, dueDate, priority, energyLevel, preferredTime, projectId; Settings with work hours and energy windows). `getEnergyLevelForTime` is in `src/lib/autoSchedule.ts` (pure). No Prisma calls; no store. Can run in any Node context with dependency-injected settings and task shape.

### TimeSlotManager — slot generation and filtering only

- **generatePotentialSlots(duration, startDate, endDate):** Uses `this.settings` (work days/hours), `this.timeZone`, and `date-utils` (addMinutes, getDay, setHours, setMinutes, toZonedTime, roundDateUp, newDate). **Pure** if settings and timezone are passed in; no DB, no store in this method.
- **filterByWorkHours(slots):** Uses slot and settings. **Pure.**
- **applyBufferTimes(slots):** Uses settings.bufferMinutes and date-utils. **Pure.**

These can be extracted into a “slot generator” module that takes (settings, timeZone, date range, duration) and returns candidate slots. No Prisma.

---

## 3. App-Coupled Logic (Needs Abstraction)

### TimeSlotManagerImpl

- **findAvailableSlots(task, startDate, endDate, userId):** Calls `updateScheduledTasks(userId)` (Prisma) if scheduled-task set is empty; then generatePotentialSlots → filterByWorkHours → removeConflicts (CalendarService + Prisma in CalendarServiceImpl) → applyBufferTimes → score and sort. **Coupling:** (1) Prisma via updateScheduledTasks, (2) CalendarService (which today is CalendarServiceImpl and uses Prisma), (3) timezone from constructor (OK when timeZoneOverride passed) or useSettingsStore (bad on server).
- **updateScheduledTasks(userId):** `prisma.task.findMany` for scheduled tasks; then `slotScorer.updateScheduledTasks(scheduledTasks)`. **Needs abstraction:** “scheduled task source” — could be passed in as list of { start, end, projectId } instead of Prisma.
- **addScheduledTaskConflict(task):** In-memory only; calls slotScorer. **Pure** (no DB in this method).
- **removeConflicts(slots, task):** Calls `calendarService.findBatchConflicts` and filters. So **provider-coupled** via CalendarService interface; implementation (CalendarServiceImpl) uses Prisma.

**Verdict:** **Needs abstraction layer.** (1) Inject “scheduled tasks for user” as data (not Prisma). (2) CalendarService interface is already abstract; provide an implementation that takes conflict windows from request (e.g. Project Ops) instead of Prisma. (3) Require timezone (and settings) in constructor; remove store fallback for server path.

### SchedulingService

- **scheduleMultipleTasks(tasks, userId):** Orchestration only; uses getTimeSlotManager() (which uses settings or store fallback), then for each task calls scheduleTask. At end: `prisma.task.findMany` to return all tasks. **DB-coupled:** prisma.task.update in scheduleTask, prisma.task.findMany at end.
- **scheduleTask(task, timeSlotManager, userId):** findAvailableSlots → pick best slot → `prisma.task.update(...)`. **DB-coupled:** write must be abstracted (callback or return slot and let caller persist).
- **getTimeSlotManager():** If no settings, uses `useSettingsStore.getState().autoSchedule`. **Store-coupled;** should require settings in server path.

**Verdict:** **Needs abstraction.** (1) “Task writer” callback or interface: instead of prisma.task.update, call `writeScheduledSlot(taskId, start, end, score)`. (2) Require (settings, timezone) in constructor; no store fallback. (3) Final findMany can be removed if caller only needs the list of (taskId, start, end) returned from scheduleTask.

### TaskSchedulingService

- **scheduleAllTasksForUser(userId):** Loads settings and user timezone from Prisma; loads tasks from Prisma; clears schedules via updateMany; calls SchedulingService; updates lastScheduled via updateMany; fetches tasks again. **Fully DB-coupled.** This is the “app entry point”; for extraction, replace with a function that accepts (tasks[], settings, timezone) and returns (taskId, scheduledStart, scheduledEnd)[].

**Verdict:** **Do not extract as-is.** Use as reference; implement a facade that takes DTOs and calls SchedulingService with a custom “task writer” and “scheduled task source” and “calendar conflict source.”

---

## 4. Database-Coupled Logic

| Location | What | Abstraction idea |
|----------|------|------------------|
| TaskSchedulingService | findUnique autoScheduleSettings, userSettings; findMany task; updateMany task; findMany task | Pass in settings, timezone, and task list; return schedule results; no Prisma in facade. |
| SchedulingService | task.update (in scheduleTask); task.findMany (final list) | Writer callback: (taskId, start, end, score) => Promise<void>. Return scheduled slots from scheduleTask. |
| TimeSlotManager.updateScheduledTasks | task.findMany (scheduled tasks) | Inject “get scheduled tasks for user” as function or list. |
| CalendarServiceImpl.findConflicts | task.findMany (scheduled tasks); getEvents → calendarEvent.findMany | Event source: (start, end, calendarIds) => Promise<Event[]>. Scheduled tasks: same as above (list or callback). |
| CalendarServiceImpl.getEvents | calendarEvent.findMany | Implement CalendarService with getEvents that reads from passed-in conflict windows or external API. |

---

## 5. Provider-Coupled Logic

- **CalendarService interface:** getEvents(start, end, calendarIds); findConflicts(slot, calendarIds, userId, excludeTaskId?); findBatchConflicts(slots, calendarIds, userId, excludeTaskId?). Implementations today use Prisma (CalendarEvent, Task). For extraction, provide an implementation that:
  - getEvents: returns events from a list passed in the request (e.g. Project Ops conflict windows), or calls an external calendar API.
  - findConflicts / findBatchConflicts: use that event list plus “scheduled tasks” list (in-memory or from adapter).
- **CalendarServiceImpl** is the only implementation; it is **provider-coupled** only in the sense that it fetches from DB. No direct Google/Outlook dependency in the scheduler; those are in sync/feed layer.

---

## 6. UI-Coupled Logic

- **useSettingsStore.getState().user.timeZone** in TimeSlotManagerImpl constructor (fallback when no timeZoneOverride).
- **useSettingsStore.getState().autoSchedule** in SchedulingService.getTimeSlotManager() (fallback when no settings).

Both are **server-unsafe.** For extraction or API/facade path: **require** timezone and settings; never read from store in scheduler code path.

---

## 7. What Can Be Extracted Immediately

1. **SlotScorer** — with interface types for Task and AutoScheduleSettings (no Prisma).
2. **Slot generation and work-hour filtering** — from TimeSlotManager (generatePotentialSlots, filterByWorkHours, applyBufferTimes) into a pure function or small module; depends on date-utils and autoSchedule.
3. **Scoring loop** — given slots and a task, score and sort (SlotScorer.scoreSlot); no DB.

---

## 8. What Needs an Abstraction Layer

1. **Scheduled task source** — TimeSlotManager and CalendarServiceImpl need “current scheduled tasks” for conflict checking. Abstract as: `getScheduledTasks(userId): Promise<{ start, end, projectId?, taskId? }[]>` or pass list per request.
2. **Calendar event source** — CalendarServiceImpl.getEvents. Abstract as: `getEvents(start, end, calendarIds): Promise<{ start, end, title?, id? }[]>` with implementation that reads from request (Project Ops) or FC DB.
3. **Task write-back** — SchedulingService.scheduleTask. Abstract as: `onSlotSelected(taskId, start, end, score): Promise<void>` so the caller (e.g. Project Ops adapter) persists; no prisma.task.update inside scheduler.
4. **Settings and timezone** — Always pass explicitly; remove store fallback in server path.

---

## 9. What Should Not Be Extracted Yet

1. **TaskSchedulingService as a whole** — It is the FC app’s entry point; keep it. Build a separate facade (e.g. projectops/schedulerFacade) that uses SchedulingService with the abstractions above.
2. **CalendarServiceImpl** — Keep in FC; for Project Ops, add a second implementation of CalendarService that uses passed-in conflict windows or an external event source.
3. **Prisma schema and migrations** — Do not change for extraction; extraction is done by adding adapters and optional code paths, not by removing FC’s own DB usage.
4. **Full CalendarServiceImpl cache and TTL** — Can stay; when providing an alternate CalendarService impl for Project Ops, cache is optional (e.g. per-request events).

---

## 10. Recommended Extraction Order for PoC

1. **Define interfaces:** TaskLike, SettingsLike, EventLike, ScheduledTaskSource, EventSource, TaskWriter.
2. **Implement Project Ops facade:** Accept ProjectOpsScheduleRequest; map to FC task shape and settings; create SchedulingService with required settings + timezone; provide TaskWriter that collects (taskId, start, end) and returns in ScheduleResult; provide ScheduledTaskSource and EventSource from request or mocks.
3. **Optional:** Implement CalendarServiceAdapter that getEvents returns request.conflictWindows as “events” so no FC calendar DB is needed for PoC.
4. **Do not refactor** SchedulingService or TimeSlotManager internals in PoC; use them as-is and only add the facade + optional adapter that feeds data from the request.
