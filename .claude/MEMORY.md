# FluidCalendar - Session Memory

## Project
- Motion clone: calendar + task management with intelligent auto-scheduling
- Repo: https://github.com/dotnetfactory/fluid-calendar
- Dual build: SAAS (private) + Open Source (public)
- Stack: Next.js 15 / React 19 / TypeScript 5.8 / Prisma 6.3 / PostgreSQL 16

## Critical Patterns
- `npm install --legacy-peer-deps` ALWAYS
- Global Prisma from `@/lib/prisma` -- never `new PrismaClient()`
- Logger from `@/lib/logger` with `const LOG_SOURCE = "name"` -- never console.log
- Dates from `@/lib/date-utils` (`newDate()`) -- never raw date-fns or `new Date()`
- Calendar DB from `@/lib/calendar-db.ts` -- not raw prisma for calendar ops
- `docker compose` not `docker-compose`
- Commit prefix: `claude:`
- Ask before deciding SAAS vs OSS scope

## Architecture
- 59 API routes, 27 DB models, 35 migrations
- Scheduling engine: 7-factor weighted scoring (SlotScorer.ts)
  - Weights: deadline 3.0, priority 1.8, energy 1.5, time 1.2, work 1.0, buffer 0.8, project 0.5
- Calendar providers: Google (googleapis), Outlook (MS Graph), CalDAV (tsdav)
- Task sync providers: Google Tasks, Outlook Tasks via TaskProviderInterface
- State: 11 Zustand stores in src/store/
- Auth: NextAuth 4 JWT, user/admin roles

## Key DB Models
- Task (30+ fields, 15 indexes) -- most complex
- CalendarEvent (self-referencing for recurring)
- ConnectedAccount (OAuth tokens per provider)
- AutoScheduleSettings (work hours, energy mappings)
- SystemSettings (OAuth creds, log config, feature flags)

## Known Issues
- Auto-scheduling off-by-one day bug (schedules in the past)
- Recurring event deletion removes entire series
- Calendar cache invalidation not implemented
- Minimal test coverage

## Last Updated
2026-03-07 - Initial setup via Repo Intelligence Engine
