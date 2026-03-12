# Native Scheduler MVP — Architecture Verdict

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (principal software architect)
**Scope:** Strict, evidence-based review of whether the current scheduling engine is MVP-ready for Project Ops, with focus on runaway generation, memory pressure, correctness, guardrails, and test coverage.
**Prior art:** This review builds on `docs/claude-extraction-verdict.md` (same date). That doc recommended Option D (rebuild natively). This doc evaluates the current code as the reference blueprint for that rebuild.

---

## 1. Executive Assessment

**The scheduling algorithm is sound. The orchestration layer is adequate for MVP with guardrails. Two specific code paths can generate runaway slot counts and need hard caps before any production use.**

The 7-factor scoring engine (SlotScorer) is clean, pure, and well-characterized. The greedy batch-and-sort orchestration in SchedulingService is a reasonable heuristic. The ConflictWindowsCalendarService and InMemoryTaskWriter prove the abstraction boundaries work. The test suite covers the adapter layer well but has a critical gap: zero tests exercise the actual slot generation or scoring path.

The two production-blocking risks are both in TimeSlotManager: unbounded slot generation when task duration is small relative to the scheduling window, and an O(slots x events) conflict-checking loop with no short-circuit limit. Both are quantified below.

---

## 2. Engine Design Review

### 2.1 SlotScorer — CLEAN

**File:** `src/services/scheduling/SlotScorer.ts` (212 lines)
**Verdict:** Pure, well-designed, no risks.

Evidence:
- No side effects, no I/O, no state mutation beyond the `scheduledTasks` map (which is explicitly updated by the caller).
- All 7 scoring functions are bounded: each returns 0.0–1.0 (or 0.0–2.0 for `deadlineProximity` on overdue tasks).
- The weighted average is correctly normalized by total weight sum (9.8), so `scoreSlot()` always returns a finite number in a predictable range.
- The `timePreference` decay function uses `Math.exp(-(ln2/7) * days)` — decays to 0.5 at 7 days. Correct, stable, no edge-case blow-up.
- The `deadlineProximity` overdue escalation caps at 2.0 (`Math.min(maxOverdueScore, ...)`). No runaway.

**One nit:** `scorePriority()` (line 192) checks `task.priority === Priority.NONE` using the enum from `@/types/task`, but the Prisma Task stores priority as a string. This works because `Priority.NONE === "none"` and the Prisma value is `"none"`. But if any caller passes a different casing or value, the default branch returns 0.25 silently — no error, just a quiet degradation. For the MVP this is fine.

### 2.2 TimeSlotManager — HAS RISKS

**File:** `src/services/scheduling/TimeSlotManager.ts` (465 lines)
**Verdict:** Core logic is correct but has two unbounded loops.

#### Risk 1: Unbounded slot generation (CRITICAL)

`generatePotentialSlots()` (lines 222–284) generates slots at `duration`-minute intervals from `startDate` to `endDate`:

```
while (localCurrentStart < localEndDate) {
    slots.push(slot);
    localCurrentStart = addMinutes(localCurrentStart, duration);
}
```

**The math:** With a 7-day window (default) and the default 30-minute duration:
- Work hours 9–17 = 8 hours/day × 5 work days = 40 hours = 80 slots (fine)
- But `generatePotentialSlots` runs BEFORE `filterByWorkHours`. It generates slots for ALL hours of ALL days in the window.
- 7 days × 24 hours × (60/30) = **336 slots** generated, then ~80 survive filtering.

Now consider a 15-minute task over a 7-day window:
- 7 × 24 × 4 = **672 slots** generated, ~160 survive.

Or a 5-minute task (which the validation schema allows — `estimatedMinutes: z.number().int().positive()`):
- 7 × 24 × 12 = **2,016 slots** generated.

**With no duration minimum in validation, a 1-minute task over 7 days generates 10,080 slot objects.** Each slot is 7 fields (~200 bytes). That's ~2MB for one task. With 8 tasks in a batch, that's 80,640 slots in memory simultaneously.

