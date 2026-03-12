# FluidCalendar — Project Ops Integration Plan

**Date:** 2025-03-07  
**Goal:** Use FluidCalendar (or its scheduling logic) as the task-to-calendar scheduling engine for a custom Project Ops portal where Project Ops is the source of truth for tasks, projects, assignees, statuses, priorities, deadlines, and workflow.

---

## 1. Four Possible Roles

| Option | Description | Realism |
|--------|-------------|---------|
| **A. Standalone scheduler app beside Project Ops** | Run FluidCalendar as a separate app; users manage tasks in both systems or sync manually. | **High** — Deploy as-is; integrate via export/import or manual linking. Loose coupling, duplicate task management. |
| **B. Embedded / internal scheduling engine** | Use FluidCalendar’s scheduling algorithm inside Project Ops (same codebase or service). | **Medium** — Scheduler logic is extractable (see audit); requires passing Project Ops tasks/calendars into the engine and mapping data models. |
| **C. Fork and extract scheduling logic** | Fork the repo, strip UI/auth/calendar to a library or microservice that only does slot finding and scoring. | **Medium–High** — Clear separation; more work to maintain a fork and keep Prisma/DB abstraction. |
| **D. Reference architecture only** | Do not use FluidCalendar directly; reimplement scheduling using its ideas (scoring, work hours, conflicts). | **High** — Full control; no dependency on a “buggy” repo; effort is reimplementation and testing. |

**Most realistic for “scheduling engine” use:** **B** (embed the logic) or **C** (fork and extract). **A** is realistic but keeps two UIs. **D** is realistic if you want no dependency on the repo.

---

## 2. Embedding via iframe

- **Feasibility:** FluidCalendar is a full Next.js app with its own auth, routes, and session. Embedding the whole app in an iframe inside Project Ops is **possible** but **not ideal**:
  - Users would log in again (or you’d need SSO and shared session).
  - URL and navigation are FluidCalendar’s, not Project Ops’.
  - Same-origin and cookie restrictions can complicate auth.
- **Verdict:** **Not recommended** unless you only need a “open scheduler in a new tab” link. For a seamless experience, prefer API-driven scheduling (B/C) or your own UI calling an extracted engine.

---

## 3. Exposing Scheduling via API

- **Current state:** FluidCalendar exposes `POST /api/tasks/schedule-all` (authenticated). It schedules **its own** tasks (same DB, same user). There is **no public REST API** to pass in arbitrary tasks and get back suggested slots or a schedule.
- **To expose scheduling for Project Ops:**
  - **Option 1:** Add a new API route (e.g. `POST /api/schedule/ suggest-slots` or `POST /api/schedule/run`) that accepts a list of tasks (title, duration, dueDate, priority, projectId, etc.) and optional calendar IDs / work hours, and returns suggested slots or updated schedule. The route would use the existing `SchedulingService` / `TimeSlotManager` / `SlotScorer` with passed-in task DTOs and settings (including timezone). No need to store tasks in FluidCalendar’s DB.
  - **Option 2:** Run the scheduler as a library inside Project Ops: extract the services (see audit), call them from your backend with Project Ops task and user settings. No HTTP to FluidCalendar.
- **Conclusion:** The logic **can** be exposed by API or in-process; today it is not. Adding an “external” scheduling API (Option 1) is a small extension if you keep FluidCalendar deployed; Option 2 is better if you only want the algorithm inside Project Ops.

---

## 4. Data Model Coupling

- **Tight coupling today:** Tasks, User, AutoScheduleSettings, UserSettings, CalendarFeed, CalendarEvent are Prisma models. The scheduler expects Prisma `Task` and `AutoScheduleSettings` and (after the fix) user timezone from `UserSettings`. It also reads calendar events via `CalendarServiceImpl` (Prisma).
- **For Project Ops:** You would either:
  - **Sync:** Replicate Project Ops tasks (and optionally calendars) into FluidCalendar’s DB and keep them in sync (batch or event-driven). Scheduler runs on FluidCalendar data. Coupling: high (two stores, sync logic).
  - **Adapter:** Map Project Ops task and calendar models to the shapes the scheduler expects (task with duration, dueDate, priority, projectId, etc.; settings with work hours, timezone, selected calendars). Call the scheduler in-process or via an API that accepts these DTOs. Coupling: low to scheduler internals; no need for FluidCalendar’s DB as source of truth.

**Verdict:** The data model is **tightly coupled to its own DB and auth** when used as a full app. For integration, **decouple by DTOs/API or in-process adapter** so Project Ops remains source of truth.

---

## 5. Recommended Integration Approach

