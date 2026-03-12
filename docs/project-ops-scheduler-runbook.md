# Project Ops Scheduler — Runbook

**Purpose:** Operational guide for running, testing, and debugging the Project Ops schedule API (`POST /api/projectops/schedule`). Internal use only.

**Related:** `docs/project-ops-scheduler-api.md`, `docs/project-ops-sample-payloads.md`, `docs/project-ops-auth-strategy.md`.

---

## 1. How to run locally

### Prerequisites

- Node.js (see `.nvmrc`; LTS recommended).
- PostgreSQL 16 (or use Docker for the DB).
- `.env` file (copy from `.env.example`).

### Steps

1. **Install dependencies**
   ```bash
   npm install --legacy-peer-deps
   ```
   On Windows with Node 25, if native modules fail: `npm install --legacy-peer-deps --ignore-scripts`.

2. **Database**
   - Ensure PostgreSQL is running.
   - Set `DATABASE_URL` in `.env` (e.g. `postgresql://fluid:fluid@localhost:5432/fluid_calendar` if using Docker only for DB).
   - Apply schema:
     ```bash
     npx prisma db push
     ```
     Or use migrations: `npx prisma migrate deploy`.

3. **Generate Prisma client**
   ```bash
   npx prisma generate
   ```

4. **Start the dev server**
   ```bash
   npm run dev
   ```
   App runs at `http://localhost:3000`. The schedule endpoint is `POST http://localhost:3000/api/projectops/schedule`.

For full Docker setup (app + DB), see `docs/local-setup-log.md`.

---

## 2. How to test the endpoint manually

- **Auth:** The route requires a valid NextAuth session. Log in via the app in a browser, then use the session cookie in requests.

- **Minimal curl (after logging in):**
  ```bash
  curl -X POST http://localhost:3000/api/projectops/schedule \
    -H "Content-Type: application/json" \
    -d '{"timezone":"America/New_York","tasks":[{"title":"Test task","estimatedMinutes":30}]}' \
    --cookie "next-auth.session-token=YOUR_SESSION_COOKIE"
  ```

- **Get the session cookie:** After signing in at `http://localhost:3000`, open DevTools → Application → Cookies → copy the value of `next-auth.session-token`.

- **Without auth:** You will get **401 Unauthorized**.

---

## 3. How to use sample payloads

See **docs/project-ops-sample-payloads.md** for four scenarios:

1. **Success** — Single task, open calendar; expect `success: true` and `scheduledStart` / `scheduledEnd`.
2. **Conflict** — Task overlapping calendar events; use FC calendar IDs in `selectedCalendars` or supply `conflictWindows` in the body.
3. **Timezone** — Non-UTC timezone; verify returned slot times fall in the requested work hours in that zone.
4. **Impossible / overdue** — No slots in window; expect `success: false` and `reason: "no_slots_in_window"` for that task.

**Example with a file:**
```bash
curl -X POST http://localhost:3000/api/projectops/schedule \
  -H "Content-Type: application/json" \
  -d @payload.json \
  --cookie "next-auth.session-token=YOUR_COOKIE"
```

Where `payload.json` contains a valid `ProjectOpsScheduleRequest` (timezone, tasks, optional settings and conflictWindows).

---

## 4. Required env / config

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Required for Prisma (temp tasks, scheduler writes). |
| `NEXTAUTH_SECRET` | Yes | NextAuth JWT secret (min 32 chars). Required for session auth. |
| `NEXTAUTH_URL` | Yes | Base URL of the app (e.g. `http://localhost:3000`). |
| `NEXT_PUBLIC_APP_URL` | No | Public app URL; may be used by auth callbacks. |

Optional: `RESEND_*` for email; not needed for the schedule API.

---

## 5. Common failure modes

| Symptom | Likely cause | What to do |
|---------|----------------|------------|
| **401 Unauthorized** | No session or invalid/expired token. | Log in again; ensure cookie is sent; check `NEXTAUTH_SECRET` is set. |
| **400 Invalid request body** | JSON parse error or Zod validation failed. | Check body: `timezone` non-empty, `tasks` array with at least one task, each task has `title`; datetime fields with offset. Inspect response `details` for field errors. |
| **500 Failed to run schedule** | Scheduler or DB error. | Check server logs (see §9); ensure DB is reachable; ensure Prisma schema is applied. |
| **Empty or wrong slots** | No slots in 7-day window; work hours too narrow; timezone mismatch. | Verify `timezone` and `settings.workHourStart` / `workHourEnd`; try wider hours or check `reason` in results. |
| **Tasks not avoiding conflicts** | `conflictWindows` not sent or wrong format; or using DB calendar with no events. | Send `conflictWindows` with ISO datetime strings; or attach calendar and use `selectedCalendars`. |
| **Prisma connection errors** | DB down or wrong `DATABASE_URL`. | Verify PostgreSQL is running; test connection string; run `npx prisma db push` or migrate. |