**Worse:** if the window-escalation pattern in SchedulingService were re-enabled (the commented-out 14-day and 30-day windows at lines 139–141), a 1-minute task over 30 days would generate **43,200 slots**.

**Evidence that this is reachable:** The Zod validation in `validation.ts` line 24 allows `estimatedMinutes: z.number().int().positive()` — minimum 1 minute. The default duration is 30 minutes (mappers.ts line 15), but an explicit `estimatedMinutes: 1` passes validation.

**Mitigation needed:** Hard cap on slot count (e.g., 500) or minimum duration (e.g., 5 minutes) or generate only within work hours from the start.

#### Risk 2: O(slots × conflicts) in removeConflicts

`removeConflicts()` (lines 367–408) calls `calendarService.findBatchConflicts()` which loops over all slots and for each slot loops over all events/tasks. For ConflictWindowsCalendarService, this is O(slots × conflictWindows). For CalendarServiceImpl, it's O(slots × (events + scheduledTasks)).

With 336 slots (normal case) and 50 conflict windows: 16,800 overlap checks. Fine.
With 2,016 slots (5-min task) and 200 conflict windows: 403,200 overlap checks. Still CPU-bounded, no allocation, but takes measurable time.

The `hasInMemoryConflict()` check (lines 348–365) adds another pass: O(slots × projectTasks) per task being scheduled. With 8 tasks and 336 slots each, this is up to 2,688 × projectTasks checks per scheduling run.

**Verdict:** Not dangerous for MVP task counts (<50 tasks, <200 conflicts), but will degrade non-linearly. Add metrics/logging so it's visible.

#### Risk 3: Direct Prisma call (known, documented)

`updateScheduledTasks()` (line 71) calls `prisma.task.findMany` — the one remaining direct DB coupling inside the engine. Already identified in the extraction verdict. For the native rebuild, this must be replaced with injected data.

### 2.3 SchedulingService — ADEQUATE

**File:** `src/services/scheduling/SchedulingService.ts` (310 lines)
**Verdict:** Orchestration is correct for MVP. Two design concerns.

**What works:**
- Batch size of 8 limits concurrency sensibly.
- The sort-by-best-score-then-greedy-assign pattern is a standard scheduling heuristic and is correct for the use case.
- `addScheduledTaskConflict()` correctly prevents double-booking by feeding each scheduled task back as a conflict for subsequent tasks.
- The settings-required throw (line 102) is the correct behavior — no silent fallback.

**Concern 1: Double slot-finding per task.**

`scheduleMultipleTasks()` finds available slots for every task twice:
1. Lines 155–165: `findAvailableSlots()` to calculate `initialScores` (used only for sorting).
2. Lines 258–263 (in `scheduleTask()`): `findAvailableSlots()` again to actually pick the slot.

Both calls generate the same slots, run the same conflict checks, and compute the same scores. For N tasks, this doubles the slot-generation and conflict-checking work. With the 8-task batch, this means 16 `findAvailableSlots()` calls instead of 8.

**Why it matters:** `findAvailableSlots` is the most expensive operation (generates slots, filters, checks conflicts, scores). Doubling it doubles the scheduling time and the peak slot-object count in memory.

**Mitigation:** Cache the first `findAvailableSlots` result per task and reuse in `scheduleTask`. Or compute the initial score from the first result and pass the slots through. Not blocking for MVP (<50 tasks) but becomes the performance bottleneck first.

**Concern 2: The scoring window has stale data on the second pass.**

The initial scoring pass (lines 155–165) runs before any task is scheduled. The second pass (`scheduleTask`) runs after previous tasks have been scheduled and added as conflicts. So the initial scores used for sorting don't account for slot conflicts from higher-priority tasks. The sort order may be suboptimal.

Example: Task A (score 0.9) and Task B (score 0.85) compete for the same 10am slot. A is scheduled first (higher score). B then gets a worse slot. But if B had a hard deadline and A didn't, B's initial score might not reflect the deadline urgency correctly at sort time because the scoring context has changed.

**For MVP:** This is inherent to greedy scheduling. Acceptable. The extraction verdict already notes this as a known limitation (section 11, item 5).

