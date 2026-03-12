# Project Ops Scheduler API

**Endpoint:** `POST /api/projectops/schedule`  
**Purpose:** Accept a Project Ops schedule request (timezone, tasks, optional settings and conflict windows), run the FluidCalendar scheduling engine, and return a structured schedule result. Internal / dev harness use; requires authentication.

**Source of truth:** Request/response types in `src/lib/projectops/types.ts`; validation in `src/lib/projectops/validation.ts`; handler in `src/app/api/projectops/schedule/route.ts`.

---

## Request

- **Method:** POST  
- **Content-Type:** application/json  
- **Body:** Must conform to `ProjectOpsScheduleRequest` and pass Zod validation (`projectOpsScheduleRequestSchema`).

### Request schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `requestId` | string | No | Client correlation ID; echoed in response. |
| `timezone` | string | **Yes** | IANA timezone (e.g. `America/New_York`). Must be non-empty. Passed to the scheduler; slot times are computed in this zone. |
| `tasks` | array | **Yes** | At least one task. Each element must match the task schema below. |
| `settings` | object | No | Work hours, buffers, energy windows. Omitted values use defaults. |
| `conflictWindows` | array | No | Time ranges to treat as busy. When present, used instead of DB calendar for conflict detection. |

### Task object (per element of `tasks`)

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| `externalTaskId` | string | No | Echoed in result for correlation. |
| `title` | string | **Yes** | Min length 1. |
| `description` | string \| null | No | |
| `assigneeUserId` | string | No | |
| `projectId` | string \| null | No | |
| `projectName` | string \| null | No | |
| `priority` | `"high"` \| `"medium"` \| `"low"` \| `"none"` \| null | No | |
| `status` | `"todo"` \| `"in_progress"` \| `"completed"` \| null | No | |
| `dueDate` | string \| null | No | ISO 8601 with offset (e.g. `2025-03-10T17:00:00.000Z`). |
| `estimatedMinutes` | number \| null | No | Positive integer. If null/omitted, scheduler defaults to 30. |
| `earliestStart` | string \| null | No | ISO 8601 with offset. |
| `recurrenceRule` | string \| null | No | |
| `tags` | array | No | `{ id, name, color? }[]`. |
| `energyLevel` | `"high"` \| `"medium"` \| `"low"` \| null | No | |
| `preferredTime` | `"morning"` \| `"afternoon"` \| `"evening"` \| null | No | |
| `postponedUntil` | string \| null | No | ISO 8601 with offset. |
| `scheduleLocked` | boolean | No | |
| `createdAt` | string | No | ISO 8601 with offset. |
| `updatedAt` | string | No | ISO 8601 with offset. |

### Settings object (optional)

| Field | Type | Validation |
|-------|------|------------|
| `workDays` | number[] | 0–6 (Sunday = 0). |
| `workHourStart` | number | 0–23. |
| `workHourEnd` | number | 0–23. |
| `bufferMinutes` | number | ≥ 0. |
| `selectedCalendars` | string[] | Calendar/feed IDs (used only when not using `conflictWindows`). |
| `groupByProject` | boolean | |
| `highEnergyStart`, `highEnergyEnd` | number | 0–23. |
| `mediumEnergyStart`, `mediumEnergyEnd` | number | 0–23. |
| `lowEnergyStart`, `lowEnergyEnd` | number | 0–23. |

### conflictWindows (optional)

Array of `{ start, end }`; each must be ISO 8601 with offset. When this array is present and non-empty:

- The scheduler uses `ConflictWindowsCalendarService` with these windows as the only “calendar” conflicts.
- FluidCalendar’s DB calendar (`CalendarServiceImpl`) is **not** used for this request.
- Project Ops can supply its own busy periods without any FC calendar data.

When `conflictWindows` is omitted or empty:

- The scheduler uses `CalendarServiceImpl` (DB-backed calendar events) if the route runs in the full FC app context.

---

## Response

### Success (200)

Body is a `ScheduleResult`:

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | `true` when the run completed without throwing. |
| `requestId` | string | Echo of request `requestId` or `""`. |
| `results` | `TaskScheduleResult[]` | One entry per request task; order matches request task order. |

### TaskScheduleResult (per task)

