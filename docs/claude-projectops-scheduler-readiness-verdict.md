# Project Ops Scheduler Readiness Verdict

**Date:** 2026-03-07
**Reviewer:** Claude Opus 4.6 (principal software architect)
**Verdict basis:** Direct code inspection of all 21 scheduler-related files, 43 passing tests, and Git state analysis.

---

## 1. Executive Verdict

**NOT READY — even for internal dry-run use in its current state.**

The scheduler architecture is sound. The abstractions are clean. The test coverage of the integration layer (validation, mapping, conflict detection, facade orchestration) is good. But the core scheduling engine — the part that actually decides where tasks go — has **zero tests**, **no input guardrails** against pathological values, and an **unbounded slot generation loop** that can hang or OOM the process with a single malformed request.

**After 4 specific fixes** (estimated 30-60 minutes of work), the verdict upgrades to **ready for internal dry-run only**:
1. Add `.min(5)` to `estimatedMinutes` in Zod schema
2. Add `.max(50)` to tasks array in Zod schema
3. Add slot generation cap (`if (slots.length >= 5000) break`)
4. Add IANA timezone validation via `Intl.DateTimeFormat` try/catch

These are the **minimum viable guardrails**. Without them, a single `{ estimatedMinutes: 1, tasks: Array(200) }` request creates 4,032,000 slot objects and almost certainly crashes the Node.js process.

---

## 2. What Is Genuinely Solid

1. **Zod request validation** — Well-structured, correct enum constraints, datetime format validation. 12 tests. The schema catches most input errors early.

2. **ConflictWindowsCalendarService** — Clean CalendarService implementation. Handles boundary cases correctly (adjacent = no conflict, 1-minute overlap = conflict). 14 tests including 6 precise boundary tests. This is the most thoroughly tested component.

3. **TaskWriter abstraction** — Clean interface separating persistence from scheduling logic. PrismaTaskWriter (real) and InMemoryTaskWriter (test double) both work correctly. 8 tests on the test double.

4. **Facade error handling** — `finally` block guarantees temp task cleanup even on scheduler errors. Tested explicitly.

5. **CalendarService injection** — SchedulingService accepts custom CalendarService via constructor. The ConflictWindowsCalendarService plugs in cleanly. This is the right architecture for external conflict sources.

6. **Settings hardening** — SchedulingService throws if settings are missing (no silent Zustand store fallback). TimeSlotManager warns and defaults to UTC if no timezone provided.

7. **Metrics collection** — `startMetric`/`endMetric` pattern tracks every pipeline stage. Good design, adequate for debug-level observability.

---

## 3. What Is Missing

### Critical (blocks any use):

| Gap | Impact |
| --- | --- |
| No minimum duration validation | 1-minute tasks generate 10,080 slots per scheduling pass |
| No max task count | Unbounded DB writes + scheduling compute |
| No slot generation cap | While-loop runs until memory exhausted |
| No IANA timezone validation | Invalid timezone silently produces wrong results |

### Important (blocks trusted internal use):

| Gap | Impact |
| --- | --- |
| Zero SlotScorer tests | Scoring math is completely unverified |
| Zero TimeSlotManager tests | Slot generation pipeline untested |
| Zero full-pipeline tests | No proof the engine produces correct end-to-end results |
| No request timeout | Long-running requests block the server thread |
| No work-hours cross-validation | Inverted hours silently produce zero results |

### Nice-to-have (blocks production scaling):