### 2.4 CalendarService Interface — CLEAN

**File:** `src/services/scheduling/CalendarService.ts` (31 lines)
**Verdict:** Good interface design. Three methods, clear contracts, no unnecessary fields.

### 2.5 ConflictWindowsCalendarService — CLEAN WITH ONE COUPLING SMELL

**File:** `src/lib/projectops/ConflictWindowsCalendarService.ts` (138 lines)
**Verdict:** Logic is correct. The Prisma CalendarEvent construction (20+ dummy fields) is ugly but functional.

The overlap detection uses `areIntervalsOverlapping` from date-fns (via date-utils), which uses exclusive boundaries by default. The 14 boundary tests confirm: adjacent intervals (slot.end === window.start) are NOT conflicts. This is correct.

The `findBatchConflicts` returns at most one conflict per slot (early break at line 131). This is a correct optimization — the scheduler only needs to know IF a slot conflicts, not with how many events.

**The smell:** Constructing a full `CalendarEvent` object (lines 33–56) with 20+ null/dummy fields to satisfy the type constraint. For the native rebuild, the CalendarService interface should accept `{ start: Date; end: Date }[]` instead.

### 2.6 TaskWriter / InMemoryTaskWriter — CORRECT BUT INCOMPLETE

**Files:** `TaskWriter.ts` (64 lines), `InMemoryTaskWriter.ts` (69 lines), `types.ts` (62 lines)
**Verdict:** The abstraction works. InMemoryTaskWriter validates the pattern. But the `Promise<any>` return type in InMemoryTaskWriter is a type-safety escape hatch that papers over the real problem (TaskWriter returns Prisma `Task`).

