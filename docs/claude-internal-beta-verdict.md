# Internal Beta Verdict — Project Ops Scheduler

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (principal software architect)
**Scope:** Determine whether the scheduler is ready for internal beta with manual human review, dry-run use on real Project Ops payloads, and scoring feedback collection. Writeback is explicitly out of scope.

---

## 1. Readiness Verdict

**Ready for internal beta with manual human review — conditionally.**

The scheduler can be used to generate scheduling proposals for real Project Ops task payloads, provided:
- A human reviews every scheduling result before acting on it
- The beta operates as dry-run only (no calendar events created, no persistent state)
- Results are treated as suggestions, not commitments
- Feedback on scheduling quality is collected and reviewed

The conditions exist because the scoring engine has zero direct tests. The input guardrails and integration plumbing are solid. The scoring math is readable and appears correct on inspection. But "appears correct on inspection" is not the same as "proven correct by test," and the difference matters when scheduling decisions affect someone's workday.

---

## 2. What Supports This Verdict

### 2.1 Input validation is strong

**File:** `src/lib/projectops/validation.ts`

| Guardrail | Evidence | Status |
| --- | --- | --- |
| Min task duration | Line 27: `.min(5, "estimatedMinutes must be at least 5")` | Done |
| Max task duration | Line 28: `.max(480, "estimatedMinutes must be at most 480")` | Done |
| Max task count | Line 92: `.max(50, "at most 50 tasks per request")` | Done |
| IANA timezone | Lines 78-85: `.refine()` with `Intl.DateTimeFormat` try/catch | Done |
| Enum validation | Priority, status, energyLevel, preferredTime — all constrained | Done |
| Datetime format | All date fields use `z.string().datetime({ offset: true })` | Done |

19 validation tests pass (12 original + 7 hardening boundary tests).

### 2.2 Slot generation is capped

**File:** `src/services/scheduling/TimeSlotManager.ts:267-269`

```typescript
const MAX_SLOTS = 5000;
while (localCurrentStart < localEndDate) {
  if (slots.length >= MAX_SLOTS) break;
```

With `estimatedMinutes >= 5` and a 7-day window, worst case is `7 × 24 × 60 / 5 = 2,016` slots — well under the 5,000 cap. The cap is defense-in-depth against any bypass of the validation layer.

### 2.3 Conflict detection is thoroughly tested

**File:** `src/lib/projectops/__tests__/ConflictWindowsCalendarService.test.ts` — 14 tests

Boundary semantics are precisely verified:
- Exact match = conflict (line 122-130)
- Inside window = conflict (line 132-140)
- Adjacent touching = no conflict (lines 142-152, 154-163)
- 1-minute overlap = conflict (line 165-174)
- Batch boundary behavior verified (lines 176-234)

This is the most thoroughly tested component. Conflict detection correctness is high-confidence.

### 2.4 Facade orchestration is tested and safe

**File:** `src/lib/projectops/__tests__/schedulerFacade.test.ts` — 5 tests

- Temp task creation → scheduling → cleanup cycle works (line 70-133)
- `finally` block guarantees cleanup even on scheduler error (lines 135-158)
- Multi-task result mapping with `externalTaskId` correlation works (lines 160-204)
- Net database state change: zero (temp tasks always deleted)

### 2.5 The scoring math is readable and directionally correct

I performed a manual review of every scoring function in `SlotScorer.ts`:

| Function | Formula | Direction check |
| --- | --- | --- |
| `scorePriority` (line 192) | HIGH=1.0, MEDIUM=0.75, LOW=0.5, NONE=0.25 | Correct — higher priority = higher score |
| `scoreDeadlineProximity` (line 126) | Overdue: 1.0-2.0 based on days overdue, with time penalty for later slots. Future: exponential decay toward deadline. | Correct — overdue tasks score higher (1.0+), scores decrease for slots further from now |
| `scoreEnergyLevelMatch` (line 80) | Exact match=1.0, adjacent=0.5, opposite=0 | Correct — distance-based matching |
| `scoreTimePreference` (line 105) | Morning 5-12, afternoon 12-17, evening 17-22 → 1.0 if match, 0 if not. No preference → exponential decay favoring earlier. | Correct |
| `scoreWorkHourAlignment` (line 76) | Within work hours = 1, outside = 0 | Correct |
| `scoreBufferAdequacy` (line 100) | Has buffer = 1, no buffer = 0 | Correct (simple, adequate for v1) |
| `scoreProjectProximity` (line 164) | Exponential decay: `exp(-distance/4)`. 1h=0.78, 2h=0.61, 4h=0.37 | Correct — closer same-project tasks score higher |
| Weighted average (line 61-68) | Total weight = 9.8. Weights: deadline 3.0, priority 1.8, energy 1.5, time 1.2, work 1.0, buffer 0.8, proximity 0.5 | Correct — properly normalized |

**No sign errors, no division-by-zero paths, no NaN-producing paths found.** The formulas are mathematically sound. The highest-weight factor (deadline proximity at 3.0) correctly escalates overdue tasks.

