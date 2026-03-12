# Project Ops — Sample Payloads for Schedule API

**Date:** 2025-03-07  
**Purpose:** Example request bodies for `POST /api/projectops/schedule` (dev harness). Use with an authenticated session (e.g. Cookie or Bearer token).

---

## Endpoint

- **URL:** `POST /api/projectops/schedule`
- **Auth:** Required (NextAuth session; same as other API routes).
- **Body:** JSON matching `ProjectOpsScheduleRequest` (see docs/project-ops-scheduler-contract.md).

---

## 1. Success: Single Task, Open Calendar

Single task with valid settings; no conflicts. Expect `success: true` and one result with `scheduledStart` and `scheduledEnd` in the user's timezone window.

```json
{
  "requestId": "sample-success-1",
  "timezone": "America/New_York",
  "tasks": [
    {
      "externalTaskId": "po-task-001",
      "title": "Review project brief",
      "estimatedMinutes": 60,
      "priority": "high",
      "dueDate": "2025-03-10T17:00:00.000Z",
      "energyLevel": "high",
      "preferredTime": "morning"
    }
  ],
  "settings": {
    "workDays": [1, 2, 3, 4, 5],
    "workHourStart": 9,
    "workHourEnd": 17,
    "bufferMinutes": 15,
    "selectedCalendars": []
  }
}
```

**Note:** `selectedCalendars: []` means no calendar conflicts are applied; the scheduler only avoids already-scheduled tasks (none for a single task). Expect a slot in the next 7 days within 9–17 local time.

---

## 2. Conflict: Task Overlapping Existing Calendar Events

The scheduler avoids slots that conflict with calendar events. To simulate a conflict, the user must have calendar events in FC (e.g. connect Google Calendar and have an event 10:00–11:00). Then send a task that might otherwise land in that window. With `selectedCalendars` set to that calendar’s feed IDs, the returned slot should not overlap 10:00–11:00.

**Option A — Rely on FC calendars:** Ensure the authenticated user has at least one calendar with an event in the next 7 days. Use that calendar’s ID(s) in `selectedCalendars`. Send:

```json
{
  "requestId": "sample-conflict-1",
  "timezone": "America/New_York",
  "tasks": [
    {
      "externalTaskId": "po-task-002",
      "title": "Deep work block",
      "estimatedMinutes": 60,
      "priority": "medium",
      "dueDate": "2025-03-10T17:00:00.000Z"
    }
  ],
  "settings": {
    "workDays": [1, 2, 3, 4, 5],
    "workHourStart": 9,
    "workHourEnd": 17,
    "selectedCalendars": ["<paste-calendar-feed-id-from-FC>"]
  }
}
```

**Option B — No FC events (no conflict):** If `selectedCalendars` is `[]`, there are no calendar conflicts; you will get a slot. Use Option A when you have added a calendar and event in the app.

---

## 3. Timezone: Non-UTC Slot Times

Verify that returned `scheduledStart` and `scheduledEnd` are in the requested timezone. Use a timezone with a clear offset (e.g. America/Los_Angeles UTC-8).

```json
{
  "requestId": "sample-timezone-1",
  "timezone": "America/Los_Angeles",
  "tasks": [
    {
      "externalTaskId": "po-task-003",
      "title": "West coast standup",
      "estimatedMinutes": 30,
      "priority": "medium",
      "preferredTime": "morning"
    }
  ],
  "settings": {
    "workDays": [1, 2, 3, 4, 5],
    "workHourStart": 8,
    "workHourEnd": 18,
    "selectedCalendars": []
  }
}
```

**Check:** `scheduledStart` and `scheduledEnd` should be ISO strings whose local time (in America/Los_Angeles) falls between 08:00 and 18:00 on a work day.

---

## 4. Impossible / Overdue: No Slots in Window

Task due in the past or with no available slots in the 7-day window may return `success: false` for that task with a reason (e.g. no slots). Example: due date far in the past and work hours that don’t allow any slot.

```json
{
  "requestId": "sample-impossible-1",
  "timezone": "UTC",
  "tasks": [
    {
      "externalTaskId": "po-task-004",
      "title": "Already overdue task",
      "estimatedMinutes": 120,
      "priority": "high",
      "dueDate": "2020-01-01T12:00:00.000Z"
    }
  ],
  "settings": {
    "workDays": [1, 2, 3, 4, 5],
    "workHourStart": 9,
    "workHourEnd": 17,
    "selectedCalendars": []
  }
}
```

**Note:** The current scheduler may still assign a slot (e.g. next available) because it uses a 7-day forward window from “now”. For a truly unschedulable scenario, use a task with `earliestStart` far in the future (beyond the 7-day window) or rely on a fully booked calendar (many events) so no slot remains. Then expect `success: false` and `reason: "no_slots_in_window"` for that task.

---

## How to Run

1. Start the app: `npm run dev`.
2. Log in (e.g. credentials or Google).
3. Use curl or Postman:
   - **curl:** `curl -X POST http://localhost:3000/api/projectops/schedule -H "Content-Type: application/json" -d @payload.json --cookie "next-auth.session-token=<your-session-cookie>"`
   - Or use the browser: open DevTools → Network, trigger a request from your own client that sends the JSON body and includes the session cookie.
4. Inspect the response: `success`, `results[].success`, `results[].scheduledStart`, `results[].scheduledEnd`, `results[].reason`.

---

## Response Shape (Reminder)

```json
{
  "success": true,
  "requestId": "sample-success-1",
  "results": [
    {
      "externalTaskId": "po-task-001",
      "title": "Review project brief",
      "success": true,
      "scheduledStart": "2025-03-08T14:00:00.000Z",
      "scheduledEnd": "2025-03-08T15:00:00.000Z",
      "scheduleScore": 0.85
    }
  ]
}
```

If the scheduler fails or a task gets no slot, `success` may be `false` and `results[].reason` may be set (e.g. `"no_slots_in_window"`, `"scheduler_error"`).
