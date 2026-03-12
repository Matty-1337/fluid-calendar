# Native Scheduler — Internal Route Readiness Assessment

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (principal software architect)
**Scope:** Determine whether the scheduler is ready for internal route integration in Project Ops, what blocks trusted use, and what must exist before any automatic calendar writeback.
**Prior art:** `docs/claude-native-scheduler-mvp-verdict.md` (same date) identified 7 minimum actions. This doc evaluates whether those actions were completed.

---

## 1. Executive Assessment

**The hardening phase has not been executed. The code is unchanged since the MVP verdict was written.**

Every file in `src/services/scheduling/` and `src/lib/projectops/` is byte-identical to its state at the time `claude-native-scheduler-mvp-verdict.md` was created. The 7 minimum actions identified in that verdict — minimum duration validation, max task count, slot generation cap, SlotScorer tests, slot generation tests, integration test, IANA timezone validation — are all still pending. Zero of seven have been implemented.

**The scheduler is NOT ready for internal route integration.** It is ready for manual dry-run testing by a developer who understands the constraints. It is not ready for any automated integration, any route that Project Ops code calls programmatically, or any path that writes results to a calendar.

---

## 2. Evidence: No Code Changes Since MVP Verdict

I verified every file against the state described in the MVP verdict and the change log:

| File | Last meaningful change | Changed since verdict? |
|------|----------------------|----------------------|
| `validation.ts` | PoC phase (step 1) | **No** — still allows `estimatedMinutes: 1`, no max tasks, no IANA check |
| `TimeSlotManager.ts` | B7 hardening (useSettingsStore removal) | **No** — `generatePotentialSlots` still has no slot cap |
| `SchedulingService.ts` | TaskWriter injection (step 9) | **No** — still double-scores every task |
| `SlotScorer.ts` | Original FC code | **No** — zero test files exist for it |
| `CalendarServiceImpl.ts` | Original FC code | **No** — cache still has no invalidation |
| `InMemoryTaskWriter.ts` | Post-verdict refactor | **No** — created during that session, unchanged |
| `types.ts` (scheduling) | Post-verdict refactor | **No** — created during that session, unchanged |

The change log confirms: the most recent code entries are "Post-Verdict Refactors" (SchedulerTask/SchedulerSettings types and InMemoryTaskWriter). These were documentation/abstraction changes, not hardening.

---

## 3. Guardrail Status — 7 Minimum Actions

From `claude-native-scheduler-mvp-verdict.md` section 9:

| # | Action | Status | Evidence |
|---|--------|--------|----------|
| 1 | Add `estimatedMinutes` minimum of 5 in Zod schema | **NOT DONE** | `validation.ts:24` — `z.number().int().positive()` allows 1 |
| 2 | Add `tasks` array max of 100 in Zod schema | **NOT DONE** | `validation.ts:71` — `.min(1)` only, no `.max()` |
| 3 | Add hard slot cap in `generatePotentialSlots` | **NOT DONE** | `TimeSlotManager.ts:267-281` — unbounded while loop |
| 4 | Add 5 SlotScorer unit tests | **NOT DONE** | No test file exists for SlotScorer |
| 5 | Add 3 slot generation tests | **NOT DONE** | No test file exists for TimeSlotManager |
| 6 | Add 1 full-pipeline integration test | **NOT DONE** | No test exercises SchedulingService with real slot generation |
| 7 | Add IANA timezone validation | **NOT DONE** | `validation.ts:69` — `z.string().min(1)` only |

**Completion: 0 of 7.**

---

## 4. Runaway Computation Risk — Unchanged

The risks identified in the MVP verdict are still present and unmitigated:

### 4.1 Slot generation blowup

`TimeSlotManager.generatePotentialSlots()` (line 267):
```typescript
while (localCurrentStart < localEndDate) {
    slots.push(slot);
    localCurrentStart = addMinutes(localCurrentStart, duration);
}
```

