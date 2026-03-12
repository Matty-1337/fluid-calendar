# Scheduler Correctness Recheck

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (principal software architect)
**Scope:** Verify whether the correctness-testing phase has been completed: SlotScorer tests, TimeSlotManager tests, full-pipeline integration test, commit/push status, dry-run posture, and no premature writeback.

---

## 1. Direct SlotScorer Tests

**Status: NO**

**Evidence:** The only file in `src/services/scheduling/__tests__/` is `InMemoryTaskWriter.test.ts`. No `SlotScorer.test.ts` exists anywhere in the repository.

```
$ ls src/services/scheduling/__tests__/
InMemoryTaskWriter.test.ts
```

```
$ find . -name "SlotScorer.test*" | grep -v node_modules
(no results)
```

`SlotScorer.ts` (212 lines) contains 7 scoring functions with specific mathematical formulas. None have ever been tested with known inputs:

- `scoreDeadlineProximity` — overdue decay formula untested
- `scorePriority` — priority ordering untested
- `scoreEnergyLevelMatch` — energy level distance calculation untested
- `scoreTimePreference` — time-of-day matching untested
- `scoreProjectProximity` — exponential decay proximity untested
- `scoreWorkHourAlignment` — binary within/outside untested
- `scoreBufferAdequacy` — binary has/hasn't untested

**Sufficient for internal dry-run:** NO — the scheduling engine's core decision-making logic has zero test coverage. We cannot confirm the engine makes correct priority, deadline, or energy-level decisions.

---

## 2. Direct TimeSlotManager Tests

**Status: NO**

No `TimeSlotManager.test.ts` exists anywhere in the repository.

```
$ find . -name "TimeSlotManager.test*" | grep -v node_modules
(no results)
```

`TimeSlotManager.ts` (466 lines) contains the slot generation pipeline including `generatePotentialSlots`, `filterByWorkHours`, `removeConflicts`, `applyBufferTimes`, `scoreSlots`, and `sortByScore`. None are directly tested.

Key untested behaviors:
- Correct slot count for a given duration and window
- Work-hour boundary enforcement across timezones
- The `MAX_SLOTS = 5000` cap (added in hardening, never tested)
- Behavior when `workHourStart >= workHourEnd`
- `roundDateUp` effects on slot boundaries

**Sufficient for internal dry-run:** NO — the slot generation pipeline is untested. We cannot confirm slots are generated at correct times, in correct timezones, or within correct work hours.

---

## 3. Full-Pipeline Integration Test

**Status: NO**

No integration test exists that exercises the real scheduling pipeline end-to-end. Specifically, no test does this:

> Given N tasks with known properties + M conflict windows → run SchedulingService with ConflictWindowsCalendarService + InMemoryTaskWriter → verify all tasks are scheduled without overlap, within work hours, in correct timezone.

The `schedulerFacade.test.ts` mocks `SchedulingService` entirely:
```typescript
jest.mock("@/services/scheduling/SchedulingService", () => ({
  SchedulingService: jest.fn().mockImplementation(() => ({
    scheduleMultipleTasks: mockScheduleMultipleTasks,
  })),
}));
```

This tests facade orchestration (temp task create/delete, result mapping, error handling) but never calls the real scheduling engine.

**Sufficient for internal dry-run:** NO — nobody has ever verified that the full pipeline (slot generation → filtering → conflict checking → scoring → assignment) produces correct, non-overlapping results.

---

## 4. Local Changes Committed and Pushed

**Status: NO**

**Git state:**
- Latest commit: `b5c0f2b claude: add repo intelligence layer` (repo intelligence only)
- Remote: `origin` at `https://github.com/dotnetfactory/fluid-calendar.git`
- No new commits since `b5c0f2b`
- No other branches exist

**Uncommitted work (modified tracked files):**
- `HANDOFF.md`
- `package-lock.json`
- `src/services/scheduling/SchedulingService.ts` (CalendarService + TaskWriter injection)
- `src/services/scheduling/TaskSchedulingService.ts` (timezone fix)
- `src/services/scheduling/TimeSlotManager.ts` (Zustand removal + MAX_SLOTS cap)

**Untracked files:** 40+ files including the entire `src/lib/projectops/` directory, `src/app/api/projectops/schedule/route.ts`, `TaskWriter.ts`, `InMemoryTaskWriter.ts`, `types.ts`, all tests, and all docs.

**The GitHub repository contains zero scheduler/projectops code.** Everything exists only in the local working tree.

---

## 5. Dry-Run-Only Posture Preserved

**Status: YES**

**Evidence:**

