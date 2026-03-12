# Calendar Writeback Readiness

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (principal software architect)
**Scope:** Assess whether any calendar writeback capability exists, and what must be true before it can be enabled.

---

## 1. Current State: No Writeback Exists

**Writeback maturity level: NONE.**

The scheduler produces scheduling results as data only. Specifically:

1. The `schedulerFacade.ts` creates **temporary DB tasks**, runs the scheduler, extracts start/end/score from those tasks, maps them to `TaskScheduleResult[]`, and then **deletes the temporary tasks** in a `finally` block.

2. The `TaskScheduleResult` type includes a `calendarWriteback` field (`"pending" | "success" | "failed" | "skipped"`), but this field is **never set anywhere in the codebase**. It exists only as a type definition in `src/lib/projectops/types.ts:61`.

3. No code path creates, updates, or deletes calendar events based on scheduling results. The Google Calendar, Outlook Calendar, and CalDAV APIs are used exclusively for reading events (sync and conflict checking), not for writing scheduling results back.

4. The `ConflictWindowsCalendarService` is purely in-memory — it takes busy periods from the request and uses them for overlap detection. It has no write capability.

5. The `CalendarServiceImpl` queries the database for existing events and tasks for conflict checking. It has no write methods.

---

## 2. What the Scheduler Actually Persists

During a scheduling run via the Project Ops facade:

1. **Creates** temporary tasks in Prisma (`prisma.task.create`)
2. **Updates** those temporary tasks with scheduled slots (`taskWriter.updateScheduledSlot` → `prisma.task.update`)
3. **Reads** the final state back (`taskWriter.fetchTasks`)
4. **Deletes** all temporary tasks (`prisma.task.deleteMany`)

The net database state change after a successful run is **zero**. All temporary artifacts are cleaned up.

For the FC-native path (`/api/tasks/schedule-all`), `TaskSchedulingService` schedules the user's real tasks — it updates `scheduledStart`, `scheduledEnd`, `scheduleScore` on actual Task records. This is FC-internal behavior, not Project Ops writeback.

---

## 3. Auth Assessment for Writeback

The route currently uses `authenticateRequest()` which validates a NextAuth session JWT. This is:
- **Sufficient for**: manual developer testing, single-user internal use
- **Insufficient for**: service-to-service calls from Project Ops, automated scheduling

The `docs/project-ops-auth-strategy.md` documents HMAC service token and API key approaches but **no code exists** for either. The route has no rate limiting, no request signing, no IP allowlist.

---

## 4. Audit Logging Assessment

The facade logs errors via `logger.error()` with `LOG_SOURCE = "projectops-schedulerFacade"`. The route logs errors with `LOG_SOURCE = "projectops-schedule-route"`. The `SchedulingService` logs debug metrics.

**Missing:**
- No structured audit trail of what was scheduled, when, for whom
- No request ID tracking through the full pipeline (it's passed through but not logged at every stage)
- No recording of scheduling decisions (why task X got slot Y instead of Z)
- No logging of validation failures at the route level (only returned as JSON)

---

## 5. What Must Be True Before Calendar Writeback

### Hard prerequisites (ALL required):

**P1: Input validation hardening.** Items 1-5 from the hardening verification must be implemented (min duration, max tasks, slot cap, IANA validation, work-hours cross-validation). Without these, writeback would persist results from unvalidated inputs.

**P2: Full-pipeline tests proving correctness.** At minimum: 3 tasks + 2 conflict windows → verify all 3 scheduled without overlap, within work hours, in correct timezone. Without this, writeback persists results from an unverified engine.

**P3: Writeback provider interface.** A `WritebackProvider` interface that:
- Creates calendar events from scheduling results
- Reports success/failure per event
- Supports rollback (delete created events on failure)
- Is injectable like CalendarService (allows no-op/dry-run/real providers)

**P4: Idempotency or explicit non-idempotency.** The scheduler uses `newDate()` throughout scoring, which means results vary second-by-second. For writeback, either freeze the reference time at request start, or explicitly document and handle non-idempotency.

**P5: Partial failure handling.** If 5 events are created but the 6th fails, the system must either: delete the first 5 (rollback), mark them as "partial", or leave them with an audit trail. Silent partial writeback is unacceptable.

**P6: Production auth.** HMAC service token or API key auth, per the documented strategy. Writeback from unauthenticated or session-only sources is unacceptable.

**P7: Rate limiting.** At minimum: 1 writeback-capable request per user per minute. A runaway client loop could create hundreds of calendar events.

**P8: Eliminate temp-task pattern.** For writeback, creating/deleting temporary tasks is a concurrency hazard (temp tasks visible to simultaneous queries, partial cleanup on crash). The scheduler must operate on in-memory task representations only.

**P9: Audit logging.** Every writeback attempt must log: requestId, userId, taskId, calendarProvider, eventId, success/failure, timestamp. Must be queryable for debugging.

### Soft prerequisites (recommended before scaling):

**P10: Request timeout.** Wrap the scheduling call in `Promise.race` with 10-30 second deadline.

**P11: Concurrent request protection.** Per-user mutex or queue to prevent overlapping scheduling runs.

---

## 6. Current Safe Usage Boundary

| Usage Pattern | Safe? |
| --- | --- |
| Developer manually calls API, reviews JSON response | **Yes** |
| Project Ops displays scheduling proposals in UI for human review | **Yes** (once hardening items 1-5 done) |
| Automated system calls API on a schedule, logs results | **No** — no rate limiting, no auth, no timeout |
| Any path that creates calendar events from results | **No** — no writeback code exists |
| Any path that persists scheduling decisions permanently | **No** — temp tasks are deleted |

---

## 7. Summary

The scheduler is strictly a **proposal engine**. It generates scheduling suggestions as JSON data. No writeback capability exists in code — not even a stub. The `calendarWriteback` field in the response type is defined but never populated. Calendar APIs are read-only.

Before any writeback can be built, 9 hard prerequisites and 2 soft prerequisites must be met. This is estimated at 2-3 weeks of engineering work. The current system is correctly positioned as dry-run-only.