A request with `estimatedMinutes: 1` and the default 7-day window generates **10,080 slot objects** (7 × 24 × 60). With batch size 8, that's 80,640 slots in memory. Each slot is ~200 bytes = ~15.7 MB peak allocation.

This is worse than it first appears because of the double-scoring design in `SchedulingService.scheduleMultipleTasks()`:
- **Pass 1** (lines 148–176): `findAvailableSlots()` for every task to compute initial scores for sort ordering
- **Pass 2** (lines 258–263 in `scheduleTask`): `findAvailableSlots()` again to pick the actual slot

Total slot generations per scheduling run: **2N** (where N = number of tasks). For 100 tasks with 1-minute duration: 2 × 100 × 10,080 = **2,016,000 slot objects created**.

### 4.2 No request-level timeout

The `/api/projectops/schedule` route has no timeout. A sufficiently large request (many tasks × small durations) can block the Next.js server thread indefinitely. There is no `AbortController`, no deadline, no early termination.

### 4.3 No concurrent request protection

Nothing prevents two simultaneous schedule requests from running. Both create temp tasks visible to each other's CalendarServiceImpl (which queries `prisma.task.findMany` for ALL scheduled tasks). The conflict landscape is polluted.

---

## 5. Engine Design — Unchanged, Assessment Stands

### SlotScorer: Clean, no changes needed for internal use

All 7 scoring functions are pure, bounded, and produce deterministic results for the same inputs. The weighted average normalization is correct. No bugs found. The only issue is zero test coverage — you're trusting formulas that have never been verified with known inputs.

### TimeSlotManager: Functional but unguarded

The slot generation → filter → conflict check → score → sort pipeline is logically correct. The B7 hardening (useSettingsStore removal) is in place. The remaining issues:

1. **`updateScheduledTasks()` (line 71)** — Direct `prisma.task.findMany`. For the ConflictWindowsCalendarService path (Project Ops), this still fires on the first call per run (`slotScorer.getScheduledTasks().size === 0` at line 94). It loads ALL scheduled tasks for the user from FC's database. If this user has no FC tasks, it returns empty and is harmless. But if the same userId has tasks in FC, those tasks pollute the project-proximity scoring.

2. **`filterByWorkHours` calls `parseWorkDays` on every slot** (line 296). For 10,080 slots, that's 10,080 `JSON.parse()` calls on the same string. Not a bug, but wasteful. The work-hour filtering should parse once and close over the result.

### SchedulingService: Adequate orchestration, double-scoring inefficiency

The batch-size-8, greedy-assign pattern is correct for the use case. The `settings-required` throw (line 102) is the right behavior. The CalendarService and TaskWriter injections work.

The double `findAvailableSlots` per task remains the main performance concern. For internal dry-run use with <20 tasks and 30-minute durations, this costs ~5K slot objects total — fine. For any automated use that might see 50+ tasks or <15-minute durations, it becomes the bottleneck.

### Metrics/Logger Design: Functional but not production-grade

`logMetrics()` (lines 61–92) stringifies the entire operation array into a single `logger.debug` call:
```typescript
operations: JSON.stringify(this.metrics.map(...))
```

This produces a single log line with nested JSON. For debugging locally, it works. For production observability (Datadog, CloudWatch, etc.), it's unusable — you can't query individual operation durations, you can't alert on slow slot generation, you can't build dashboards.

**The metric collection itself is well-designed** — `startMetric`/`endMetric` with operation names and metadata is the right pattern. The problem is only in the output. For internal use, this is fine. For production, replace `logMetrics()` with structured metric emission.

---

## 6. Test Suite — No Change, Critical Gaps Remain

### Current: 42 tests across 5 files, all passing