---

## 6. Debugging timezone issues

- **Check request:** Ensure `timezone` is a valid IANA name (e.g. `America/New_York`). It is passed straight to the scheduler; invalid names can cause unexpected behavior.
- **Check response:** `scheduledStart` and `scheduledEnd` are in ISO 8601 (UTC). Convert to the request timezone to verify they fall in work hours (e.g. 9–17 local).
- **Check settings:** `workHourStart` / `workHourEnd` are in the **user’s local day** (scheduler uses the requested `timezone`). If the slot appears outside 9–17, the timezone or work-hour mapping may be wrong.
- **Logs:** Search for `SchedulingService` or `projectops-schedulerFacade` to confirm the timezone value passed into the service.

---

## 7. Debugging overlap / conflict issues

- **Request-supplied conflicts:** If using `conflictWindows`, ensure each window has `start` and `end` as ISO 8601 strings with offset. The scheduler uses `ConflictWindowsCalendarService` only when `conflictWindows` is non-empty.
- **DB calendar path:** If not sending `conflictWindows`, the app uses `CalendarServiceImpl` (FC DB calendar events). Ensure the user has calendars and events in the range you’re scheduling; `selectedCalendars` in settings should include the relevant calendar IDs.
- **Verify adapter:** In code, when `request.conflictWindows?.length` is truthy, the facade instantiates `ConflictWindowsCalendarService(request.conflictWindows)`. Add a temporary log in the route or facade to confirm which path is used.
- **Tests:** Run `npm run test:unit -- --testPathPattern=ConflictWindowsCalendarService` to confirm boundary behavior (overlap, adjacent, batch).

---

## 8. Debugging auth failures

- **401 from API:** The route calls `authenticateRequest(request, logSource)` which uses `getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })`. No token → 401.
- **Checks:**  
  - `NEXTAUTH_SECRET` must be set and match the secret used when the session was created.  
  - Cookie name: typically `next-auth.session-token` (or `__Secure-next-auth.session-token` on HTTPS).  
  - Cookie must be sent with the request (same domain/path; not stripped by browser in same-origin dev).
- **Response body:** 401 may return plain text `Unauthorized` or JSON `{ "error": "Unauthorized" }` depending on path.
- **Service-to-server:** For server-to-server, session auth is not appropriate. See `docs/project-ops-auth-strategy.md` for API key or HMAC options (not yet implemented in code).

---

## 9. Logs to inspect

- **Route:** Log source `projectops-schedule-route`. Errors (e.g. validation, throw in handler) logged here.
- **Facade:** Log source `projectops-schedulerFacade`. Logs created-task mismatch, schedule run failures, and temp-task delete failures.
- **Scheduler:** Log source `SchedulingService`. Debug logs for “No available slots found” and performance metrics (if debug level enabled).

**Grep examples (server logs):**
```bash
# Route and facade
grep -E "projectops-schedule-route|projectops-schedulerFacade" logs.txt

# Scheduler
grep "SchedulingService" logs.txt
```

---

## 10. What still makes this internal-only

- **Temp task pattern:** The facade creates temporary tasks in the DB, runs the scheduler (which updates them), then deletes them. Not suitable for high concurrency or as a long-term production contract without rate limiting and isolation.
- **No rate limiting:** The endpoint does not throttle callers.
- **No service auth:** Only NextAuth session is implemented. Production server-to-server should use the strategy in `docs/project-ops-auth-strategy.md` (e.g. HMAC or API key) once implemented.
- **Not deployed as a standalone service:** Today the endpoint is part of the FluidCalendar app; extraction to a separate service is documented in `docs/scheduler-extraction-next-step.md` but not done.
- **Validation gaps:** See “Validation expectations and gaps” in `docs/project-ops-scheduler-api.md` (e.g. timezone not validated against IANA).

---

## 11. Quick test checklist

1. `npm run type-check` — passes.
2. `npm run test:unit -- --testPathPattern=projectops` — all projectops tests pass.
3. Start app; log in; send a minimal valid payload with session cookie — 200 and `results[0].scheduledStart` set.
4. Send invalid body (e.g. empty `tasks`) — 400 with `details`.
5. Send without cookie — 401.
