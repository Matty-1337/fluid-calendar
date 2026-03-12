# Scheduler Hardening Verification

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (principal software architect)
**Method:** Direct code inspection of current working tree files.

---

## Verification Matrix

### 1. Minimum task duration validation

**Status: NO**

**File:** `src/lib/projectops/validation.ts:24`
```typescript
estimatedMinutes: z.number().int().positive().nullable().optional(),
```
`z.number().int().positive()` allows any value ≥ 1. A task with `estimatedMinutes: 1` generates `7 × 24 × 60 = 10,080` slots for a 7-day window. The field is also nullable/optional — when omitted, `mappers.ts:47` defaults to 30 minutes, which is safe. The risk is specifically when a caller sends an explicit small value.

**Sufficient for internal dry-run:** NO — a single malformed request can generate millions of slot objects and hang the server.

---

### 2. Max task count validation

**Status: NO**

**File:** `src/lib/projectops/validation.ts:71`
```typescript
tasks: z.array(projectOpsTaskSchema).min(1, "at least one task is required"),
```
No `.max()` constraint. 1000 tasks × 2 passes (double-scoring) × 10,080 slots each = 20,160,000 slot objects. Each temporary task also requires a sequential `prisma.task.create()` call.

**Sufficient for internal dry-run:** NO — unbounded task arrays create runaway DB writes and scheduling compute.

---

### 3. Max scheduling window validation

**Status: NO**

The scheduling window is hardcoded in `SchedulingService.ts:139` and `:246`:
```typescript
const windows = [
  { days: 7, label: "1 week" },
];
```
This is safe for now — the 7-day window is fixed and cannot be influenced by the caller. However, the commented-out 14-day and 30-day windows (lines 140-141, 247-248) would multiply slot generation proportionally if re-enabled.

**Sufficient for internal dry-run:** YES (window is fixed at 7 days) — but only because it's hardcoded, not validated.

---

### 4. Slot generation cap

**Status: NO**

**File:** `src/services/scheduling/TimeSlotManager.ts:267-281`
```typescript
while (localCurrentStart < localEndDate) {
    const slotEnd = addMinutes(localCurrentStart, duration);
    const slot: TimeSlot = { ... };
    slots.push(slot);
    localCurrentStart = addMinutes(localCurrentStart, duration);
}
```
Unbounded `while` loop. No `MAX_SLOTS` constant, no `break` guard. The loop terminates only when `localCurrentStart >= localEndDate`. For 1-minute durations across 7 days: 10,080 iterations.

**Sufficient for internal dry-run:** NO — defense in depth requires a cap even if duration validation is added.

---

### 5. IANA timezone validation

**Status: NO**

**File:** `src/lib/projectops/validation.ts:69`
```typescript
timezone: z.string().min(1, "timezone is required"),
```
Any non-empty string passes. Invalid timezones like `"foo/bar"` are passed to `date-fns-tz`'s `toZonedTime()`, which may silently produce incorrect dates or throw depending on the runtime environment.

**Sufficient for internal dry-run:** NO — incorrect timezone silently produces wrong scheduling results.

---

### 6. Work-hours validation

**Status: PARTIAL**

**File:** `src/lib/projectops/validation.ts:49-50`
```typescript
workHourStart: z.number().int().min(0).max(23).optional(),
workHourEnd: z.number().int().min(0).max(23).optional(),
```
Individual bounds are validated (0-23). However, there is no cross-field validation that `workHourStart < workHourEnd`. Setting `workHourStart: 17, workHourEnd: 9` causes `filterByWorkHours` to filter out ALL slots silently — every task returns "no_slots_in_window" with no error message.

**Sufficient for internal dry-run:** PARTIAL — individual bounds are fine, but inverted hours silently fail.

---

### 7. Invalid conflict-window validation

**Status: PARTIAL**

**File:** `src/lib/projectops/validation.ts:62-65`
```typescript
const conflictWindowSchema = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
});
```
Format validation exists (ISO datetime with offset). No `end > start` validation. An inverted window (`end` before `start`) won't match any slot via `areIntervalsOverlapping`, so it's silently ignored rather than causing harm. Not dangerous, but misleading.

**Sufficient for internal dry-run:** YES — inverted windows are harmless (no false conflicts).

---

### 8. Core slot-generation tests

**Status: NO**

No test file exists for `TimeSlotManager`. Zero tests verify:
- Correct slot count for a given duration/window
- Work-hour boundary enforcement
- Timezone correctness (slots at correct local times)
- Behavior with minimum duration values
- Behavior when workHourStart ≥ workHourEnd

**Sufficient for internal dry-run:** NO — the core slot generation pipeline is untested.

---

### 9. Core slot-scoring tests

**Status: NO**

