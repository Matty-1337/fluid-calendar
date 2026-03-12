# Project Ops + FluidCalendar Integration — Master Plan

**Created:** 2025-03-07  
**Purpose:** Central source of truth for the Project Ops ↔ FluidCalendar integration implementation phase.  
**Repo:** [dotnetfactory/fluid-calendar](https://github.com/dotnetfactory/fluid-calendar)

---

## Phase 1 — Current State Assessment

### 1. Current Status of the FluidCalendar Repo

- **Repo intelligence layer:** Present and complete.
  - `CLAUDE.md` — project overview, quick commands, tech stack, structure, conventions, NEVER DO, known issues (~180 lines).
  - `.cursor/ANALYSIS.md` — exists (content not read in this run; see audit docs for architecture).
  - `.cursor/environment.json` — install: `npm install --legacy-peer-deps`, start: `npm run dev`, secrets: DATABASE_URL, NEXTAUTH_*, NEXT_PUBLIC_*, RESEND_*.
  - `.cursor/rules/` — 4 files: `main-rule.mdc`, `api.mdc`, `database.mdc`, `frontend.mdc`.
  - `.cursor/skills/` — 6 skills: add-api-endpoint, add-component, auto-schedule, calendar-integration, database-migration, task-sync-provider.
  - `.claude/MEMORY.md` — session memory; `.claude/skills/` mirrors `.cursor/skills/`.
  - `HANDOFF.md` — template (placeholder).
- **Tech stack (from CLAUDE.md):** Next.js 15.3.8, React 19, TypeScript 5.8, Prisma 6.3, PostgreSQL 16, NextAuth 4.24, FullCalendar 6.1, Zustand, React Query, 59 API route handlers, 27 Prisma models, 35 migrations.
- **Build:** `npm run build`, `npm run build:os` (OSS), `docker compose up -d` for full stack. Always use `npm install --legacy-peer-deps`.

### 2. Scheduler Core Files and Execution Path

| File | Lines | Role | Coupling |
|------|-------|------|----------|
| `src/services/scheduling/TaskSchedulingService.ts` | 236 | Entry point; fetches AutoScheduleSettings + UserSettings (timezone) and tasks from Prisma; calls SchedulingService; writes results and lastScheduled. | Full Prisma (findUnique, findMany, updateMany, update). |
| `src/services/scheduling/SchedulingService.ts` | 316 | Orchestrator; batch scoring (8 at a time); 7-day window; sort by score; for each task calls scheduleTask → TimeSlotManager.findAvailableSlots, then prisma.task.update. | Prisma (task.update, task.findMany); useSettingsStore fallback when no settings passed. |
| `src/services/scheduling/TimeSlotManager.ts` | 461 | Slot generation (30-min steps, work days/hours), conflict removal (calendar + scheduled tasks), scoring via SlotScorer, addScheduledTaskConflict. | CalendarService interface; optional timeZoneOverride (else useSettingsStore.user.timeZone). |
| `src/services/scheduling/SlotScorer.ts` | 212 | 7-factor weighted scoring: deadlineProximity 3.0, priorityScore 1.8, energyLevelMatch 1.5, timePreference 1.2, workHourAlignment 1.0, bufferAdequacy 0.8, projectProximity 0.5. | Pure: settings + task + slot in, number out. |
| `src/services/scheduling/CalendarServiceImpl.ts` | 294 | getEvents(start, end, calendarIds); findConflicts; findBatchConflicts; overlap detection. Cached by week/calendars. | Prisma for CalendarEvent; calendar feed IDs from settings. |
| `src/services/scheduling/CalendarService.ts` | 31 | Interface for calendar conflict abstraction. | None. |

**Execution path (current):**  
`POST /api/tasks/schedule-all` → `scheduleAllTasksForUser(userId)` → load settings + user timezone from DB → load tasks (isAutoScheduled, !scheduleLocked, status not completed/in_progress) → clear scheduledStart/End/Score for those → `new SchedulingService(settings, userTimeZone)` → `scheduleMultipleTasks(tasks, userId)` → score all → sort by score → for each task: findAvailableSlots → pick best → `prisma.task.update` → addScheduledTaskConflict.

### 3. Known Bugs Already Identified

From `docs/bug-triage.md`:

| ID | Title | Severity | Status |
|----|--------|----------|--------|
| B1 | Auto-schedule ignores user timezone | Critical | **Fixed** — timezone from UserSettings in TaskSchedulingService. |
| B2 | Tasks scheduled between events (overlap) | Major | Open. CalendarServiceImpl / TimeSlotManager boundary or cache. |
| B3 | Docker quick start not working | Major | Environment (docker-compose vs docker compose; daemon must run). |
| B4 | Settings page "Something went wrong!" | Major | Open. |
| B5 | Cannot add multiple CalDAV providers | Medium | Open. |
| B6 | Several connected Google accounts | Medium | Open. |
| B7 | SchedulingService uses client store when no settings passed | Medium | Open. Fallback to useSettingsStore in getTimeSlotManager(). |
| B8 | Buffer time not enforced | Low | Open. Only marks hasBufferTime. |
| B9 | Event cache not invalidated on sync/CRUD | Low | Open. |
| B10 | Strange auto-scheduling behavior (#118) | Medium | Open. |

### 4. Existing Fixes Already Made

- **B1 (timezone):** `TaskSchedulingService` fetches `UserSettings` with `AutoScheduleSettings`, reads `userSettings?.timeZone ?? "UTC"`, passes to `new SchedulingService(autoScheduleSettings, userTimeZone)`. `SchedulingService` stores `timeZone` and passes `this.timeZone ?? undefined` to `TimeSlotManagerImpl`. `TimeSlotManagerImpl` constructor accepts `timeZoneOverride` and uses it instead of the Zustand store. When schedule-all runs on the server, user timezone is now correct.

### 5. Current Deployment Readiness

From `docs/railway-deploy.md`:

- **Suitable for Railway:** Next.js standalone, PostgreSQL, stateless, JWT session. One web service + one DB.
- **Required env:** DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET; recommended NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SITE_URL. Optional RESEND_*, NEXT_PUBLIC_ENABLE_SAAS_FEATURES.
- **Migrations:** Run `npx prisma migrate deploy` on first deploy (or use Docker entrypoint).
- **Pitfalls:** Ensure build uses `output: "standalone"` (next.config); use `docker-compose` on Windows if needed; Docker daemon must be running for local compose.

### 6. Current Risks for Production Use

From `docs/final-recommendation.md` (top risks):

1. Overlap bug (#150) — tasks in conflicting slots.
2. No scheduler tests — regressions likely.
3. Client store on server — SchedulingService fallback.
4. Event cache staleness — double-booked slots after sync.
5. Buffer not enforced.
6. Multi-account and settings bugs.
7. Dependency/native build (e.g. better-sqlite3 on Node 25 / Windows).
8. Next config duality (standalone).
9. Security/secrets.
10. Scaling/concurrency (single-user synchronous scheduler).

### 7. Current Recommended Usage Posture

From `docs/final-recommendation.md` and `docs/project-ops-integration-plan.md`:

- **Do not deploy as-is for production.** Use as inspiration or source for the scheduling algorithm.
- **Short term:** Deploy internally for testing only (with timezone fix).
- **Medium term:** Fork and improve or embed the scheduler (Option B or C). Add API that accepts Project Ops tasks/settings and returns or applies schedules; Project Ops remains source of truth.
- **Best role for “scheduling engine”:** Extract or call via new API with Project Ops tasks and settings (embed or fork). Not: replace Project Ops with FluidCalendar, or iframe the full app for unified UX.

**Evidence:** Scheduler logic is rule-based and heuristic; timezone is now server-supplied; Prisma and store coupling are documented; overlap and cache issues are open; no public “schedule these tasks” API today.

---

## Phase 2 — Integration Target Architecture

### Options Compared

| Option | Description | Feasibility | Effort | Risk | Coupling | Maintainability | Auth complexity | Calendar complexity | UX | Source-of-truth |
|--------|-------------|-------------|--------|------|----------|-----------------|-----------------|--------------------|-----|-----------------|
| **A. Loose sidecar** | Project Ops sends tasks to FluidCalendar via API; FC schedules and writes to calendar. | High | 1–2 days | Medium (two systems) | Loose | Medium (two codebases) | High (bridge or API key) | High (FC owns calendars or sync) | Two UIs | Project Ops for tasks; FC for calendar/slots |
| **B. Embedded module** | Mount FluidCalendar UI/pages inside Project Ops. | Medium | 1–2 weeks | High | High | Low | High (SSO/session) | Medium | Single UI but iframe/auth friction | Project Ops |
| **C. Scheduler microservice extraction** | Extract SlotScorer + TimeSlotManager + orchestration into a service; Project Ops sends task DTOs, gets slots; calendar conflicts passed in or via adapter. | Medium–High | 2–4 weeks | Medium | Low once extracted | High (we own the service) | Low (API key or internal) | Medium (event source abstraction) | Single UI (Project Ops) | Project Ops |
| **D. Reference only** | Use FluidCalendar algorithm as inspiration; build Project Ops–native scheduler. | High | 4+ weeks | Low (no FC dependency) | None | High (full control) | N/A | Project Ops owns | Single UI | Project Ops |

### Option A — Loose sidecar

- **Feasibility:** High. Deploy FluidCalendar as-is; add a “schedule these tasks” API that accepts DTOs; Project Ops calls it.
- **Effort:** Low (1–2 days to add API route + auth).
- **Risk:** Two systems to run; sync or duplicate task representation; auth bridge.
- **Coupling:** Loose at boundary; tight inside FC.
- **Auth:** Project Ops must authenticate to FC (API key, service account, or shared user).
- **Calendar:** FC uses its own calendars; Project Ops would need to sync events or pass conflict windows.
- **Verdict:** Good for **short-term testing** and validation. Not ideal long term if we want one codebase and Project Ops as sole source of truth.

### Option B — Embedded module

- **Feasibility:** Medium. iframe or embed FC app; requires SSO or session sharing.
- **Effort:** 1–2 weeks (auth, styling, navigation).
- **Risk:** High — same-origin, cookies, two apps in one UX.
- **Coupling:** High; FC’s routes and state inside Project Ops.
- **Verdict:** **Not recommended** per existing integration plan; API-driven scheduling preferred.

### Option C — Scheduler microservice extraction

- **Feasibility:** Medium–High. Core logic in `SlotScorer`, `TimeSlotManager`, `SchedulingService`; Prisma and store can be replaced with DTOs and a calendar-event abstraction.
- **Effort:** 2–4 weeks (extract, abstract Prisma/calendar, expose API or in-process facade).
- **Risk:** Medium; extraction and testing required; calendar conflict source must be pluggable.
- **Coupling:** Low once done; Project Ops sends tasks + settings, receives slots.
- **Maintainability:** High; we own the extracted service and can fix overlap/buffer/cache.
- **Auth:** Simple (internal API or in-process call).
- **Calendar:** Event source can be adapter (Project Ops or FC calendars); conflicts passed in or fetched via interface.
- **Verdict:** **Best primary option** for “Project Ops as source of truth” and long-term control.

### Option D — Reference only

- **Feasibility:** High. Reimplement scoring and slot logic in Project Ops stack.
- **Effort:** 4+ weeks; full reimplementation and tests.
- **Risk:** Low (no dependency on FC repo).
- **Verdict:** **Best fallback** if extraction (C) proves too coupled or we want zero FC dependency.

### Primary and Fallback Choices

- **Primary:** **Option C — Scheduler microservice extraction.** Extract or facade the scheduler; accept Project Ops task + settings DTOs; return suggested slots; optionally apply schedule via callback or writeback. Keeps Project Ops as source of truth and allows fixing FC bugs in one place.
- **Fallback:** **Option D — Reference only.** If extraction reveals too much hidden coupling (e.g. Prisma types deep in scoring), use FC as reference and reimplement the algorithm in Project Ops.

Option A remains viable for **immediate testing** (add a single API route to FC that accepts tasks + timezone + settings and returns slots without persisting).

---

## References

- `CLAUDE.md` — project reference
- `docs/fluidcalendar-audit.md` — architecture, scheduler, risks, extractability
- `docs/bug-triage.md` — bug table and fixes
- `docs/final-recommendation.md` — go/no-go, effort, risks, next steps
- `docs/railway-deploy.md` — deployment
- `docs/project-ops-integration-plan.md` — options A–D, API, coupling, field mapping
- `docs/testing-hardening.md` — coverage gaps