| File | Tests | Covers |
|------|-------|--------|
| `validation.test.ts` | 11 | Zod schema accept/reject |
| `mappers.test.ts` | 4 | DTO mapping with defaults |
| `schedulerFacade.test.ts` | 5 | Facade flow with mocked scheduler |
| `ConflictWindowsCalendarService.test.ts` | 14 | Overlap boundary semantics |
| `InMemoryTaskWriter.test.ts` | 8 | TaskWriter abstraction CRUD |

### Still missing (same gaps as MVP verdict):

**Zero SlotScorer tests.** The core business logic — the 7 formulas that determine where every task gets placed — has never been tested. If `scoreDeadlineProximity` has a sign error (e.g., tasks with deadlines tomorrow score LOWER than tasks with no deadline), nobody would know until a user reports bad scheduling.

**Zero slot generation tests.** If `generatePotentialSlots` generates slots outside work hours in a specific timezone, or if `roundDateUp` introduces an off-by-one slot, nobody would know.

**Zero full-pipeline tests.** Nobody has ever tested: "Given these 3 tasks and these 2 busy windows, does the scheduler place all 3 without overlapping?" The facade tests mock `SchedulingService` entirely. The ConflictWindowsCalendarService tests only verify overlap detection in isolation. The gap between unit tests and the integrated behavior is total.

---

## 7. Should the Next Step Be Dry-Run Only?

**Yes. Unequivocally.**

The scheduler should be integrated as a dry-run-only endpoint where:
1. Project Ops sends a schedule request
2. The scheduler returns proposed slots
3. Project Ops displays the proposals to the user
4. No calendar events are created, no tasks are moved, no state is mutated

This is safe because:
- The temp-task create/delete happens within the request lifecycle and is invisible to Project Ops
- The response is just data (`ScheduleResult` with per-task slots)
- If the scheduling is wrong (bad timezone, wrong priorities, missed conflicts), the user sees it and can reject it
- No writeback means no damage from incorrect scheduling

This is NOT safe for automatic use because:
- The validation gaps allow pathological inputs (1-min tasks, 10K tasks, invalid timezones)
- The scoring engine is untested — we don't know if it makes correct priority decisions
- The slot generation is untested — we don't know if timezone handling is correct
- The double-scoring + no timeout means a large request could hang the server

---

## 8. What Blocks Trusted Internal Use

"Trusted internal use" means: a Project Ops backend route calls the scheduler programmatically, without a developer manually reviewing every request/response.

### Hard blockers (must fix):

1. **Minimum duration validation.** Add `.min(5)` to `estimatedMinutes` in Zod schema. Without this, any client-side bug that sends `estimatedMinutes: 0` or `estimatedMinutes: 1` causes runaway slot generation. **One line change.**

2. **Max task count.** Add `.max(100)` to the `tasks` array in Zod schema. Without this, a malformed request with thousands of tasks causes sequential DB writes + scheduling that could take minutes. **One line change.**

3. **Slot generation cap.** Add `if (slots.length >= MAX_SLOTS) break;` to the while loop in `generatePotentialSlots`. Defense in depth even after duration validation. **Two lines.**

4. **IANA timezone validation.** Replace `z.string().min(1)` with a custom refine that calls `Intl.DateTimeFormat(undefined, { timeZone: val })` in a try/catch. Invalid timezones cause `date-fns-tz` to produce incorrect dates silently or throw depending on the version. **Five lines.**

5. **At least 3 SlotScorer tests.** Verify: HIGH priority > LOW priority; overdue task scores > 1.0; energy match scores 1.0 for exact match. Without these, we're trusting untested math to make scheduling decisions. **~30 lines.**

### Soft blockers (should fix before scaling):

6. **Request timeout.** Wrap the facade call in a `Promise.race` with a 10-second deadline. If the scheduler takes >10s, return 504 with partial results or an error.

7. **`workHourStart < workHourEnd` validation.** Prevent the "zero slots" silent failure when work hours are inverted.

8. **Full pipeline integration test.** 3 tasks + 2 busy windows + InMemoryTaskWriter + ConflictWindowsCalendarService → verify all 3 scheduled without overlap. This is the single test that proves the engine works end-to-end.

