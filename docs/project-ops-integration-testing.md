# Project Ops Integration — Testing

**Date:** 2025-03-07  
**Scope:** Proof-of-concept adapter layer and schedule API.

---

## 1. Tests Added

### Unit tests

- **`src/lib/projectops/__tests__/mappers.test.ts`**
  - `projectOpsTaskToCreateInput`: minimal task (defaults for status, duration 30, isAutoScheduled, scheduleLocked); full task (dueDate, earliestStart, estimatedMinutes, priority, energyLevel, preferredTime, scheduleLocked, externalTaskId).
  - `projectOpsSettingsToAutoScheduleSettings`: defaults (workDays [1–5], 9–17, buffer 15, empty calendars, groupByProject false); custom (workDays, workHourStart/End, bufferMinutes, selectedCalendars, groupByProject).

**Run:** `npm run test:unit -- --testPathPattern=projectops`

---

## 2. Tests Still Missing

| Area | Description | Priority |
|------|-------------|----------|
| DTO validation | Zod or similar schema for ProjectOpsScheduleRequest; reject invalid payloads in route. | Medium |
| Timezone preservation | E2E or integration: send request with timezone America/New_York, assert returned scheduledStart/End fall in local 9–17. | High |
| Facade error handling | runProjectOpsSchedule when Prisma or SchedulingService throws; assert ScheduleResult.success false and error message. | Medium |
| API route 400/401 | Unauthenticated request returns 401; missing timezone or tasks returns 400. | Medium |
| Overlap avoidance | With calendar events in DB, assert returned slot does not overlap (integration). | High |
| Unschedulable task | Task with no slots (e.g. work window too narrow or all conflict); assert success false and reason. | Medium |

---

## 3. Highest-Risk Untested Areas

1. **Timezone in end-to-end flow** — The facade passes `request.timezone` into SchedulingService; the scheduler uses it in TimeSlotManager. A test that sends a known timezone and asserts slot times are in that zone would catch regressions (e.g. B1 reappearing).
2. **Overlap with calendar events** — CalendarServiceImpl and batch conflict logic are not covered; B2 (tasks between events) could still occur. An integration test that creates a calendar event, then runs the Project Ops schedule request with that calendar in selectedCalendars, and asserts no returned slot overlaps the event, would reduce risk.
3. **Temporary task cleanup** — The facade deletes created tasks in a `finally` block. If the scheduler throws after creating tasks, we rely on finally to clean up. A test that mocks the scheduler to throw and then asserts tasks were deleted would verify this.
4. **Result order and mapping** — We match results to request tasks by index and task id. A test with multiple tasks that get scheduled in a different order (due to scoring) would verify that we still map each result to the correct externalTaskId/title.

---

## 4. How to Run Existing Tests

```bash
npm run test:unit
npm run test:unit -- --testPathPattern=projectops
```

---

## 5. Suggested Next Tests (in order)

1. **API route:** POST without auth → 401; POST with body `{}` or missing timezone/tasks → 400.
2. **Facade:** runProjectOpsSchedule with invalid request (empty tasks) → success false, error message.
3. **Integration (optional):** Start app, authenticate, POST a valid payload to `/api/projectops/schedule`, assert 200 and result.results[0].scheduledStart/scheduledEnd present. Requires running DB and app.