| Field | Type | Description |
|-------|------|-------------|
| `externalTaskId` | string | From request. |
| `title` | string | From request. |
| `success` | boolean | `true` if a slot was assigned. |
| `scheduledStart` | string | ISO 8601 (e.g. `2025-03-08T14:00:00.000Z`). Present when `success` is true. |
| `scheduledEnd` | string | ISO 8601. Present when `success` is true. |
| `scheduleScore` | number | Optional; score of chosen slot. |
| `candidates` | array | Optional; not currently populated by facade. |
| `conflicts` | array | Optional; not currently populated by facade. |
| `reason` | string | Set when `success` is false (e.g. `"no_slots_in_window"`, `"scheduler_error"`). |
| `calendarWriteback` | string | Optional; not currently set by facade. |

---

## Auth requirements

- The route calls `authenticateRequest(request, logSource)` (`src/lib/auth/api-auth.ts`).
- Authentication is **NextAuth JWT session**: `getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })`.
- If no valid session: **401 Unauthorized** (body: `"Unauthorized"`).
- Authenticated user ID is passed to the scheduler facade and used for DB ownership (temp tasks, Prisma calls).

For production server-to-server (Project Ops → Scheduler), see `docs/project-ops-auth-strategy.md`.

---

## Sample payloads

See **docs/project-ops-sample-payloads.md** for:

1. Success: single task, open calendar  
2. Conflict: task overlapping calendar events (FC calendars or `conflictWindows`)  
3. Timezone: non-UTC slot times  
4. Impossible / overdue: no slots in window  

---

## Success response example

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

---

## Unschedulable response example

When the scheduler runs but cannot place a task (e.g. no slot in the 7-day window):

```json
{
  "success": true,
  "requestId": "sample-impossible-1",
  "results": [
    {
      "externalTaskId": "po-task-004",
      "title": "Already overdue task",
      "success": false,
      "reason": "no_slots_in_window"
    }
  ]
}
```

When the entire run throws (e.g. DB error), the route returns **500** and the body includes `error`; the facade also returns a `ScheduleResult` with `success: false`, `error`, and per-task `reason: "scheduler_error"` for catch block responses.

---

## conflictWindows behavior

- **Provided and non-empty:** `ConflictWindowsCalendarService` is instantiated with these windows. The scheduler treats them as busy; no slots will overlap them. FC’s own calendar DB is not queried for this request.
- **Omitted or empty:** No request-level conflict source; `SchedulingService` uses its default `CalendarServiceImpl` (FC DB calendar events) when no `CalendarService` is injected. The facade injects nothing in that case, so the default is used.

---

## Timezone behavior

- `timezone` is **required** and must be a non-empty string.
- It is passed directly to `SchedulingService(settings, timezone, calendarService)` and then to `TimeSlotManager` for slot generation.
- All returned times (`scheduledStart`, `scheduledEnd`) are in **ISO 8601** (UTC). The scheduler computes slots in the given timezone (work hours, energy windows); the API returns UTC for a stable, unambiguous contract.

---

## Error cases

| HTTP status | Condition | Body |
|------------|-----------|------|
| **400** | Invalid JSON body | `{ "error": "Invalid JSON body" }` |
| **400** | Zod validation failed | `{ "error": "Invalid request body", "details": { "<field>": ["message"] } }` (flattened field errors). |
| **401** | No session / invalid token | `"Unauthorized"` (text) or `{ "error": "Unauthorized" }` depending on path. |
| **500** | Scheduler or server error | `{ "error": "Failed to run schedule" }` |

Validation runs **before** the facade; invalid `timezone`, empty `tasks`, or invalid task/settings shapes yield 400 with `details`.

---

## Validation expectations and gaps

- **Enforced:** Non-empty `timezone`; at least one task; `title` min length 1; datetime fields with offset; enums for priority, status, energyLevel, preferredTime; numeric bounds for hours (0–23), workDays (0–6), positive `estimatedMinutes`.
- **Gaps:**
  - **timezone:** Not validated against the IANA timezone database. Invalid names may cause unexpected behavior in the scheduler or date lib.
  - **estimatedMinutes:** When null or omitted, the scheduler uses a default (30 minutes); the API doc should state this so clients know they can omit it.
  - **conflictWindows:** No validation that `end > start` for each window; overlapping windows are allowed and all are applied.

Runtime validation is performed by Zod in the route; there is no separate OpenAPI-generated validation. Adding IANA timezone validation and optional `end > start` for conflict windows would improve robustness.
