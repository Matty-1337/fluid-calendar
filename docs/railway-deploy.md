# FluidCalendar — Railway Deployment

**Date:** 2025-03-07

---

## 1. Suitability

Railway is a suitable host for this stack:

- **Next.js 15** with standalone output runs as a single Node process; Railway supports Node and Docker.
- **PostgreSQL** is available as a Railway plugin or external (e.g. Neon, Supabase); the app expects `DATABASE_URL`.
- **Stateless app:** No local disk requirement; session is JWT (NextAuth). File storage not used for core scheduling.
- **Build:** Repo has `output: "standalone"` in `next.config.js` and a production Dockerfile (`docker/production/Dockerfile`) that copies `.next/standalone` and runs `node server.js`. Railway can use Nixpacks (detect Node + build) or Docker.

**Note:** The repo has both `next.config.ts` (minimal) and `next.config.js` (with `output: "standalone"`). Ensure the build uses the config that sets `output: "standalone"` (e.g. use `next.config.js` or add `output: "standalone"` to `next.config.ts` and remove the duplicate).

---

## 2. Deployment Architecture

```mermaid
flowchart LR
  subgraph railway [Railway]
    Web[Web Service]
    Web --> DB[(PostgreSQL)]
  end
  User[Users] --> Web
  Web --> Google[Google OAuth]
  Web --> Microsoft[Microsoft OAuth]
```

- One Railway **service** for the Next.js app (Node or Docker).
- One **PostgreSQL** database (Railway PostgreSQL plugin or attached external DB).
- Environment variables for `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, and optional Google/Outlook credentials.

---

## 3. Required Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string (e.g. `postgresql://user:pass@host:5432/fluid_calendar`). |
| `NEXTAUTH_URL` | Yes | Full app URL (e.g. `https://your-app.up.railway.app`). |
| `NEXTAUTH_SECRET` | Yes | Random string ≥32 chars for session encryption. |
| `NEXT_PUBLIC_APP_URL` | Recommended | Same as `NEXTAUTH_URL` for client. |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Same as `NEXTAUTH_URL`. |
| `NEXT_PUBLIC_ENABLE_SAAS_FEATURES` | Optional | Set to `false` for OSS (default). |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional | For password reset email. |
| Google / Outlook credentials | Optional | For calendar sync; can be set in UI (System Settings) or via env (see README). |

---

## 4. Railway Setup Steps

### Option A: Deploy from GitHub (Nixpacks)

1. Create a new project on Railway; connect the `fluid-calendar` repo.
2. Add **PostgreSQL** (Railway plugin or “New” → Database → PostgreSQL). Copy the `DATABASE_URL` from the service variables.
3. Add a **Web Service**; select the same repo. Railway will detect Node and run `npm install` and `npm run build`. Set **Root Directory** if the app is in a subdirectory.
4. In the service **Variables**, set:
   - `DATABASE_URL` = (from PostgreSQL service)
   - `NEXTAUTH_URL` = `https://<your-service>.up.railway.app`
   - `NEXTAUTH_SECRET` = (generate a 32+ char secret)
   - `NEXT_PUBLIC_APP_URL` = same as `NEXTAUTH_URL`
   - `NEXT_PUBLIC_SITE_URL` = same as `NEXTAUTH_URL`
5. **Build command:** `npm run build` (or `npm run build:os` for OSS-only). **Start command:** `npm start` (runs `next start`). For standalone, the start command must run the built app; if the Nixpacks build does not produce standalone, use Option B (Docker).
6. **Migrations:** Run once after first deploy: in Railway shell or locally with `DATABASE_URL` set, run `npx prisma migrate deploy`.
7. Open the generated URL; complete in-app setup (admin, system settings).

### Option B: Deploy with Docker

1. Use the **Dockerfile** in the repo. The root `Dockerfile` has a production stage that expects `npm run build` to produce `.next/standalone`. Ensure `next.config` has `output: "standalone"`.
2. In Railway: New Service → **Dockerfile**; point to the repo and Dockerfile path (e.g. `docker/production/Dockerfile` or root `Dockerfile` with target `production`).
3. Add PostgreSQL and set `DATABASE_URL` as above. The image runs `entrypoint.sh`: waits for DB, runs `prisma generate` and `prisma migrate deploy`, then `node server.js`. So migrations run on each deploy (idempotent).
4. Set the same variables as in Option A. Expose port **3000**; Railway maps it to the public URL.

---

## 5. Database and Migrations

- **First run:** If using Docker + entrypoint, migrations run automatically. If using Nixpacks and `npm start`, run migrations once: `npx prisma migrate deploy` (e.g. in a one-off shell or in a deploy script).
- **Schema:** All migrations are in `prisma/migrations/`. No manual SQL required if migrations are applied in order.

---

## 6. Auth and Provider Callbacks

- **NextAuth:** Set `NEXTAUTH_URL` to the exact public URL (e.g. `https://fluidcalendar-production.up.railway.app`). NextAuth uses it for redirects and session cookies.
- **Google OAuth:** In Google Cloud Console, add to **Authorized redirect URIs**: `https://<your-domain>/api/auth/callback/google`. Add the same origin to **Authorized JavaScript origins**.
- **Azure AD (Outlook):** In Azure app registration, add **Redirect URI**: `https://<your-domain>/api/auth/callback/azure-ad`.

---

## 7. Expected Pitfalls

1. **Standalone vs default build:** If the build does not use `output: "standalone"`, `node server.js` (Docker) or a custom start will fail. Confirm `next.config.js` (or .ts) has `output: "standalone"` and is the one used at build time.
2. **DATABASE_URL at build time:** Prisma Generate can run without a DB; `prisma migrate deploy` needs `DATABASE_URL` at runtime (entrypoint handles this).
3. **Cold starts:** First request after idle can be slow; consider a health check or keep-warm if needed.
4. **File system:** App is stateless; no writable volume required. Logs go to stdout (Railway captures them).
5. **Docker Compose:** Not used on Railway; use one web service + one DB (or external DB). No need for docker-compose on the platform.

---

## 8. If Not Using Railway

- **Vercel:** Fits Next.js but requires external PostgreSQL and serverless-compatible Prisma usage; current app uses long-running Node and Prisma in API routes, which is supported with some limits.
- **Fly.io / Render:** Same idea as Railway: Node service + Postgres; use Docker or buildpack. Steps are similar (env vars, migrations, callback URLs).
- **Self-hosted VPS:** Use the same Dockerfile and `docker-compose.yml`; point `NEXTAUTH_URL` and `DATABASE_URL` at the VPS domain and DB.
