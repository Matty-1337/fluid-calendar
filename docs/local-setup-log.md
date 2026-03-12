# FluidCalendar — Local Setup Log

**Date:** 2025-03-07  
**Environment:** Windows 10, PowerShell, Node v25.2.1, Docker 29.1.3, docker-compose v2.40.3

---

## 1. Clone and Prepare

| Step | Command | Result |
|------|---------|--------|
| Clone repo | `git clone https://github.com/dotnetfactory/fluid-calendar.git fluid-calendar` | Success |
| Create .env | Copy `.env.example` to `.env`, set `NEXTAUTH_SECRET="fluidcalendar-eval-2025-secret-min32chars"` | Done |

---

## 2. Docker Setup (Recommended Path)

| Step | Command | Result |
|------|---------|--------|
| Start stack | `docker-compose up -d` | **Failed** — Windows: use `docker-compose` (hyphen), not `docker compose`. |
| Retry | `docker-compose up -d` | **Failed** — `unable to get image ... open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified` |

**Blocker:** Docker Desktop engine was not running. The pipe error means the Docker daemon is not available.

**Resolution:** Start Docker Desktop (or ensure the Docker service is running), then from the project root run:

```powershell
cd C:\Users\matt\fluid-calendar
docker-compose up -d
```

Compose file uses:
- **app:** pre-built image `eibrahim/fluid-calendar:latest`, port 3000, env from `.env`
- **db:** `postgres:16-alpine`, port 5432, healthcheck; app `depends_on: db` with `condition: service_healthy`

Entrypoint in the image runs `prisma generate`, `prisma migrate deploy`, then starts the app. No local build required when using the pre-built image.

---

## 3. Local Dev (Without Docker)

| Step | Command | Result |
|------|---------|--------|
| Install deps | `npm install --legacy-peer-deps` | **Failed** — `better-sqlite3` native build failed: no prebuilt binary for Node 25, node-gyp requires Visual Studio with "Desktop development with C++" workload. |
| Install (no scripts) | `npm install --legacy-peer-deps --ignore-scripts` | **Success** — 1233 packages. `better-sqlite3` not built (used only by root `migrate.js`, not by `src/`). |
| Prisma generate | `npx prisma generate` | Run after install (generates client from schema; no DB required). |
| Run dev server | `npm run dev` | Not run — requires `DATABASE_URL` to a running PostgreSQL. Without Docker, start Postgres locally or use a cloud instance and set `DATABASE_URL` in `.env` (use `postgresql://fluid:fluid@localhost:5432/fluid_calendar` if only `db` container is run). |

**Blockers for local run:**
1. **Node 25:** Repo targets Node 20 (see `.nvmrc` / Dockerfile). Node 25 works with `--ignore-scripts` but is untested; prefer Node 20 LTS for consistency.
2. **Native deps:** `better-sqlite3` build needs Visual Studio build tools on Windows if you do not use `--ignore-scripts`. Main app uses PostgreSQL only; `better-sqlite3` is only used by the standalone `migrate.js` script.
3. **Database:** App requires PostgreSQL. Easiest: start Docker Desktop and run `docker-compose up -d` (full stack) or run only the db service and point `.env` at `localhost:5432`.

---

## 4. Exact Commands Summary

**Recommended (Docker):**
```powershell
# Ensure Docker Desktop is running, then:
cd C:\Users\matt\fluid-calendar
copy .env.example .env
# Edit .env: set NEXTAUTH_SECRET to a random 32+ character string
docker-compose up -d
# Open http://localhost:3000
```

**Local dev (with existing PostgreSQL):**
```powershell
cd C:\Users\matt\fluid-calendar
npm install --legacy-peer-deps --ignore-scripts
npx prisma generate
# Set DATABASE_URL in .env to your Postgres (e.g. postgresql://fluid:fluid@localhost:5432/fluid_calendar)
# Run migrations: npx prisma migrate deploy
npm run dev
```

---

## 5. Remaining Setup Caveats

- **Google / Outlook:** Calendar and task sync require OAuth credentials in System Settings (or env). Core app (auth, tasks, scheduling) runs without them; calendar sync and conflict detection need at least one connected calendar.
- **First run:** On first load, the app may redirect to setup (admin user, system settings). Sign up or sign in with credentials provider after setup.
- **Public signup:** Controlled by `SystemSettings.publicSignup`; default may require admin invite or setup flow.
- **SaaS features:** Disabled when `NEXT_PUBLIC_ENABLE_SAAS_FEATURES=false` (default in `.env`). Billing, waitlist, and Stripe are inactive.

---

## 6. Resolved Items

- **Compose command:** On this Windows environment, use `docker-compose` (hyphen). The `docker compose` (space) subcommand was not available.
- **Docker not running:** Documented; user must start Docker Desktop before `docker-compose up -d`.
- **npm install failure:** Bypassed with `--ignore-scripts`; main app does not depend on `better-sqlite3` at runtime.