No test file exists for `SlotScorer`. Zero tests verify:
- `scoreDeadlineProximity` direction (overdue > not overdue)
- `scorePriority` ordering (HIGH > MEDIUM > LOW > NONE)
- `scoreEnergyLevelMatch` (exact match = 1.0)
- `scoreTimePreference` (morning task scores 1.0 in morning slot)
- `scoreProjectProximity` (same-project proximity boost)
- `scoreWorkHourAlignment` (within = 1, outside = 0)
- `scoreBufferAdequacy` (has buffer = 1, no buffer = 0)
- Weighted average correctness

**Sufficient for internal dry-run:** NO — trusting untested math for scheduling decisions.

---

### 10. Orchestrator / full-pipeline tests

**Status: NO**

No test exercises the real scheduling pipeline end-to-end. The facade tests (`schedulerFacade.test.ts`) mock `SchedulingService` entirely — they never call `findAvailableSlots`, `generatePotentialSlots`, or `SlotScorer.scoreSlot`. The gap between unit tests and integrated behavior is complete.

A valid pipeline test would be: "Given 3 tasks with known durations and 2 conflict windows, using InMemoryTaskWriter + ConflictWindowsCalendarService, verify all 3 are scheduled without overlap and within work hours."

**Sufficient for internal dry-run:** NO — nobody has ever verified the full pipeline produces correct results.

---

### 11. Route validation tests

**Status: PARTIAL**

**File:** `projectops/__tests__/validation.test.ts` — 12 tests covering:
- Valid minimal/full requests
- Missing/empty timezone
- Missing/empty tasks
- Missing task title
- Invalid priority enum
- Invalid workHourStart (>23)
- Invalid workDay value (7)
- Invalid dueDate format
- Negative estimatedMinutes

**Missing:** no tests for boundary values (`estimatedMinutes: 1`), max task array size, inverted work hours, inverted conflict windows, invalid timezone strings.

**Sufficient for internal dry-run:** PARTIAL — happy/sad paths tested but boundary/adversarial cases not covered.

---

### 12. Realistic scheduling tests

**Status: NO**

No test creates multiple tasks with realistic properties (priorities, deadlines, energy levels, conflict windows) and verifies the scheduling output makes business sense. The facade test creates 1-2 tasks with mocked results. Nobody has verified that:
- A HIGH-priority overdue task gets scheduled before a LOW-priority future task
- A task with `preferredTime: "morning"` actually lands in a morning slot
- Energy level matching produces expected placements

**Sufficient for internal dry-run:** NO — no confidence that scheduling quality matches expectations.

---

### 13. Metrics / observability support

**Status: PARTIAL**

**File:** `src/services/scheduling/SchedulingService.ts:41-92`

The `startMetric`/`endMetric` pattern is well-designed — it tracks operation names, durations, and metadata for every step of the scheduling pipeline. Operations tracked: `getTimeSlotManager`, `calculateInitialScores`, `calculateTaskScore`, `sortTasks`, `scheduleTasks`, `scheduleIndividualTask`, `scheduleTask`, `tryWindow`, `updateTask`, `fetchFinalTasks`.

However, `logMetrics()` serializes the entire metrics array into a single `JSON.stringify()` call inside a `logger.debug()`:
```typescript
operations: JSON.stringify(this.metrics.map(...))
```
This produces a single log line with nested JSON. Fine for local debugging, unusable for production observability (can't query individual operation durations, can't alert on slow scheduling, can't build dashboards).

**Sufficient for internal dry-run:** YES — debug-level metrics are adequate for manual review.

---

## Summary

| # | Item | Status | Risk Level |
| --- | --- | --- | --- |
| 1 | Min task duration | **NO** | HIGH — runaway slot generation |
| 2 | Max task count | **NO** | HIGH — runaway DB writes + compute |
| 3 | Max scheduling window | YES (hardcoded) | LOW |
| 4 | Slot generation cap | **NO** | HIGH — no defense in depth |
| 5 | IANA timezone validation | **NO** | MEDIUM — silent incorrect results |
| 6 | Work-hours validation | PARTIAL | LOW — silent failure, not dangerous |
| 7 | Conflict-window validation | PARTIAL | LOW — inverted windows are harmless |
| 8 | Slot-generation tests | **NO** | HIGH — core logic untested |
| 9 | Slot-scoring tests | **NO** | HIGH — scoring math untested |
| 10 | Full-pipeline tests | **NO** | HIGH — integration never verified |
| 11 | Route validation tests | PARTIAL | MEDIUM |
| 12 | Realistic scheduling tests | **NO** | MEDIUM |
| 13 | Metrics / observability | PARTIAL | LOW |

**Items 1-4 are hard blockers for any internal use, including dry-run.** A single request with `estimatedMinutes: 1` and 50 tasks would generate 1,008,000 slot objects (50 × 2 passes × 10,080 slots) and likely OOM the process.