One subtlety: `scoreTimePreference` calls `newDate()` for the decay calculation (line 120), which means scores vary second-by-second for tasks without a time preference. This is acceptable for dry-run (results are consumed immediately) but would need freezing for writeback.

### 2.6 Route boundary is clean

**File:** `src/app/api/projectops/schedule/route.ts` — 60 lines

- `authenticateRequest()` enforces NextAuth session
- Zod `safeParse` returns structured 400 errors with field details
- `runProjectOpsSchedule` handles all errors gracefully (500 with error message, not stack trace)
- No side effects beyond temporary DB tasks (cleaned up)

### 2.7 No writeback or automation exists

Verified by grep: zero references to `writeback`, `createEvent`, `insertEvent` in any scheduler file. The `calendarWriteback` field in `TaskScheduleResult` is type-only, never populated.

---

## 3. Remaining Risks

### 3.1 HIGH: Zero SlotScorer tests

The 7 scoring functions appear correct on manual review, but manual review misses edge cases. Specific untested scenarios:

- **Deadline scoring with `dueDate` exactly equal to `now`:** `minutesOverdue = 0`, takes the `if (minutesOverdue > 0)` false branch. Falls to future task formula: `differenceInMinutes(dueDate, slot.start)` is negative for any future slot → `daysToDeadline` is negative → `exp(-negative/3)` → score approaches `exp(+infinity)` → capped at 0.99 by `Math.min`. This is correct but non-obvious. A test should verify it.

- **Energy level with invalid string:** If a task has `energyLevel: "HIGH"` (uppercase), `energyLevels.indexOf("HIGH")` returns -1. Distance between -1 and any valid index is ≥1, so it returns 0.5 or 0. Not a crash, but silently wrong. The Zod schema constrains to lowercase enums, so this can't happen through the Project Ops route — but could happen through the FC-native path.

### 3.2 HIGH: Zero TimeSlotManager tests

The slot generation pipeline has complex timezone handling. Specific untested scenarios:

- **DST transition:** A slot generated during a DST spring-forward might skip an hour or double-count an hour. `toZonedTime` should handle this, but it's never been verified.
- **Work-hour boundary at slot end:** `filterByWorkHours` checks `endHour <= workHourEnd`. A 30-minute task starting at 16:30 with `workHourEnd: 17` → `endHour = 17` → `17 <= 17` → passes. Correct. But a 60-minute task starting at 16:30 → `endHour = 17.5`? No — `getHours()` returns 17, the minutes are lost. `17 <= 17` passes. The task ends at 17:30, outside work hours, but is marked as within. This is a real bug for tasks with durations that cross the work-hour boundary at non-hour-aligned times.

### 3.3 MEDIUM: Zero full-pipeline integration tests

No test proves that 3 tasks + 2 conflict windows → all 3 scheduled without overlap. The conflict detection is tested in isolation, and the facade is tested with mocks, but the integration is unverified.

### 3.4 MEDIUM: Double-scoring performance

`findAvailableSlots` is called twice per task (sort pass in `scheduleMultipleTasks` lines 156-161, then assign pass in `scheduleTask` lines 258-263). For 50 tasks with 5-minute durations: `50 × 2 × 2,016 = 201,600` slot objects. At ~200 bytes each: ~40 MB. Won't crash, but may cause 5-10 second response times.

### 3.5 MEDIUM: TimeSlotManager Prisma coupling

`TimeSlotManager.ts:71` calls `prisma.task.findMany()` directly to load existing scheduled tasks for project-proximity scoring. In the Project Ops path, this fires once per scheduling run (line 94: `if size === 0`). If the userId has no FC tasks, it returns empty and is harmless. But the direct Prisma import means the scheduler cannot run without a database connection, even when using InMemoryTaskWriter and ConflictWindowsCalendarService.

### 3.6 LOW: Temp task leak on process crash

If the Node.js process crashes between `prisma.task.create()` and the `finally` cleanup, orphaned `isAutoScheduled: true` tasks remain in the database. For dry-run beta this is low risk — the tasks are functionally invisible (no UI shows them). For production, a cleanup job would be needed.

### 3.7 LOW: No request timeout

No `Promise.race`, no `AbortController`. A pathological-but-valid request (50 tasks × 5 minutes × 7 days = 50 × 2,016 × 2 = 201,600 slot generations) could take 10+ seconds. For internal beta this is acceptable. For production, a 15-second timeout is needed.

### 3.8 LOW: All work is uncommitted

Everything exists only in the local working tree. `git checkout .` would erase it. This is a risk to the work itself, not to users, but it must be resolved before any beta begins.

---

## 4. What to Monitor During Internal Beta

### 4.1 Scheduling quality signals

For each scheduling run, capture and review:

| Signal | What to look for | Red flag |
| --- | --- | --- |
| **Priority ordering** | HIGH-priority tasks scheduled before LOW-priority tasks | Reversed ordering across multiple runs |
| **Deadline adherence** | Overdue tasks scheduled in earliest available slots | Overdue task placed later than a future task |
| **Work-hour compliance** | All scheduled slots within configured work hours | Any slot starting before `workHourStart` or ending after `workHourEnd` |
| **Conflict avoidance** | No scheduled task overlaps a provided conflict window | Any overlap with a conflict window |
| **No self-overlap** | No two scheduled tasks overlap each other | Two tasks assigned to the same or overlapping time |
| **Timezone correctness** | Scheduled times make sense in the specified timezone | 3am slots when work hours are 9-17 |
| **Duration match** | `scheduledEnd - scheduledStart` equals `estimatedMinutes` | Duration mismatch |

### 4.2 Performance signals

| Metric | Acceptable | Investigate |
| --- | --- | --- |
| Response time (5 tasks) | < 2 seconds | > 5 seconds |
| Response time (20 tasks) | < 5 seconds | > 10 seconds |
| Response time (50 tasks) | < 15 seconds | > 30 seconds |
| Memory allocation | < 100 MB peak delta | > 200 MB |

The `SchedulingService.logMetrics()` already captures per-operation timing via `logger.debug`. Enable debug logging during beta to collect this data.

### 4.3 Error signals

| Error type | Meaning |
| --- | --- |
| `"no_slots_in_window"` for all tasks | Work hours may be inverted, or conflict windows may cover the entire work week |
| `"scheduler_error"` | Unhandled exception in the engine — investigate immediately |
| `"Failed to delete temporary Project Ops tasks"` | Cleanup failure — temp tasks leaked |
| `"Created task count mismatch"` | DB write partial failure — investigate Prisma connection |

---

## 5. What Evidence Must Be Collected Before Writeback Is Considered

### 5.1 Minimum data volume

At least **50 scheduling runs** with real Project Ops task payloads, reviewed by a human, before writeback is even discussed. This establishes a baseline for scheduling quality.

### 5.2 Quality metrics threshold

Before writeback:

| Metric | Threshold |
| --- | --- |
| Priority ordering correctness | 95%+ of runs place HIGH tasks before LOW tasks |
| Conflict avoidance | 100% — zero overlaps with conflict windows across all runs |
| Self-overlap avoidance | 100% — zero task-on-task overlaps across all runs |
| Work-hour compliance | 100% — zero slots outside configured work hours |
| User satisfaction (manual review) | 80%+ of proposals accepted without modification |

### 5.3 Test coverage threshold

Before writeback, these tests must exist and pass:

| Test category | Minimum | Currently |
| --- | --- | --- |
| SlotScorer unit tests | 5 (priority, deadline, energy, time preference, weighted average) | 0 |
| TimeSlotManager unit tests | 3 (slot count, work-hour filtering, timezone correctness) | 0 |
| Full-pipeline integration test | 1 (3 tasks + 2 conflicts → verify no overlap) | 0 |
| Validation tests | 19 | 19 (done) |
| Conflict detection tests | 14 | 14 (done) |
| Facade/mapper tests | 9 | 9 (done) |
| TaskWriter tests | 8 | 8 (done) |

### 5.4 Infrastructure requirements

Before writeback:
- All scheduler code committed and pushed to Git
- Request timeout implemented (15-second `Promise.race`)
- Production auth (HMAC or API key) for service-to-service calls
- Audit logging (requestId, userId, per-task scheduling decisions)
- Rate limiting (1 writeback-capable request per user per minute)

### 5.5 The work-hour boundary bug must be resolved

Risk 3.2 identified a real issue: `filterByWorkHours` uses `getHours()` which truncates minutes, allowing tasks to end outside work hours when their duration doesn't align with hour boundaries. This must be fixed and tested before writeback, because writeback would persist these incorrect placements.

---

## 6. Conditional Approval Statement

The Project Ops scheduler is approved for **internal beta with manual human review** under these conditions:

1. **Dry-run only.** Every scheduling result is a proposal displayed for human review. No calendar events created, no persistent state beyond the request/response cycle.

2. **Known consumer only.** Only internal Project Ops developers or a controlled internal UI should call the endpoint. No external or third-party access.

3. **Feedback collection mandatory.** Every beta user must report: (a) whether the proposed schedule was reasonable, (b) any specific placements that were wrong, (c) the payload that produced the result.

4. **Quality review at 20 runs.** After 20 scheduling runs with real payloads, the collected feedback must be reviewed. If conflict avoidance or work-hour compliance is <100%, the beta pauses until the issue is fixed.

5. **The work must be committed to Git before beta begins.** 40+ uncommitted files represent unacceptable risk of total data loss.

---

## 7. What This Verdict Does NOT Approve

- Automatic scheduling without human review
- Calendar writeback (not even manual-approval writeback)
- Service-to-service calls from production Project Ops
- Any use that assumes scheduling quality is validated by tests
- Exposing the endpoint to non-internal users
- Running without debug-level logging enabled