1. The scheduler facade (`schedulerFacade.ts`) creates temporary DB tasks, runs the scheduler, extracts results as JSON, and deletes the temporary tasks in a `finally` block. Net DB state change: zero.

2. No writeback code exists. Grep for `writeback`, `writeBack`, `createEvent`, `insertEvent` across all scheduler files: zero matches.

3. The `calendarWriteback` field in `TaskScheduleResult` is defined in `types.ts:61` but **never populated** anywhere in the codebase. It remains a type-only placeholder.

4. The API route (`route.ts`) returns `NextResponse.json(result)` — pure data response, no side effects.

5. No calendar API write calls (Google Calendar insert, Outlook create event, CalDAV PUT) exist in any scheduler-related code.

---

## 6. No Writeback or Automation Added Prematurely

**Status: YES — confirmed clean**

**Evidence:**

1. No `writeback`, `writeBack`, `createEvent`, or `insertEvent` references in `src/services/scheduling/`, `src/lib/projectops/`, or `src/app/api/projectops/`.

2. No cron jobs, background workers, or scheduled triggers reference the projectops schedule endpoint.

3. No webhook handlers trigger scheduling automatically.

4. The route requires `authenticateRequest()` — no unauthenticated access path exists.

5. No rate limiting exists (a gap, but not a premature automation risk — there's nothing automated to rate-limit against).

---

## 7. What the Hardening Phase DID Accomplish

The previous session implemented 4 of the 7 minimum hardening actions from the MVP verdict:

| # | Action | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `estimatedMinutes` minimum of 5 | **DONE** | `validation.ts:27` — `.min(5, "estimatedMinutes must be at least 5")` |
| 2 | `estimatedMinutes` maximum of 480 | **DONE** | `validation.ts:28` — `.max(480, "estimatedMinutes must be at most 480")` |
| 3 | Tasks array max of 50 | **DONE** | `validation.ts:92` — `.max(50, "at most 50 tasks per request")` |
| 4 | IANA timezone validation | **DONE** | `validation.ts:78-85` — `.refine()` with `Intl.DateTimeFormat` try/catch |
| 5 | Slot generation cap | **DONE** | `TimeSlotManager.ts:267-269` — `MAX_SLOTS = 5000` with `break` guard |
| 6 | SlotScorer tests | **NOT DONE** | No test file exists |
| 7 | Full-pipeline integration test | **NOT DONE** | No integration test exists |

Validation test coverage was extended: 50 tests now pass (up from 43), with 7 new tests covering min/max estimatedMinutes, max tasks, boundary 50 tasks, and IANA timezone accept/reject.

---

## 8. Verdict

**Ready for controlled internal dry-run — with explicit caveats.**

The input validation guardrails are now in place. The 4 critical hardening fixes prevent the most dangerous failure modes:
- A 1-minute task no longer generates 10,080 slots (rejected at validation)
- 200 tasks no longer cause 400 sequential DB writes (rejected at validation)
- An invalid timezone no longer silently produces wrong scheduling (rejected at validation)
- Even if validation is bypassed, the `MAX_SLOTS = 5000` cap prevents runaway memory allocation

**What "controlled internal dry-run" means:**
- A developer or internal tool calls the API
- The response is scheduling proposals (JSON data)
- A human reviews the proposals before acting on them
- No calendar events are created, no tasks are moved, no state is mutated

**Explicit caveats (must be communicated to any consumer):**
1. **Scheduling quality is unverified.** The scoring engine has zero tests. The proposals might put HIGH-priority overdue tasks after LOW-priority future tasks. A human must eyeball results.
2. **Timezone correctness is unverified by test.** IANA validation ensures the timezone is valid, but no test confirms that a task scheduled in `America/New_York` actually lands within 9-5 ET.
3. **No overlap guarantee by test.** No integration test proves that two tasks are never scheduled in the same slot. The conflict-checking logic is tested in isolation (ConflictWindowsCalendarService), but the full pipeline is not.
4. **Nothing is committed.** The GitHub repo has zero scheduler code. A `git checkout .` would erase all of this work.

**What must happen before upgrading to "internal beta with manual human review":**
1. SlotScorer tests (5 minimum — priority ordering, deadline direction, energy match, time preference, weighted average)
2. 1 full-pipeline integration test (3 tasks + 2 conflicts → verify no overlap + work hours + correct timezone)
3. Commit and push all scheduler work to Git

**Bottom line:** The guardrails protect against crashes and garbage input. They do not prove the engine makes good scheduling decisions. For dry-run use where a human reviews every result, that's acceptable. For anything beyond that, the scoring and pipeline tests are non-negotiable.