| Approach | When to use | Pros | Cons |
|----------|-------------|------|------|
| **API sync** | Project Ops pushes tasks to FluidCalendar (or a thin “scheduler API” service) on create/update; scheduler runs there; results pushed back. | Clear boundary; can keep FluidCalendar stack. | Sync latency; duplicate storage or sync logic. |
| **Webhook / event-driven sync** | Project Ops emits events; a service (or FluidCalendar) consumes them and runs scheduler; writes suggested slots back via Project Ops API. | Near real-time. | Requires event pipeline and idempotency. |
| **Internal fork and extract** | Fork FluidCalendar; keep only `src/services/scheduling/`, `src/lib/autoSchedule.ts`, `date-utils`, and minimal interfaces; replace Prisma with your data access. | Single codebase under your control; no second app to run. | Maintenance of fork; abstraction of calendar/event source. |
| **Scheduler microservice** | Extract scheduler into a small service (Node or other) that exposes “suggest slots” or “schedule these tasks”; Project Ops calls it with tasks + settings. | Reusable; language-agnostic API. | Extra service to deploy and maintain. |

**Best fit for “Project Ops as source of truth”:**  
- **Short term:** **API sync** or **event-driven**: Project Ops sends task + user/settings payload to a scheduling endpoint (could be FluidCalendar with a new route, or an extracted service); get back suggested or applied slots and write them into Project Ops.  
- **Long term:** **Fork and extract** or **scheduler microservice** so you own the code, fix bugs (e.g. overlaps, buffer), and avoid depending on the full FluidCalendar app.

---

## 6. Field Mapping (Project Ops ↔ FluidCalendar)

| Project Ops (example) | FluidCalendar | Notes |
|------------------------|---------------|-------|
| Task title | `Task.title` | Direct. |
| Description | `Task.description` | Direct. |
| Assignee | `Task.userId` | Map to FluidCalendar user or “scheduling user” for that run. |
| Priority | `Task.priority` | high/medium/low/none. |
| Due date | `Task.dueDate` | DateTime. |
| Estimated duration | `Task.duration` | Minutes. |
| Earliest start | `Task.startDate` | When task becomes schedulable. |
| Recurrence | `Task.recurrenceRule` | RRule string. |
| Project | `Task.projectId` / `Project` | For grouping and project proximity scoring. |
| Tags | `Task.tags` | Optional for filtering. |
| Calendar ID(s) | `AutoScheduleSettings.selectedCalendars` | Which calendars to check for conflicts. |
| Scheduling status | `Task.isAutoScheduled`, `scheduledStart`, `scheduledEnd`, `scheduleLocked` | Map “scheduled” back to Project Ops. |

Additional FluidCalendar fields you may need to supply or default: `energyLevel`, `preferredTime` (morning/afternoon/evening), work days/hours, buffer minutes, timezone (required for correct slots).

---

## 7. Changes Needed for FluidCalendar as Backend Scheduler for Project Ops

1. **New API surface:** Route(s) that accept external task list + user/settings (timezone, work hours, selected calendar IDs) and return suggested slots or persist nothing and return schedule. No dependency on FluidCalendar session if called with an API key or internal auth.
2. **Auth:** Decide how Project Ops authenticates to FluidCalendar (API key, service account, or shared user). Current routes use NextAuth session (user-bound).
3. **Idempotency:** If Project Ops sends the same task set repeatedly, scheduler should be idempotent or return consistent results.
4. **Timezone and settings:** Already fixed for internal use (user timezone from DB). For external API, require timezone (and optionally full settings) in the request body.
5. **Calendar events:** If Project Ops owns calendars elsewhere, you must either sync events into FluidCalendar’s `CalendarEvent` table or plug a different “event source” into the scheduler (e.g. adapter that fetches from Project Ops or a calendar API). Current conflict logic is tied to Prisma `CalendarEvent` and selected feed IDs.

---

## 8. When FluidCalendar Is a Bad Fit

- **Strict SLA / compliance:** Repo is self-described as buggy and not production-ready; overlap and edge-case bugs exist.
- **No control over stack:** You need a different DB, auth, or language and don’t want to maintain a fork.
- **Heavy customization:** If you need very different scoring, constraints, or ML-based scheduling, starting from the current heuristic may be more work than a clean reimplementation.
- **Multi-tenant SaaS at scale:** Current design is multi-user but not built for large multi-tenant isolation, rate limiting, or horizontal scaling of the scheduler (would require refactors).

---

## 9. Summary

- **Best role for “scheduling engine”:** Use the **scheduling logic** (Option B or C): extract or call it via a new API with Project Ops tasks and settings; keep Project Ops as source of truth.
- **Embedding the full app in an iframe** is possible but not recommended for a unified UX.
- **Scheduling can be exposed by API** by adding a route that accepts task + settings DTOs and runs the existing services (with timezone and settings passed in).
- **Data model is coupled** to Prisma and FluidCalendar’s auth; use **DTOs and adapters** (or an extracted service) to avoid storing Project Ops data in FluidCalendar’s DB.
- **Recommended path:** Implement an external scheduling API (or extract the scheduler into your stack), map Project Ops fields as above, supply timezone and work hours per user, and optionally plug in your own calendar/event source for conflicts.
