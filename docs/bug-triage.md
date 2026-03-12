# FluidCalendar — Bug Triage

**Date:** 2025-03-07  
**Scope:** Core workflows (sign-in, task CRUD, auto-schedule, calendar, settings). Based on code audit and known GitHub issues; manual testing deferred until Docker or local DB is available.

---

## Bug Table

| ID | Title | Severity | Reproduction | Suspected root cause | Files likely involved | Fix difficulty |
|----|--------|----------|--------------|----------------------|-----------------------|----------------|
| B1 | Auto-schedule ignores user timezone (schedules in UTC) | **Critical** | Set user TZ to non-UTC; run "Schedule all"; slots appear in UTC. | ~~TimeSlotManagerImpl read timezone from client-only Zustand store on server.~~ **Fixed:** Timezone now passed from UserSettings in TaskSchedulingService. | ~~TimeSlotManager.ts, SchedulingService.ts, TaskSchedulingService.ts~~ | **Done** |
| B2 | Tasks getting scheduled between events (overlap) | **Major** | Create calendar event 10–11; run auto-schedule; task may be placed 10–11. | Batch conflict check or slot boundary logic may allow adjacent/overlapping slots; or cache stale. | CalendarServiceImpl.ts (findConflicts, findBatchConflicts, cache), TimeSlotManager.ts (removeConflicts) | Moderate |
| B3 | Docker quick start not working | **Major** | Run `docker compose up -d` (or `docker-compose up -d`); failure or app not reachable. | Environment-specific: (1) Use `docker-compose` on Windows if `docker compose` unavailable; (2) Docker daemon must be running (pipe error otherwise). | docker-compose.yml, entrypoint.sh, .env | Easy (docs + ensure daemon running) |
| B4 | Settings page "Something went wrong!" | **Major** | Navigate to /settings (or fluidcalendar.com/settings). | Unhandled error in settings load or render (e.g. missing system settings, auth). | src/app/(common)/settings/, API routes for settings | Moderate |
| B5 | Cannot add multiple CalDAV providers | **Medium** | Add second CalDAV account. | Unique constraint or UI/API limiting one CalDAV per user. | prisma (ConnectedAccount @@unique), CalDAV auth/sync routes | Moderate |
| B6 | Several connected Google accounts | **Medium** | Connect second Google account for calendar. | Same as B5 for Google. | ConnectedAccount, calendar Google routes | Moderate |
| B7 | SchedulingService uses client store when no settings passed | **Medium** | (Hypothetical) Call SchedulingService without settings on server. | getTimeSlotManager() falls back to useSettingsStore.getState().autoSchedule. | SchedulingService.ts | Easy (require settings in server path or throw) |
| B8 | Buffer time not enforced for scheduling | **Low** | Schedule two tasks back-to-back; buffer preference may be ignored. | TODO in TimeSlotManager: only marks hasBufferTime, doesn’t prevent scheduling in buffer periods. | TimeSlotManager.ts (applyBufferTimes, generatePotentialSlots) | Hard |
| B9 | Event cache not invalidated on sync/CRUD | **Low** | Sync calendar or add event; run scheduler; old event set may be used. | CalendarServiceImpl cache keyed by week/calendars; no invalidation on write. | CalendarServiceImpl.ts (isCacheValid, getEvents) | Moderate |
| B10 | Strange auto-scheduling behavior (issue #118) | **Medium** | User-reported; exact steps unknown. | Likely scoring or slot ordering edge cases (e.g. due date, priority, multiple tasks). | SlotScorer.ts, SchedulingService.ts (sort order, windows) | Moderate |

---

## Prioritization (blocking real use)

1. **Critical:** B1 — **Fixed** in this evaluation (timezone from DB).
2. **Major:** B2 (overlaps), B3 (Docker), B4 (settings page). Address B3 via docs; B2 and B4 need reproduction and fix.
3. **Medium:** B5, B6 (multi-account), B7 (store fallback), B10. B7 is a small server-side hardening.

---

## Fixes applied in this evaluation

- **B1 (timezone):** TimeSlotManagerImpl now accepts optional `timeZoneOverride`. TaskSchedulingService fetches UserSettings and passes `userSettings.timeZone` into SchedulingService, which passes it to TimeSlotManagerImpl. When the schedule-all API runs on the server, the user’s timezone is used.

---

## Recommended next steps

1. Start Docker and run the app; verify B1 fix and reproduce B2/B4.
2. Add unit tests for slot scoring and conflict overlap (see testing-hardening.md).
3. Harden SchedulingService: when running on server, require settings (and timezone) instead of falling back to the client store.
