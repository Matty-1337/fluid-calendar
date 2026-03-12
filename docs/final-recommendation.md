# FluidCalendar — Final Go / No-Go Recommendation

**Date:** 2025-03-07  
**Evaluation scope:** Repo intake, architecture audit, local setup attempt, bug triage, timezone fix, testing review, Railway deployment path, Project Ops integration feasibility.

---

## 1. Executive Summary

FluidCalendar is a **usable but unstable** open-source task scheduler with a **deterministic, heuristic scheduling core** that is **extractable and suitable as a reference or embedded engine** for Project Ops. The repo is not production-ready as shipped: the maintainer warns it is buggy, and we confirmed timezone and overlap issues plus gaps in tests and server-side hardening. We **fixed the critical timezone bug** (auto-schedule now uses the user’s timezone from the DB when run from the API). **Recommendation:** **Do not deploy as-is for production.** Use it as **inspiration and a source for the scheduling algorithm**—either **fork and extract** the scheduler into your stack or **deploy internally for testing only** while you validate behavior and fix overlap/cache issues. For Project Ops, the best path is **Option B or C** in the integration plan: embed or fork the scheduling logic and call it with Project Ops tasks and settings via API or in-process.

---

## 2. What Works Today

- **Scheduling algorithm:** Rule-based scoring (work hours, energy, deadline, priority, project proximity, buffer, time preference). Slot generation, conflict detection with calendar events and existing scheduled tasks, and weighted scoring are implemented and coherent.
- **Tech stack:** Next.js 15, Prisma, PostgreSQL, NextAuth (credentials + Google + Azure AD). FullCalendar UI, multi-calendar (Google, Outlook, CalDAV), task sync (Google Tasks, Outlook To Do).
- **Data model:** Tasks, projects, tags, auto-schedule settings, user settings (including timezone), calendar feeds and events. Sufficient for scheduling and calendar conflict checks.
- **API:** Authenticated REST-style routes for tasks, schedule-all, settings, calendar, feeds. Schedule-all correctly loads user settings and (after our fix) user timezone and runs the scheduler.
- **Docker:** Pre-built image and docker-compose for app + PostgreSQL. Entrypoint runs migrations. Works when Docker daemon is running; use `docker-compose` (hyphen) on Windows.
- **Deployment path:** Standalone Next.js output and production Dockerfile are present; Railway (or similar) deployment is feasible with documented env vars and callbacks.

---

## 3. What Is Broken or Risky Today

