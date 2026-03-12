# Beta Readiness Recheck

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (principal software architect)
**Scope:** Verify whether the work-hours boundary fix, SlotScorer tests, TimeSlotManager tests, and full-pipeline integration test have been implemented.

---

## 0. Strict Repository State Verification

### 0.1 Repository Identity

| Item | Value |
| --- | --- |
| Repo root | `/c/Users/matt/fluid-calendar` |
| Branch | `main` |
| HEAD commit | `b5c0f2b0913f73f6b0f68fa0f22317a4234d314a` |
| HEAD message | `claude: add repo intelligence layer (CLAUDE.md, rules, skills, analysis)` |
| origin/main | `e251172` (local is 1 commit ahead of remote) |

### 0.2 Does Commit `0748a52` Exist?

**NO.** The commit does not exist locally, on origin, or in any branch.

Evidence from strict git verification:

```
$ git cat-file -t 0748a52
fatal: Not a valid object name 0748a52

$ git branch -a --contains 0748a52
error: malformed object name 0748a52
fatal: no such commit 0748a52

$ git show --stat 0748a52
fatal: ambiguous argument '0748a52': unknown revision or path

$ git reflog
b5c0f2b HEAD@{0}: commit: claude: add repo intelligence layer (CLAUDE.md, rules, skills, analysis)
e251172 HEAD@{1}: clone: from https://github.com/dotnetfactory/fluid-calendar.git
(only 2 entries — no sign of 0748a52 ever existing)

$ git fetch origin --prune
(completed — no new objects)

$ git log --oneline --decorate -n 15
b5c0f2b (HEAD -> main) claude: add repo intelligence layer (CLAUDE.md, rules, skills, analysis)
e251172 (origin/main, origin/HEAD) feat: new architecture refactoring ...
(no commit matching 0748a52 in history)
```

**The summary that claimed commit `0748a52` with 186 tests described work that was never committed to this repository.** The git object store does not contain this hash. It does not appear in the reflog. It is not on any local or remote branch.

### 0.3 Prior Verdict Assessment

**My prior verdict (from the internal beta verdict and initial recheck) was NOT stale and was NOT pointed at the wrong checkout.** It correctly identified that:

- The codebase has not changed since the internal beta verdict
- 50 tests pass, not 186
- 5 test files exist, not the expanded set described
- The work-hours boundary bug remains unfixed
- All scheduler work remains uncommitted (local working tree only)

The summary provided to me described work that does not exist in the repository's git history, object store, reflog, or any branch.

---

## Critical Finding: The Described Work Does Not Exist

The summary provided references commit `0748a52 fix: correct work-hours boundary bug and add 11 regression tests` with 186 tests passing. **This commit does not exist in the repository.**

The codebase is in the same state as the previous review. **50 tests pass, not 186.** Five test files exist, not the expanded set described.

---

## 1. Work-Hours Minute-Boundary Bug Fix

**Status: NO**

**Evidence:**

`src/services/scheduling/TimeSlotManager.ts:264` still uses `roundDateUp`:
```typescript
localCurrentStart = roundDateUp(localCurrentStart);
```

No `advanceToFloor` function exists anywhere in the codebase:
```
$ grep -r "advanceToFloor" src/  →  no results
```

No `roundUpToMultiple` function exists either — the summary described replacing it, but it was never present:
```
$ grep -r "roundUpToMultiple" src/  →  no results
```

The `filterByWorkHours` method (line 288) still uses `getHours()` which truncates minutes:
```typescript
const endHour = localEnd.getHours();
// ...
endHour <= this.settings.workHourEnd
```

A 45-minute task starting at 16:30 with `workHourEnd: 17` → `endHour = getHours(17:15) = 17` → `17 <= 17` → passes filter. The task ends at 17:15, 15 minutes outside work hours. **The bug identified in the internal beta verdict is still present.**

---

## 2. Direct SlotScorer Tests

**Status: NO**

**Evidence:**

```
$ find . -name "SlotScorer.test*" -not -path "*/node_modules/*"
(no results)
```

```
$ ls src/services/scheduling/__tests__/
InMemoryTaskWriter.test.ts
```

The only test file in `src/services/scheduling/__tests__/` is `InMemoryTaskWriter.test.ts`. No `SlotScorer.test.ts` exists. The 7 scoring functions remain untested.

---

## 3. Direct TimeSlotManager Tests

**Status: NO**

**Evidence:**

```
$ find . -name "TimeSlotManager.test*" -not -path "*/node_modules/*"
(no results)
```

No `TimeSlotManager.test.ts` exists anywhere. The slot generation pipeline, work-hour filtering, and timezone handling remain untested.

---

## 4. Full-Pipeline Integration Test

**Status: NO**

**Evidence:**

```
$ find . -name "*pipeline*test*" -o -name "*integration*test*" -not -path "*/node_modules/*"
./docs/project-ops-integration-testing.md    (documentation only, not a test file)
./src/__tests__/google-integration.test.ts   (Google Calendar integration, not scheduler)
```

No test exercises the real scheduling pipeline end-to-end (tasks → slot generation → scoring → conflict checking → assignment → verify no overlap).

---

## 5. Dry-Run-Only Posture Preserved

**Status: YES**

This is the one item that remains correct. No writeback code was added. The facade still creates temp tasks, schedules, returns JSON, and deletes temp tasks in `finally`. The `calendarWriteback` field in `TaskScheduleResult` is still type-only, never populated.

---

## 6. Current Test Inventory (Unchanged)

| File | Tests | Covers |
| --- | --- | --- |
| `validation.test.ts` | 19 | Zod schema accept/reject including hardening boundaries |
| `ConflictWindowsCalendarService.test.ts` | 14 | Overlap detection with boundary precision |
| `InMemoryTaskWriter.test.ts` | 8 | TaskWriter abstraction CRUD |
| `schedulerFacade.test.ts` | 5 | Facade orchestration with mocked scheduler |
| `mappers.test.ts` | 4 | DTO mapping |
| **Total** | **50** | Integration/glue layer only |

**Missing:** SlotScorer (0), TimeSlotManager (0), SchedulingService real pipeline (0).

---

## 7. Verdict

**Beta may proceed conditionally — under the same terms as the previous verdict.**

The codebase has not changed since the internal beta verdict was issued. The 4 input validation guardrails (min duration, max tasks, IANA timezone, slot cap) are still in place. The dry-run-only posture is preserved.

However, the 3 items that were identified as requirements before upgrading from "conditional beta" to "structured internal review" remain unimplemented:

1. SlotScorer tests — still zero
2. TimeSlotManager tests — still zero
3. Full-pipeline integration test — still zero
4. Work-hours boundary bug — still present
5. Git commit — still uncommitted (40+ files in working tree only)

**The previous conditional approval still stands.** A human must review every scheduling result. The known work-hours boundary bug means tasks may occasionally be placed ending slightly past work hours for non-hour-aligned durations. This is a quality issue, not a safety issue, and is acceptable under human-reviewed dry-run.

**What must happen before upgrading to "structured internal review":**

1. Fix the work-hours boundary bug in `filterByWorkHours`
2. Add SlotScorer tests (minimum 5)
3. Add TimeSlotManager tests (minimum 3)
4. Add 1 full-pipeline integration test
5. Commit and push all work to Git
