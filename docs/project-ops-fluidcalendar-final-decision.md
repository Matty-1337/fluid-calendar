# Project Ops + FluidCalendar — Final Decision

**Date:** 2025-03-07  
**Purpose:** Go/no-go and concrete next steps after the Project Ops integration PoC phase.

---

## 1. Best Integration Model

**Primary:** **Option C — Scheduler microservice extraction.**  
Extract the scheduling core (SlotScorer, TimeSlotManager, orchestration) into a standalone service or internal package with a clean DTO API. Project Ops sends task + settings payloads and receives suggested slots. Calendar conflicts are supplied via an abstraction (request payload or external event source). Project Ops remains source of truth; no dependency on FluidCalendar’s DB or UI long term.

**Evidence from PoC:** The facade (runProjectOpsSchedule) proved that we can run the existing SchedulingService with request-supplied settings and timezone and get back scheduled slots. The blocking coupling is Prisma (task create/update/delete and calendar events). The dependency map (docs/scheduler-extraction-dependency-map.md) shows what must be abstracted (task writer, scheduled task source, event source) to make the scheduler reusable without FC’s DB.

---

## 2. Fallback Model

**Option D — Reference only.**  
If extraction proves too costly (e.g. deep Prisma usage in CalendarServiceImpl or TimeSlotManager), use FluidCalendar’s algorithm and docs as reference and reimplement a scheduler in Project Ops’ stack. No runtime dependency on FC.

---

## 3. What Was Implemented in This Phase

- **docs/project-ops-fluidcalendar-master-plan.md** — Current state (Phase 1) and integration architecture comparison (Phase 2).
- **docs/project-ops-scheduler-contract.md** — Field mapping and normalized DTOs (ProjectOpsScheduleRequest, ScheduleResult).
- **docs/scheduler-extraction-dependency-map.md** — Coupling by file; pure vs DB vs store vs provider; what to extract or abstract.
- **src/lib/projectops/types.ts** — ProjectOpsTask, ProjectOpsScheduleRequest, ProjectOpsScheduleSettings, ScheduleResult, TaskScheduleResult.
- **src/lib/projectops/mappers.ts** — projectOpsTaskToCreateInput, projectOpsSettingsToAutoScheduleSettings.
- **src/lib/projectops/schedulerFacade.ts** — runProjectOpsSchedule: create temp tasks, run SchedulingService, return results, delete temp tasks.
- **src/app/api/projectops/schedule/route.ts** — POST /api/projectops/schedule (auth required).
- **docs/project-ops-sample-payloads.md** — Four sample payloads (success, conflict, timezone, impossible).
- **src/lib/projectops/__tests__/mappers.test.ts** — Unit tests for mappers (4 tests).
- **docs/project-ops-integration-testing.md** — Tests added, missing, high-risk areas.
- **docs/project-ops-hosting-strategy.md** — Hosting options and recommendation.
- **docs/project-ops-fluidcalendar-final-decision.md** — This document.

---

## 4. What Worked

- Running the existing scheduler with request-supplied timezone and settings (no store fallback in this path).
- Mapping Project Ops task and settings DTOs to FC shapes and creating temporary tasks for a single run.
- Receiving structured ScheduleResult with per-task success, scheduledStart, scheduledEnd, scheduleScore, reason.
- Cleaning up temporary tasks after the run.
- Unit tests for mappers passing.

---

## 5. What Failed or Is Incomplete

- **Calendar conflicts from Project Ops:** The PoC still uses FC’s CalendarServiceImpl (Prisma calendar events). Passing conflict windows from the request (e.g. Project Ops–owned calendar) is not implemented; selectedCalendars in the request are passed to the existing FC calendar layer. To be “source of truth” for Project Ops, we need an event source adapter that accepts conflict windows from the request.
- **Overlap bug (B2):** Not addressed in this phase; scheduler may still place tasks between events in some cases.
- **No DTO validation schema:** Request body is cast; invalid payloads may cause runtime errors.
- **Result order:** We match by task id; multiple tasks are scheduled in score order, so result order may not match request order. We map by id so each result is correct, but the response array order is the scheduler’s order, not the request order (we currently preserve request order by looking up by taskIds[i]).

---

## 6. What Remains Too Coupled

- **SchedulingService and TimeSlotManager** still use Prisma (task.update, task.findMany) and optionally useSettingsStore. The facade works around this by creating real DB tasks and passing settings/timezone explicitly. For true extraction, we need a task writer callback and a scheduled-task source interface.
- **CalendarServiceImpl** is tied to Prisma CalendarEvent and Task. An alternative implementation that takes events from the request (or an external API) is not built.

---

## 7. Should We Continue Investing?

**Yes, with conditions.**

- **Continue if:** Project Ops needs automatic task-to-calendar scheduling and the 7-factor heuristic is acceptable. Invest in (1) abstraction of task writer and event source, (2) tests for timezone and overlap, (3) fixing B2 and B7.
- **Pause or reduce if:** Project Ops can defer scheduling; use the PoC only for internal validation and keep Option D (reference) as the fallback.

---

## 8. Recommended Direction (Choose One)

| Option | When to choose |
|--------|-----------------|
| **Abandon FluidCalendar** | Not recommended; the algorithm and PoC are useful. |
| **Fork and harden** | Choose if we want to own the FC codebase, fix bugs (B2, B8, B9), and keep the full app plus schedule API. |
| **Extract scheduler logic** | Choose for Option C: extract to package or microservice; Project Ops (and optionally FC) call it. |
| **Use as sidecar only** | Choose for Option A: deploy FC on Railway; Project Ops calls its schedule API; no extraction. |
| **Rebuild scheduler in Project Ops** | Choose for Option D (reference): reimplement from FC’s design; no FC dependency. |

**Recommendation:** **Extract scheduler logic** (Option C) as the next build path, with **sidecar** (Option A) as a valid short-term deployment if we need a production integration before extraction is done.

---

## 9. Concrete Next 10 Engineering Steps

1. **Add request DTO validation** — Zod schema for ProjectOpsScheduleRequest; return 400 with details for invalid payloads.
2. **Add timezone integration test** — Send request with America/New_York; assert returned slot times are in local 9–17.
3. **Add overlap test** — Create a calendar event in FC; run schedule with that calendar in selectedCalendars; assert no slot overlaps the event.
4. **Implement event source adapter** — CalendarService implementation that returns events from request.conflictWindows so Project Ops can supply conflicts without FC calendar DB.
5. **Harden server path (B7)** — In SchedulingService, require settings (and timezone) when called from API/facade; remove or restrict useSettingsStore fallback.
6. **Fix overlap bug (B2)** — Reproduce; fix slot/event boundary logic or batch conflict handling; add test.
7. **Document API** — OpenAPI or markdown for POST /api/projectops/schedule (request/response, auth).
8. **Decide production auth** — How Project Ops (or other callers) will authenticate to the schedule API in production (API key, internal network, same session).
9. **Extract or not** — If proceeding with Option C: introduce TaskWriter and EventSource interfaces; refactor SchedulingService/TimeSlotManager to use them; then move scheduler to package or service. If not, keep PoC in FC and use as sidecar (Option A).
10. **Update HANDOFF and runbooks** — Document how to run the PoC, run tests, and deploy FC for Project Ops testing (see docs/project-ops-sample-payloads.md and docs/project-ops-hosting-strategy.md).