Evidence of the escape hatch:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async updateScheduledSlot(...): Promise<any> {
```

This means TypeScript won't catch mismatches between what InMemoryTaskWriter returns and what SchedulingService expects. For the native rebuild, TaskWriter should return `SchedulerTask` directly.

### 2.7 SchedulerTask / SchedulerSettings — GOOD START, ONE INHERITED SMELL

**File:** `src/services/scheduling/types.ts` (62 lines)
**Verdict:** Correctly identifies the 14 task fields and 12 settings fields the engine actually uses.

**Inherited smell:** `SchedulerSettings.workDays` and `selectedCalendars` are typed as `string` (JSON-encoded arrays), carrying forward the Prisma JSON-string convention. The comment says `// JSON-encoded number[]`. For the native rebuild, these should be `number[]` and `string[]` directly.

---

## 3. Orchestrator Assessment

### 3.1 schedulerFacade.ts — ADEQUATE FOR DEV, NOT FOR PRODUCTION

**File:** `src/lib/projectops/schedulerFacade.ts` (155 lines)
**Verdict:** Functional but carries the temp-task antipattern.

The facade follows this flow:
1. Map DTOs → Prisma create inputs (N iterations)
2. `prisma.task.create` for each task (N sequential DB writes — not batched)
3. `prisma.task.findMany` to re-read with relations
4. Construct SchedulingService with optional ConflictWindowsCalendarService
5. `scheduleMultipleTasks()`
6. Map results back to response DTOs
7. `prisma.task.deleteMany` in `finally`

**Sequential creates (line 56–61):** Tasks are created one at a time in a for-loop. For 20 tasks, that's 20 sequential round-trips. Should be `prisma.task.createMany` or `Promise.all`. Not a correctness issue but a latency multiplier.

**Result mapping fragility (line 93–94):**
```typescript
const task = updatedTasks.find((t) => t.id === taskIds[i]) ?? updatedTasks[i];
```
This falls back to index-based lookup if `find` fails. The `updatedTasks` from `scheduleMultipleTasks` is re-fetched from DB (via `taskWriter.fetchTasks`) and may be in a different order than `taskIds`. If any temp task was deleted between scheduling and fetch (race condition with another request), the index fallback silently returns the wrong task.

**Cleanup robustness:** The `finally` block catches and logs delete errors — correct. But if the process crashes between task creation and finally, orphaned tasks remain. There is no periodic cleanup job. For a dev harness this is acceptable; for production it needs a TTL or job queue.

### 3.2 API Route — MINIMAL, CORRECT

**File:** `src/app/api/projectops/schedule/route.ts` (60 lines)
**Verdict:** Clean. Auth → parse JSON → validate → facade → respond. No issues.

### 3.3 Validation — ADEQUATE WITH GAPS

**File:** `src/lib/projectops/validation.ts` (79 lines)

**Gap 1: No minimum duration.** `estimatedMinutes: z.number().int().positive()` allows 1 minute. As shown in section 2.2, this can generate 10,080 slots in a 7-day window.

**Gap 2: No IANA timezone validation.** `timezone: z.string().min(1)` accepts "notazone". The `toZonedTime()` call in TimeSlotManager will silently produce incorrect results or throw (depending on the date-fns-tz version).

**Gap 3: No `end > start` on conflict windows.** A window where `start > end` or `start === end` won't cause a crash (the overlap check will never match), but it's a silent data error.

**Gap 4: No `workHourStart < workHourEnd` validation.** Both are independently validated 0–23. A request with `workHourStart: 17, workHourEnd: 9` will produce zero work-hour slots (filterByWorkHours rejects everything), and every task will get `reason: "no_slots_in_window"`.

**Gap 5: No max task count.** The array validation is `z.array(...).min(1)` with no `.max()`. A request with 10,000 tasks would attempt 10,000 sequential DB creates, then try to schedule them all. No upper bound.

### 3.4 Mappers — CORRECT

**File:** `src/lib/projectops/mappers.ts` (88 lines)
**Verdict:** Clean mapping logic. Defaults are sensible (30-min duration, status=todo, scheduleLocked=false). The JSON-string encoding for settings is the inherited Prisma convention — correct for the current architecture, wrong for a native rebuild.

---

## 4. Memory and Performance Analysis

### 4.1 Peak Memory During Scheduling

For a single scheduling run with N tasks, B batch size (8), D duration (minutes), W window (days):

**Slot objects per task:** `W × 24 × (60/D)` (before work-hour filtering)
**Peak slots in memory:** `B × W × 24 × (60/D)` (one batch of tasks, each with generated slots)

| N tasks | Duration | Window | Slots/task | Peak slots (batch=8) | Memory (~200B/slot) |
|---------|----------|--------|------------|---------------------|---------------------|
| 10 | 30 min | 7 days | 336 | 2,688 | ~524 KB |
| 10 | 15 min | 7 days | 672 | 5,376 | ~1 MB |
| 10 | 5 min | 7 days | 2,016 | 16,128 | ~3.1 MB |
| 10 | 1 min | 7 days | 10,080 | 80,640 | ~15.7 MB |
| 50 | 30 min | 7 days | 336 | 2,688 | ~524 KB |
| 50 | 1 min | 7 days | 10,080 | 80,640 | ~15.7 MB |

**Analysis:** For normal use (30-min tasks), memory is trivial. The danger is small durations. A minimum duration of 5 minutes would cap peak slots at ~16K per batch, which is safe. A minimum of 15 minutes caps at ~5.4K, which is comfortable.

**Note:** Slot generation is followed by `filterByWorkHours` which reduces to ~29% of slots (8 work hours / 24 total hours, 5 work days / 7 total days). But the full array is allocated before filtering. GC handles the discarded slots eventually, but peak allocation is the pre-filter count.

### 4.2 CPU During Conflict Checking

For the ConflictWindowsCalendarService path (no DB), conflict checking is O(filtered_slots × conflict_windows) per task. After work-hour filtering:

| Filtered slots | Conflict windows | Overlap checks | Approx time |
|----------------|-----------------|----------------|-------------|
| 80 | 20 | 1,600 | <1ms |
| 80 | 200 | 16,000 | ~1ms |
| 160 | 200 | 32,000 | ~2ms |
| 2,016 | 200 | 403,200 | ~20ms |

For the CalendarServiceImpl path (DB), add one Prisma query per batch (efficient) plus O(filtered_slots × scheduledTasks) for in-memory conflict checks.

**Analysis:** CPU is not a concern for MVP task/conflict counts. The slot generation dominance means the performance bottleneck is memory allocation, not computation.

### 4.3 No Runaway Loop Risk Beyond Slot Generation

I verified every loop in the codebase:
- `generatePotentialSlots`: bounded by `localCurrentStart < localEndDate` with `addMinutes(duration)` advancement. Will terminate as long as `duration > 0` (guaranteed by `DEFAULT_TASK_DURATION = 30` and validation requiring positive integers). **No infinite loop possible.**
- `filterByWorkHours`: single pass over slots array. Bounded.
- `removeConflicts`: single pass over batch results. Bounded.
- `scoreSlots`: single pass. Bounded.
- `scheduleMultipleTasks` outer loop: bounded by `sortedTasks.length`. Inner batch loop bounded by `batchSize = 8`. No re-entry.
- `scheduleTask` window loop: bounded by `windows.length` (currently 1, was 3). No re-entry.

**Verdict: No infinite loop risk.** The only unbounded growth is the slot array size, which is bounded by the window/duration ratio.

---

## 5. Guardrail Assessment

### What exists:
| Guardrail | Location | Verdict |
|-----------|----------|---------|
| Zod schema validation | validation.ts | Good coverage, gaps noted in 3.3 |
| Batch size = 8 | SchedulingService:145 | Effective; limits parallel slot generation |
| Window = 7 days only | SchedulingService:138-142 | Effective; the 14/30-day windows are commented out |
| Score cap at 2.0 | SlotScorer:142 | Correct; prevents overdue runaway |
| Empty slot check | SchedulingService:265 | Correct; returns null if no slots found |
| Settings required | SchedulingService:102 | Correct; throws instead of falling back |
| Cleanup in finally | schedulerFacade:133 | Correct; temp tasks always cleaned up on success/failure |
| Auth required | route.ts:18 | Correct; 401 before any processing |

### What's missing:
| Missing Guardrail | Risk | Severity |
|-------------------|------|----------|
| **Max slot count or min duration** | Runaway memory from 1-min tasks | HIGH |
| **Max task count per request** | 10K tasks → 10K DB writes + scheduling | HIGH |
| **IANA timezone validation** | Silent incorrect scheduling | MEDIUM |
| **workHourStart < workHourEnd** | Silent zero-result scheduling | LOW |
| **conflictWindow end > start** | Silent ignored conflicts | LOW |
| **Request timeout** | Long-running schedule blocks event loop | MEDIUM |
| **Concurrent request limit** | Multiple schedule requests multiply memory | MEDIUM |

---

## 6. Test Suite Assessment

### Current coverage:

| Test file | Tests | What it covers |
|-----------|-------|---------------|
| `validation.test.ts` | 11 | Zod schema: valid/invalid requests, enums, dates, numbers |
| `mappers.test.ts` | 4 | DTO → Prisma mapping: defaults, full fields |
| `schedulerFacade.test.ts` | 5 | Facade: error paths, happy path, cleanup, multi-task mapping |
| `ConflictWindowsCalendarService.test.ts` | 14 | Overlap: exact match, inside, adjacent, 1-min overlap, batch boundary |
| `InMemoryTaskWriter.test.ts` | 8 | TaskWriter: CRUD, error, copy isolation, round-trip |
| **Total** | **42** | |

### What's tested well:
- **Boundary overlap semantics** — 6 specific boundary tests verify adjacent-OK, overlap-detected. These are the highest-value tests in the suite.
- **Validation rejection** — 7 rejection tests cover the most likely bad inputs.
- **Facade error handling** — Cleanup-on-throw is verified. This prevents the most dangerous failure mode (orphaned temp tasks).
- **TaskWriter abstraction** — InMemoryTaskWriter proves the interface works without Prisma.

### Critical gaps:

**Gap 1: Zero tests exercise SlotScorer.**
No test verifies that a HIGH-priority task with a deadline tomorrow scores higher than a LOW-priority task with no deadline. No test verifies the scoring formula produces expected values for known inputs. The scoring engine is the core business logic and it's completely untested.

**Evidence:** Grep for "SlotScorer" in test files — zero results. Grep for "scoreSlot" — zero results.

**Gap 2: Zero tests exercise slot generation.**
No test verifies that `generatePotentialSlots()` produces the expected number of slots for a given duration, start/end date, and timezone. No test verifies that `filterByWorkHours()` correctly filters by work hours in a specific timezone. The slot-generation + work-hour-filtering pipeline is the second most important logic path, and it's untested.

**Gap 3: Zero tests exercise the full scheduling pipeline.**
No test runs `SchedulingService.scheduleMultipleTasks()` (or `scheduleTask()`) with real slot generation, scoring, and conflict removal. The facade tests mock SchedulingService entirely. The ConflictWindowsCalendarService tests only verify overlap detection in isolation. Nobody has ever tested: "Given 3 tasks with these priorities and a ConflictWindowsCalendarService with these busy windows, does the scheduler place them in the right slots?"

**Gap 4: No test for the double-scoring / stale-sort issue.**
The initial scoring pass and the actual scheduling pass may produce different results (because scheduled tasks change the conflict landscape). No test verifies that the greedy assignment produces correct results when tasks compete for the same slot.

**Gap 5: No test for timezone correctness.**
The extraction verdict identified timezone handling as the original root cause of bug #161. No test verifies that a task scheduled with timezone "America/New_York" gets slots within 9am–5pm Eastern, not UTC.

### Highest-risk untested scenarios:

1. **Task with 0 or null duration** — `DEFAULT_TASK_DURATION = 30` should kick in, but no test verifies this through the full path.
2. **All slots conflicted** — What happens when every work-hour slot in the 7-day window overlaps with a conflict window? The scheduler should return null/no_slots_in_window. Untested end-to-end.
3. **Task with startDate in the future** — `findAvailableSlots` has special handling (line 98–109) for tasks whose startDate is beyond the scheduling window. Untested.
4. **Overdue task scoring** — `deadlineProximity` has a different code path for overdue tasks (lines 135–153 in SlotScorer). Untested.

---

## 7. Should This Stay Internal or Become a Service?

**Stay internal for now. Become a service only if multiple consumers emerge.**

### Evidence for staying internal:

1. **Single consumer.** Project Ops is the only planned consumer. There's no API consumer besides the dev harness at `/api/projectops/schedule`.

2. **The temp-task pattern must die first.** The scheduler cannot be a service while it writes to and reads from a shared database during computation. A service needs a pure `(input) → output` contract. The current engine is `(input) → DB mutation → output`.

3. **The abstraction boundaries aren't proven end-to-end.** InMemoryTaskWriter validates TaskWriter in isolation. But nobody has run SchedulingService with InMemoryTaskWriter AND ConflictWindowsCalendarService together. The boundary is theoretically clean but practically unverified.

4. **No observability.** The `logMetrics()` method dumps a stringified JSON blob to debug logging. A service needs structured metrics (latency percentiles, slot counts, conflict ratios, cache hit rates). This infrastructure doesn't exist.

5. **No versioning.** The scoring weights are hardcoded constants. If two consumers want different weights, there's no mechanism for it. A service would need configurable or versioned scoring models.

### When to extract to a service:

- When a second consumer (besides Project Ops) needs scheduling
- When the scheduling computation needs to run in a different process/region for latency reasons
- When the scoring model needs A/B testing or per-tenant configuration
- When scheduling volume exceeds what the app server can handle synchronously

### For the native rebuild:

Keep the scheduler as an internal module (`lib/scheduler/` or `services/scheduling/` in Project Ops). Export a pure function:

```typescript
function scheduleTasks(
  tasks: SchedulerTask[],
  settings: SchedulerSettings,
  busyPeriods: { start: Date; end: Date }[],
  timezone: string
): ScheduledSlot[]
```

No TaskWriter needed — the caller decides what to persist. No CalendarService needed — busy periods are passed in. No Prisma types anywhere.

---

## 8. Summary Table

| Area | Verdict | Blocking? |
|------|---------|-----------|
| SlotScorer (7-factor scoring) | Clean, correct, bounded | No |
| TimeSlotManager (slot generation) | Unbounded for small durations | **YES — add min duration or max slot cap** |
| TimeSlotManager (conflict removal) | O(n×m), acceptable for MVP scale | No |
| TimeSlotManager (Prisma coupling) | Direct prisma.task.findMany | No (known, planned for removal) |
| SchedulingService (orchestration) | Double slot-finding, acceptable for MVP | No |
| SchedulingService (settings) | Throws on missing settings — correct | No |
| ConflictWindowsCalendarService | Correct, well-tested | No |
| InMemoryTaskWriter | Correct, validates pattern, `any` return type | No |
| SchedulerTask/SchedulerSettings | Good start, carries JSON-string smell | No |
| schedulerFacade | Temp-task antipattern, sequential creates | No (dev only) |
| Validation | Missing min duration, max tasks, IANA check | **YES — add before any load testing** |
| Test coverage: adapters | Good (28 tests) | No |
| Test coverage: scoring | Zero | **YES — add before trusting scheduling decisions** |
| Test coverage: slot generation | Zero | **YES — add before trusting timezone correctness** |
| Test coverage: full pipeline | Zero | **YES — add before any production use** |

---

## 9. Minimum Actions Before Production Use

These are ordered by risk reduction, not effort:

1. **Add `estimatedMinutes` minimum of 5 in Zod schema.** One line change. Caps slot generation at ~2,000 per task.

2. **Add `tasks` array max of 100 in Zod schema.** One line change. Prevents 10K-task abuse.

3. **Add a hard slot cap in `generatePotentialSlots`.** After the while loop, if `slots.length > MAX_SLOTS` (e.g., 1,000), truncate and log a warning. Defense in depth.

4. **Add 5 SlotScorer unit tests.** Test the scoring formulas with known inputs:
   - HIGH priority + deadline tomorrow > LOW priority + no deadline
   - Overdue task scores > 1.0
   - Energy level exact match scores 1.0, adjacent 0.5, opposite 0.0
   - Work-hour-aligned slot scores 1.0
   - Time preference match scores 1.0

5. **Add 3 slot generation tests.** Test with a known timezone:
   - 7-day window, 30-min duration → expected slot count
   - Verify all surviving slots are within work hours
   - Verify slots respect task.startDate constraint

6. **Add 1 full-pipeline integration test.** Use InMemoryTaskWriter + ConflictWindowsCalendarService + real SchedulingService. 3 tasks, 2 busy windows, verify all 3 get scheduled without overlapping each other or the busy windows.

7. **Add IANA timezone validation.** Use `Intl.supportedValuesOf('timeZone')` (available in Node 18+) or a try/catch on `Intl.DateTimeFormat(undefined, { timeZone })`.

---

## 10. What the Native Rebuild Should Preserve

Carry forward from this codebase:

| Artifact | Why |
|----------|-----|
| 7 scoring formulas + weights from SlotScorer | Core business logic, well-designed |
| Slot generation algorithm from TimeSlotManager | Correct work-hour/timezone handling |
| API contract (ProjectOpsScheduleRequest/ScheduleResult) | Clean, tested |
| Zod validation schema | Good coverage, easy to add missing checks |
| ConflictWindowsCalendarService boundary tests | Verify the overlap semantics correctly |
| Greedy batch-and-sort orchestration pattern | Effective heuristic for the use case |
| SchedulerTask/SchedulerSettings interfaces | Correct field identification |

Do NOT carry forward:

| Artifact | Why |
|----------|-----|
| Temp-task create/delete pattern | Concurrency hazard, performance waste |
| TaskWriter abstraction (as currently typed) | Returns Prisma `Task`; native rebuild uses native types |
| JSON-string settings encoding | Prisma convention, not needed natively |
| CalendarEvent 20-field dummy construction | Interface over-specification |
| Performance metrics logging (current form) | String-dumped JSON blob, not structured |
| CalendarServiceImpl | Too coupled to FC's Prisma schema |
| `@/lib/date-utils` wrapper | Carry date-fns directly, or use Temporal when available |