---

## 9. What Must Exist Before Calendar Writeback

Calendar writeback means: the scheduler's output is automatically used to create or update calendar events (Google Calendar, Outlook, CalDAV) without human review.

This is the highest-risk operation because incorrect scheduling creates visible, real-world consequences — double-booked meetings, tasks placed at 3am, events created in the wrong timezone.

### Prerequisites for writeback (ALL must be met):

**P1: All hard blockers from section 8 resolved.**
Self-explanatory. You cannot write back scheduling results from an engine whose inputs aren't validated and whose scoring logic is untested.

**P2: Timezone correctness verified by test.**
At minimum: given timezone "America/New_York", workHours 9-17, verify that ALL scheduled slots have local start times between 9:00 and 17:00 ET. This is the single most dangerous failure mode — a timezone bug schedules tasks at 3am or during someone else's work hours.

**P3: Conflict integrity verified by test.**
Given 3 tasks and 2 busy windows, verify that NO scheduled task overlaps ANY busy window AND no two scheduled tasks overlap each other. This proves the conflict-checking pipeline works end-to-end, not just in isolation.

**P4: Idempotency guarantee.**
Running the same request twice must produce the same results (or explicitly different results if other tasks were scheduled in between). Currently, `newDate()` is called inside the scoring engine, which means scores change second-by-second. For writeback, either freeze the reference time at request start, or accept non-idempotency and document it.

**P5: Writeback-specific error handling.**
If the scheduler places a task at 10am but the Google Calendar API rejects the event (quota exceeded, token expired, calendar deleted), the system must NOT silently lose the scheduling decision. It must either retry, mark the task as "schedule pending writeback", or surface the failure to the user.

**P6: Rollback capability.**
If writeback creates 5 calendar events and then fails on the 6th, can the system delete the first 5? If not, partial writeback must be documented and surfaced. Half-written schedules are worse than no schedule.

**P7: Auth for server-to-server.**
The route currently uses NextAuth session auth. For automated writeback from Project Ops, HMAC service token or API key auth must be implemented. The auth strategy document exists (`docs/project-ops-auth-strategy.md`) but no code exists.

**P8: The temp-task pattern must be eliminated.**
For dry-run, creating and deleting temp tasks is acceptable (the tasks are invisible to users). For writeback, the scheduler must NOT create temporary tasks in the database — the writeback flow would need to distinguish between "real" tasks and "temp scheduling artifacts", and the concurrency hazards become production bugs.

**P9: Rate limiting.**
Without rate limiting, a runaway client can call the writeback endpoint in a loop, creating hundreds of calendar events. Basic rate limiting (e.g., 1 schedule-with-writeback per user per minute) is necessary.

---

## 10. Recommended Integration Path

### Phase 1: Dry-run endpoint (NOW — requires items 1-4 from section 8)

Add the 4 validation fixes (min duration, max tasks, slot cap, IANA check). This takes <30 minutes. Then expose the existing `/api/projectops/schedule` as a dry-run endpoint that Project Ops can call to get scheduling proposals. No writeback.

### Phase 2: Trusted dry-run (requires items 5-8 from section 8)

Add SlotScorer tests, pipeline integration test, request timeout, workHour validation. This proves the engine makes correct decisions. Project Ops can now use the results programmatically (e.g., pre-populate a suggested schedule in the UI) with confidence that the proposals are reasonable.

### Phase 3: Calendar writeback (requires P1-P9 from section 9)

Full writeback requires auth, rollback, error handling, rate limiting, and eliminating the temp-task pattern. This is a significant engineering effort — likely 2-3 weeks — and should only begin after Phase 2 is stable and the scheduling quality has been validated with real users reviewing dry-run proposals.

---

## 11. Summary

