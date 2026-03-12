# FluidCalendar — Testing and Hardening

**Date:** 2025-03-07

---

## 1. Current Test Coverage

### Unit tests (Jest)

- **Config:** `jest.config.js` — ts-jest, node environment, `@/` → `src/`, match `src/**/__tests__/**/*.test.ts`.
- **Existing:**
  - `src/lib/__tests__/date-utils.test.ts` — `roundDateUp`, `newDateFromYMD` (no timezone tests).
  - `src/__tests__/google-provider*.ts`, `google-oauth-scopes`, `google-integration`, `google-field-mapper`, `error-throttling`, `calendar-google-auth-route` — Google OAuth and task sync.
- **Not covered:** Scheduling logic, auth (credentials), calendar conflict detection, timezone handling in scheduler, overlap detection.

### E2E (Playwright)

- **Config:** `playwright.config.ts`.
- **Existing:** `tests/google-calendar.spec.ts`, `src/__tests__/google-provider.spec.ts` — Google calendar flows.
- **Not covered:** Sign-in, task CRUD, auto-schedule, settings, multi-provider.

### Gaps (high risk)

| Area | Risk | Current coverage |
|------|------|-------------------|
| Scheduling logic (SlotScorer, slot generation) | Wrong slots, bad scoring | None |
| Timezone in scheduler | Bug #161 (fixed in code; no regression test) | None |
| Overlap / conflict detection | Bug #150 (tasks between events) | None |
| Task CRUD API | Regressions | None |
| Auth (credentials) | Login/session regressions | None |
| Recurring tasks | RRule and scheduling | None |

---

## 2. Missing High-Risk Coverage

1. **SlotScorer** — Score factors (work hours, energy, deadline, priority, project proximity, buffer, time preference) and weighted total; edge cases: no due date, no energy, no project.
2. **TimeSlotManagerImpl** — Timezone: slot generation and work-hour filter use user TZ; test with `timeZoneOverride` (e.g. "America/New_York") and assert slot start/end in that zone. Overlap: with mock calendar service returning an event 10:00–11:00, assert no slot overlaps that range.
3. **CalendarServiceImpl.findConflicts** — Given a slot and a set of events/tasks, returned conflicts match overlapping intervals (including boundary: slot 10:00–11:00 vs event 11:00–12:00 = no overlap).
4. **date-utils** — `toZonedTime`, `convertToUserTimezone`, and any TZ used by the scheduler; test with known UTC input and expected local output for a given timezone.
5. **SchedulingService.scheduleMultipleTasks** — With mocked Prisma and calendar service: two tasks, one locked; assert only one task gets new slots and the other keeps existing times.

---

## 3. Tests Added in This Evaluation

None yet. Recommended first additions:

- **SlotScorer (unit):** New file `src/services/scheduling/__tests__/SlotScorer.test.ts`: create mock `AutoScheduleSettings` and `Task`, call `scoreSlot` for a few slot/task combinations, assert score factors and that higher priority / closer deadline yield higher scores where expected.
- **TimeSlotManager timezone (unit):** New file `src/services/scheduling/__tests__/TimeSlotManager.timezone.test.ts`: mock `CalendarService` (no conflicts), create `TimeSlotManagerImpl` with `timeZoneOverride: "America/New_York"`, call `findAvailableSlots` for a task and date range, assert generated slot times are in Eastern (e.g. 9:00–10:00 local).
- **date-utils timezone:** In `src/lib/__tests__/date-utils.test.ts`, add tests for `toZonedTime` and `convertToUserTimezone` with fixed UTC input and expected local hour/day.

---

## 4. Remaining Untested Risks

- **Buffer handling:** Buffer adequacy is scored but not enforced; no test for “no slot in buffer period.”
- **Cache invalidation:** CalendarServiceImpl cache may serve stale events; no test for invalidation on sync/CRUD.
- **Recurring tasks:** Scheduling of recurring task instances not covered.
- **E2E:** Full flow (sign-in → create task → run schedule → see on calendar) not automated; manual only until Playwright tests added.

---

## 5. How to Run Tests

```bash
# Unit (Jest)
npm run test:unit

# E2E (Playwright) — requires app and optionally credentials
npm run test:e2e
```

Running `npm run test:unit` after adding scheduler tests will catch regressions in scoring and timezone behavior.