| Gap | Impact |
| --- | --- |
| No production auth | Session-only auth inadequate for service-to-service |
| No rate limiting | Runaway client can overwhelm the server |
| No concurrent request protection | Overlapping runs create data hazards |
| No structured audit logging | Can't trace scheduling decisions post-hoc |
| No calendar writeback | Not even started (correctly — it shouldn't exist yet) |

---

## 4. Highest-Risk Failure Modes

1. **OOM / hang from small durations.** `estimatedMinutes: 1` + 7-day window = 10,080 slots × 2 passes per task. 50 tasks = 1,008,000 slot objects. Each slot is ~200 bytes → 200 MB peak allocation. This is the single highest-risk failure.

2. **Silent wrong scheduling from invalid timezone.** `timezone: "NotReal/Zone"` passes validation. `toZonedTime("NotReal/Zone")` behavior is runtime-dependent — may throw, may return UTC, may return garbage dates. Tasks could be scheduled at 3am local time.

3. **Incorrect scoring producing bad schedules.** If `scoreDeadlineProximity` has a sign error, overdue tasks might score lower than future tasks. If `scoreEnergyLevelMatch` returns wrong values, high-energy tasks land in low-energy slots. Nobody has ever tested these formulas with known inputs.

4. **Temp task leak on process crash.** If the Node process dies between task creation and the `finally` cleanup, orphaned temp tasks remain in the database. These are `isAutoScheduled: true` tasks with no external reference. There's no cleanup job for them.

5. **Double-scoring performance cliff.** `findAvailableSlots` is called twice per task (sort pass + assign pass). For 50 tasks with 30-minute durations: 50 × 2 × 336 = 33,600 slot objects. Manageable. But for 50 tasks with 5-minute durations: 50 × 2 × 2,016 = 201,600 slot objects. The performance degrades non-linearly with shorter durations.

---

## 5. Are Current Tests Enough?

**No.** The test coverage is inverted — the integration/glue layer is well-tested (43 tests), but the core scheduling engine has zero tests.

| Layer | Tests | Assessment |
| --- | --- | --- |
| Request validation | 12 | Good — covers happy/sad paths |
| DTO mapping | 4 | Adequate — covers defaults and full fields |
| Facade orchestration | 5 | Good — covers success, error, multi-task, cleanup |
| Conflict detection | 14 | Excellent — boundary-precise |
| TaskWriter abstraction | 8 | Good — covers CRUD + isolation |
| **SlotScorer** | **0** | **Not acceptable** |
| **TimeSlotManager** | **0** | **Not acceptable** |
| **SchedulingService (real)** | **0** | **Not acceptable** |

The tests prove the plumbing works. They do not prove the scheduling decisions are correct.

---

## 6. Is the Route Boundary Clean?

**Yes, mostly.** The route at `src/app/api/projectops/schedule/route.ts` follows the established pattern:
- `authenticateRequest` for auth
- JSON body parsing with error handling
- Zod `safeParse` for validation
- Delegates to `runProjectOpsSchedule` facade
- Returns structured errors

**Minor issues:**
- No `LOG_SOURCE` usage for successful requests (only errors are logged)
- No request timeout wrapping
- No rate limiting middleware

---

## 7. Is the Scheduler Engine Sufficiently Decoupled?

**Mostly yes, with one remaining coupling point.**

**Good decoupling:**
- `SchedulingService` accepts injected `CalendarService` and `TaskWriter` — no hard dependency on DB
- `ConflictWindowsCalendarService` allows request-supplied conflicts — no dependency on FC calendar feeds
- `SchedulerTask` / `SchedulerSettings` types document the exact algorithm surface area without Prisma
- `InMemoryTaskWriter` proves the TaskWriter boundary works

**Remaining coupling:**
- `TimeSlotManager.updateScheduledTasks()` (line 71) directly calls `prisma.task.findMany()` to load scheduled tasks for project-proximity scoring. When `ConflictWindowsCalendarService` is used (Project Ops path), this still fires on first call if `slotScorer.getScheduledTasks().size === 0`. If the userId has no FC tasks, it returns empty and is harmless. But the direct Prisma import at line 18 (`import { prisma } from "@/lib/prisma"`) means `TimeSlotManager` cannot run without a Prisma connection.

---

## 8. What Should Never Be Enabled Yet

1. **Automatic calendar writeback** — No code exists and none should be written until the engine is validated with real users reviewing dry-run proposals.
2. **Automated/scheduled API calls** — No rate limiting or timeout means a loop could crash the server.
3. **Service-to-service auth bypass** — The route must remain behind NextAuth session until HMAC or API key auth is implemented.
4. **Multi-week scheduling windows** — The commented-out 14-day and 30-day windows in SchedulingService (lines 140-141) must stay commented until slot generation has a hard cap.

---

## 9. Top 10 Next Engineering Actions (Priority Order)

| # | Action | Effort | Blocks |
| --- | --- | --- | --- |
| 1 | Add `.min(5)` to `estimatedMinutes` in Zod schema | 1 line | Internal dry-run |
| 2 | Add `.max(50)` to tasks array in Zod schema | 1 line | Internal dry-run |
| 3 | Add `if (slots.length >= 5000) break` in `generatePotentialSlots` while-loop | 2 lines | Internal dry-run |
| 4 | Add IANA timezone validation: `z.string().refine(tz => { try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; } catch { return false; } })` | 5 lines | Internal dry-run |
| 5 | Add 5 SlotScorer unit tests (priority ordering, deadline direction, energy match, time preference, weighted average) | ~50 lines | Trusted internal use |
| 6 | Add 3 TimeSlotManager tests (slot count for known duration, work-hour filtering, timezone correctness) | ~40 lines | Trusted internal use |
| 7 | Add 1 full-pipeline integration test (3 tasks + 2 conflicts → InMemoryTaskWriter + ConflictWindowsCalendarService → verify no overlap) | ~80 lines | Trusted internal use |
| 8 | Add `.refine(s => s.workHourStart < s.workHourEnd)` to settings schema | 3 lines | Quality |
| 9 | Wrap facade call in `Promise.race` with 15-second timeout | ~10 lines | Reliability |
| 10 | Commit all scheduler work to Git | 1 command | Everything |

**Items 1-4 are the minimum to unlock internal dry-run use. Total effort: ~15 minutes.**
**Items 5-7 are the minimum to trust the scheduling results. Total effort: ~2 hours.**
**Item 10 is a hard prerequisite for any claims about "the repository" containing this work.**