| Question | Answer |
|----------|--------|
| Is the engine safe for internal route integration? | **No.** Validation gaps allow pathological inputs. |
| Do guardrails meaningfully reduce runaway risk? | **No guardrails were added.** The 7 minimum actions are 0/7 complete. |
| Is the metrics/logger design clean? | **Adequate for debug, not for production.** Collection is good, output is a JSON blob. |
| Is the orchestrator appropriate for v1? | **Yes, for <50 tasks with 15+ min durations.** Double-scoring is inefficient but correct. |
| Should the next step be dry-run only? | **Yes.** No writeback until validation, tests, and auth are in place. |
| What blocks trusted internal use? | **4 validation fixes + 3 SlotScorer tests** = minimum. ~1 hour of work. |
| What blocks calendar writeback? | **9 prerequisites** including auth, rollback, rate limiting, temp-task elimination. ~2-3 weeks. |

---

## 12. Verification Evidence (2026-03-07)

This section was added after a challenge to verify whether the review was based on the correct, current code state.

### 12.1 Branch and Commit

- **Branch:** `main`
- **Latest commit:** `b5c0f2b claude: add repo intelligence layer`
- **No other branches** contain scheduler changes.

### 12.2 File Location Verification

The scheduler code lives at **`src/services/scheduling/`** and **`src/lib/projectops/`**. The path `src/lib/scheduler/` **does not exist** in this repository. All 11 files listed below were checked and confirmed missing:

| File path checked | Exists? |
| --- | --- |
| `src/lib/scheduler/validation.ts` | **No** — does not exist. Validation is at `src/lib/projectops/validation.ts` |
| `src/lib/scheduler/TimeSlotManager.ts` | **No** — actual path: `src/services/scheduling/TimeSlotManager.ts` |
| `src/lib/scheduler/SchedulingService.ts` | **No** — actual path: `src/services/scheduling/SchedulingService.ts` |
| `src/lib/scheduler/SlotScorer.ts` | **No** — actual path: `src/services/scheduling/SlotScorer.ts` |
| `src/lib/scheduler/CalendarServiceImpl.ts` | **No** — actual path: `src/services/scheduling/CalendarServiceImpl.ts` |
| `src/lib/scheduler/types.ts` | **No** — actual path: `src/services/scheduling/types.ts` |
| `src/lib/scheduler/InMemoryTaskWriter.ts` | **No** — actual path: `src/services/scheduling/InMemoryTaskWriter.ts` |
| `src/lib/scheduler/TaskWriter.ts` | **No** — actual path: `src/services/scheduling/TaskWriter.ts` |
| `src/lib/scheduler/__tests__/SlotScorer.test.ts` | **No** — no SlotScorer tests exist anywhere |
| `src/lib/scheduler/__tests__/TimeSlotManager.test.ts` | **No** — no TimeSlotManager tests exist anywhere |
| `src/lib/scheduler/__tests__/pipeline.integration.test.ts` | **No** — no pipeline integration test exists anywhere |

### 12.3 Guardrail Code Grep Results

Searched the entire codebase for evidence of hardening code. Results:

| Pattern searched | Found in scheduler code? | Evidence |
| --- | --- | --- |
| `.min(5` (min duration) | **No** | `validation.ts:24` has `z.number().int().positive()` — allows 1 |
| `.max(100` (max tasks) | **No** | `validation.ts:71` has `.min(1)` only |
| `MAX_SLOTS` (slot cap) | **No** | `TimeSlotManager.ts:267` has unbounded `while` loop |
| `IANA` or `supportedValuesOf` (timezone validation) | **No** | `validation.ts:69` has `z.string().min(1)` only |
| `guardrail` (any reference) | **No** | Zero matches in scheduler files |

### 12.4 Conclusion

**The previous verdict was based on the correct, current code state.** The review examined the actual files at their actual paths (`src/services/scheduling/` and `src/lib/projectops/`). No hardening code exists anywhere in the repository. The 7 minimum actions from the MVP verdict remain 0/7 complete. The assessment that the scheduler is not ready for internal route integration stands as written.