- **Timezone (fixed in this evaluation):** Auto-schedule previously used the client-only Zustand store on the server, so slots were effectively in server/default TZ. **Fixed:** Timezone is now read from `UserSettings.timeZone` and passed through to the scheduler when running from the API.
- **Overlaps (#150):** Tasks can be scheduled between or overlapping existing events in some cases; batch conflict or slot-boundary logic needs verification and tests.
- **Docker quick start (#151):** Environment-dependent (e.g. Docker daemon not running, or `docker compose` vs `docker-compose`). Documented in local-setup-log.
- **Settings page (#149):** “Something went wrong” reported; unhandled error in settings load/render.
- **Multi-account (Google #141, CalDAV #145):** Adding multiple accounts is limited or broken.
- **Buffer and cache:** Buffer time is only scored, not enforced; event cache in CalendarServiceImpl may be stale after sync/CRUD (no invalidation).
- **Test coverage:** No tests for scheduler, timezone, or overlap; regression risk is high.
- **Server-side store fallback:** SchedulingService can still fall back to client store when no settings are passed; only safe when called from TaskSchedulingService (which always passes DB settings).

---

## 4. Estimated Effort to Stabilize

| Area | Effort | Notes |
|------|--------|-------|
| Overlap and conflict logic | 2–5 days | Reproduce #150, fix slot/event boundary handling, add unit tests. |
| Settings page and error handling | 1–2 days | Fix #149, add error boundaries and logging. |
| Multi-account (Google/CalDAV) | 2–4 days | Schema and UI/API for multiple connected accounts. |
| Buffer enforcement | 1–3 days | Implement “no scheduling in buffer” or reserve buffer in slot generation. |
| Cache invalidation | 0.5–1 day | Invalidate CalendarServiceImpl cache on event/feed changes. |
| Scheduler + timezone tests | 2–3 days | Unit tests for SlotScorer, TimeSlotManager (timezone, conflicts), date-utils. |
| Remove server store fallback | 0.5 day | Require settings (and timezone) in server path; throw or reject otherwise. |

**Rough total to “reasonably stable for internal use”:** **2–4 weeks** (one developer), depending on how many of the above you tackle and how much E2E you add.

---

## 5. Estimated Effort to Integrate into Project Ops

| Approach | Effort | Notes |
|----------|--------|-------|
| **A. Standalone app** | Low (1–2 days) | Deploy FluidCalendar; users use both UIs; optional export/import. No deep integration. |
| **B. Embed scheduler (API or in-process)** | Medium (1–2 weeks) | Add “schedule these tasks” API or extract services into Project Ops; map tasks/settings; plug calendar source. |
| **C. Fork and extract** | Medium–High (2–4 weeks) | Fork repo; strip to scheduler + interfaces; replace Prisma with your data layer; maintain fork. |
| **D. Reference only** | High (4+ weeks) | Reimplement scoring and slot logic in your stack; no dependency on FluidCalendar code. |

For **Project Ops as source of truth** and a single UX, **B or C** is the right target; effort above is a reasonable range.

---

## 6. Recommendation: Which Option to Choose

| Option | When to choose |
|--------|----------------|
| **Abandon it** | Not recommended. The scheduling idea and code are useful; abandoning loses a concrete implementation and reference. |
| **Use as inspiration only** | Choose if you want full control and are willing to reimplement (Option D). |
| **Fork and improve it** | Choose if you want to own the codebase, fix bugs, and eventually use it as the base of your scheduling layer (Option C). |
| **Deploy internally for testing only** | Choose to validate behavior with real users and calendars before committing to fork or embed. Use our timezone fix and the Railway/local-setup docs. |
| **Use as the base of our scheduling layer** | Choose only after stabilizing overlap, tests, and hardening (and optionally extracting to a service). Then use as in B or C. |

**Concrete recommendation:**  
- **Short term:** **Deploy internally for testing only** (with the timezone fix applied). Do not rely on it for production until overlap and critical bugs are fixed and tests are added.  
- **Medium term:** **Fork and improve** or **embed the scheduler** (B/C). Add an API that accepts Project Ops tasks and settings (including timezone) and returns or applies schedules; keep Project Ops as source of truth.  
- **Do not** treat the current upstream repo as a production dependency without a stabilization period and your own tests.

---

## 7. Top 10 Technical Risks

1. **Overlap bug (#150)** — Tasks scheduled in slots that conflict with calendar events; user trust and calendar integrity at risk.
2. **No scheduler tests** — Regressions (timezone, scoring, conflicts) are likely and hard to catch.
3. **Client store on server** — Remaining use of Zustand in server path (e.g. SchedulingService fallback) can cause wrong settings in edge cases.
4. **Event cache staleness** — Stale calendar events can lead to double-booked slots after sync or CRUD.
5. **Buffer not enforced** — User preference for buffer time is not guaranteed; back-to-back scheduling possible.
6. **Multi-account and settings bugs** — Limits or errors when adding accounts or opening settings; affects power users and admins.
7. **Dependency and native build** — `better-sqlite3` and Node 25 / Windows toolchain can block local install; Docker avoids this.
8. **Next config duality** — Both `next.config.ts` and `next.config.js`; wrong one may be used and drop `output: "standalone"` for Docker.
9. **Security and secrets** — Google/Outlook credentials in DB or env; ensure no exposure and follow least privilege.
10. **Scaling and concurrency** — Scheduler is synchronous per user; many users or large task sets may need batching or queue (not in scope of current eval).

---

## 8. Recommended Next Steps

1. **Start Docker** and run the app (see local-setup-log). Manually test sign-in, task CRUD, and “Schedule all” with the timezone fix; try to reproduce overlap (#150) and settings error (#149).
2. **Add tests** for SlotScorer, TimeSlotManager (timezone + conflicts), and overlap behavior (see testing-hardening.md).
3. **Fix overlap** (#150): trace conflict and slot logic, add tests, then fix and re-test.
4. **Harden server path:** Ensure scheduler is never called without DB-backed settings and timezone; remove or restrict store fallback.
5. **Decide integration shape:** Standalone (A), embed (B), fork (C), or reimplement (D). Then implement the chosen approach (API or in-process, field mapping, calendar source).
6. **If deploying to Railway:** Follow railway-deploy.md; run migrations; set NEXTAUTH_URL and provider callbacks; monitor logs and fix any config issues (e.g. standalone build).

---

## 9. Deliverables Produced in This Evaluation

- **docs/fluidcalendar-audit.md** — Architecture, scheduler, auth, calendar, data model, risks, extractability.
- **docs/local-setup-log.md** — Clone, Docker, local install, blockers, exact commands.
- **docs/bug-triage.md** — Bug table, prioritization, timezone fix noted.
- **docs/testing-hardening.md** — Current coverage, gaps, suggested tests.
- **docs/railway-deploy.md** — Suitability, env vars, setup steps, pitfalls.
- **docs/project-ops-integration-plan.md** — Options A–D, iframe, API, coupling, field mapping, recommendations.
- **docs/final-recommendation.md** — This document.
- **docs/change-log.md** — Summary of changes and findings.
- **Code change:** Timezone fix in TimeSlotManager, SchedulingService, TaskSchedulingService (user timezone from DB when scheduling via API).
