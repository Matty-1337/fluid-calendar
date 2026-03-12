# Project Ops — Hosting Strategy for FluidCalendar Integration

**Date:** 2025-03-07  
**Purpose:** Evaluate how the scheduler (or FluidCalendar) should be hosted when integrating with Project Ops.

---

## 1. Options Evaluated

### A. FluidCalendar as separate Railway service (API sync with Project Ops)

- **Setup:** Deploy FluidCalendar to Railway (see docs/railway-deploy.md). Project Ops calls `POST /api/projectops/schedule` (or a dedicated public schedule API) with task DTOs; FluidCalendar returns slots. Project Ops persists the chosen slots in its own DB.
- **Pros:** Clear boundary; FC stack unchanged; can use existing auth (API key or service account). Good for short-term validation.
- **Cons:** Two services to run and monitor; sync latency; FluidCalendar’s DB and auth are still in the loop for the PoC (we create temp tasks there). For a true “scheduler-only” API, FC would need to support request-scoped scheduling without persisting tasks (facade returns slots only; today we create/delete temp tasks).
- **Env/credentials:** DATABASE_URL, NEXTAUTH_*, calendar OAuth if conflict check uses FC calendars. Project Ops needs a way to authenticate to FC (e.g. API key in header, or internal network if both on same platform).

### B. Scheduler extraction into Project Ops repo directly

- **Setup:** Copy or extract `SlotScorer`, `TimeSlotManager`, `SchedulingService` (with abstractions for task source, event source, task writer) into Project Ops codebase. Call in-process; no HTTP to FluidCalendar.
- **Pros:** Single repo and deployment; no second service; Project Ops owns the code and can fix overlap/buffer/cache. Best long-term if Project Ops is the only consumer.
- **Cons:** Effort to abstract Prisma and calendar (see docs/scheduler-extraction-dependency-map.md); must maintain the extracted code and keep it in sync with any FC fixes (or take full ownership).
- **Env/credentials:** Same as Project Ops (no extra FC env). Calendar events for conflicts must come from Project Ops or a shared calendar API.

### C. Hybrid: scheduler as internal package or microservice

- **Setup:** Extract the scheduler into a separate npm package or small Node service (e.g. “@company/scheduler”) used by Project Ops (and optionally by FluidCalendar). Deploy the package as a dependency of Project Ops, or deploy the small service and call it via HTTP.
- **Pros:** Reusable; one place to fix bugs; can be used by multiple apps.
- **Cons:** Extra package or service to maintain; versioning and deployment pipeline.

### D. Keep local/internal until stabilized

- **Setup:** Do not deploy FluidCalendar or the scheduler to production. Run FC locally or in a dev/staging environment; use the PoC API for integration testing. Project Ops integration is “feature-flagged” or dev-only until overlap, tests, and hardening are done.
- **Pros:** No production risk; time to add tests and fix B2/B8/B9.
- **Cons:** No production validation; delays real usage.

---

## 2. Recommendation

- **Short term:** **Option D** — Keep the PoC internal. Use the new `POST /api/projectops/schedule` and sample payloads (docs/project-ops-sample-payloads.md) for dev/staging only. Add tests (timezone, overlap) and fix critical bugs (B2, B7) before exposing to production.
- **Medium term:** Choose based on Phase 2 architecture:
  - If **Option C (extraction)** is the primary path: extract the scheduler into an internal package or microservice; Project Ops (and optionally FC) depend on it. Host the microservice on Railway or in the same platform as Project Ops if HTTP is used.
  - If **Option A (sidecar)** is sufficient: Deploy FluidCalendar on Railway; add a dedicated API key or internal auth for Project Ops; document env vars and callback URLs (see docs/railway-deploy.md). Project Ops calls FC’s schedule API and writes results back to its own store.

**Railway suitability:** FluidCalendar is suitable for Railway (Next.js, PostgreSQL, stateless). Use one web service + one DB; set DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET; run migrations on deploy. For the PoC route, no extra env is required beyond what FC already needs.

**Why not in main Project Ops repo yet:** The scheduler currently depends on Prisma Task, AutoScheduleSettings, and CalendarServiceImpl (Prisma events). Inlining it into Project Ops would require either (1) copying the FC scheduler code and replacing Prisma with Project Ops data access, or (2) calling FC via HTTP. (1) is the extraction path (Option C/B); (2) is the sidecar path (Option A). Until extraction is done or the sidecar is chosen, the “integration” lives in the FluidCalendar repo as the PoC adapter and API route.

---

## 3. Env and Auth Implications

| Deployment | Env vars | Auth |
|------------|----------|------|
| FC on Railway | DATABASE_URL, NEXTAUTH_URL, NEXTAUTH_SECRET, NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_SITE_URL | NextAuth for FC app; for Project Ops → FC API, add API key or use same auth domain. |
| Scheduler in Project Ops | None extra | Project Ops auth; scheduler runs in-process. |
| Scheduler microservice | Service URL, optional API key | Project Ops calls with API key or internal network auth. |

**Calendar provider credentials:** If conflict check uses Google/Outlook, credentials live in FC’s SystemSettings (or env). If Project Ops passes conflict windows in the request, no calendar credentials are needed in the scheduler for that request.

---

## 4. Summary

- **Best architecture for production:** Scheduler extraction (Option C) with Project Ops as sole consumer, or sidecar FC (Option A) if we keep FC deployed and add a stable schedule API.
- **Best immediate step:** Keep PoC internal (Option D); add tests and fix bugs; then decide between A and C and document the chosen hosting in the final decision doc.
