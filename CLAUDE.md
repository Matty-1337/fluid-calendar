# FluidCalendar

## Overview
Open-source calendar and task management app (Motion clone) with intelligent auto-scheduling. Dual-build: SAAS (private repo) and Open Source (https://github.com/dotnetfactory/fluid-calendar). Next.js 15 App Router with PostgreSQL, multi-provider calendar/task sync, and a 7-factor weighted scheduling algorithm.

## Quick Commands
```bash
npm install --legacy-peer-deps   # ALWAYS use --legacy-peer-deps
npm run dev                      # Dev server (Turbopack)
npm run build                    # Production build
npm run build:os                 # Open source build (SAAS disabled)
npm run lint                     # ESLint
npm run format                   # Prettier
npm run type-check               # TypeScript check
npm run test:unit                # Jest unit tests
npm run test:e2e                 # Playwright E2E tests
npm run db:up                    # Start PostgreSQL (Docker)
npm run redis:up                 # Start Redis (Docker)
npx prisma migrate dev           # Run migrations
npx prisma generate              # Generate Prisma client
npx prisma studio                # DB GUI
docker compose up -d             # Full stack (app + db)
npx shadcn@latest add <name>     # Add Shadcn component
```

## Tech Stack
- **Framework**: Next.js 15.3.8 (App Router + Turbopack) / React 19 / TypeScript 5.8
- **Styling**: Tailwind CSS 3.4 + Shadcn UI (Radix primitives)
- **State**: Zustand 4.5 (atomic stores with localStorage persist)
- **Database**: PostgreSQL 16 via Prisma 6.3 (27 models, 35 migrations)
- **Auth**: NextAuth 4.24 (JWT strategy, user/admin roles)
- **Calendar UI**: FullCalendar 6.1 (DayGrid, TimeGrid, MultiMonth)
- **Forms**: React Hook Form + Zod
- **Data Fetching**: TanStack React Query 5
- **Drag & Drop**: @dnd-kit
- **Calendar APIs**: googleapis (Google), @microsoft/microsoft-graph-client (Outlook), tsdav (CalDAV)
- **Task Sync**: Google Tasks, Outlook Tasks via provider interface
- **Background Jobs**: BullMQ + Redis (SAAS only)
- **Payments**: Stripe (SAAS only)
- **Email**: Resend (SAAS only)
- **Testing**: Jest + Playwright

## Project Structure
```
src/
  app/
    (common)/          - Shared pages (calendar, tasks, focus, settings, auth, setup)
    (open)/            - OSS-only pages (homepage, waitlist)
    (saas)/            - SAAS-only pages (private repo)
    api/               - 59 REST API route handlers
  components/          - React components organized by feature
    calendar/          - Calendar views, event modal, feed manager
    tasks/             - Task list, task item, task form
    focus/             - Focus mode components
    settings/          - Settings panels
    navigation/        - AppNav, UserMenu, ThemeToggle
    ui/                - Shadcn base components
    providers/         - SessionProvider, ThemeProvider, QueryProvider
    dnd/               - Drag and drop
  hooks/               - useAdmin, useCommands, usePageTitle
  lib/
    auth/              - authenticateRequest(), requireAdmin()
    calendar-db.ts     - ALL calendar DB operations (use this, not raw prisma)
    date-utils.ts      - ALL date functions (wraps date-fns, never use raw)
    logger/            - Structured logger (never use console.log)
    prisma.ts          - Global Prisma singleton (never new PrismaClient())
    config.ts          - Feature flags (isSaasEnabled, isFeatureEnabled)
    commands/          - Command palette registry
    task-sync/         - Task sync providers, manager, change tracker
    token-manager.ts   - OAuth token refresh management
    google-calendar.ts - Google Calendar API wrapper
    outlook-calendar.ts - Outlook Graph API wrapper
    caldav-calendar.ts - CalDAV protocol wrapper
    autoSchedule.ts    - Energy level helpers
  services/
    scheduling/        - Auto-scheduling engine (core business logic)
      SchedulingService.ts     - Orchestrator (batch=8, window escalation)
      SlotScorer.ts            - 7-factor weighted scoring
      TimeSlotManager.ts       - Available slot detection + conflict checking
      CalendarServiceImpl.ts   - Calendar conflict abstraction
      TaskSchedulingService.ts - High-level scheduling API
  store/               - 11 Zustand stores (calendar, task, settings, etc.)
  types/               - TypeScript interfaces and enums
prisma/
  schema.prisma        - 27 models
  migrations/          - 35 timestamped migrations
```

## Code Conventions

### API Routes
- Auth: `const auth = await authenticateRequest(request, LOG_SOURCE);`
- Admin: `const authResponse = await requireAdmin(request); if (authResponse) return authResponse;`
- Params (Next.js 15): `const { id } = await params;` (params is a Promise)
- Responses: `NextResponse.json(data)` for success, `new NextResponse("message", { status })` for errors
- Every route defines `const LOG_SOURCE = "descriptive-name";` at file top

### Database
- ALWAYS import `prisma` from `@/lib/prisma` -- never `new PrismaClient()`
- Import types from `@prisma/client`, client instance from `@/lib/prisma`
- Use `@/lib/calendar-db.ts` for ALL calendar-related DB operations
- Schema: cuid() IDs (uuid() for CalendarFeed/CalendarEvent), createdAt/updatedAt timestamps
- JSON string pattern: arrays stored as `String` with `@default("[]")` (e.g., workDays, selectedCalendars)
- Migration naming: `npx prisma migrate dev --name descriptive_snake_case`

### Logging
- ALWAYS use `import { logger } from "@/lib/logger"` -- never `console.log`
- Define `const LOG_SOURCE = "ComponentOrRouteName";` in every file that logs
- Pattern: `logger.error("Message", { error: error instanceof Error ? error.message : String(error) }, LOG_SOURCE)`

### Dates
- ALWAYS use functions from `@/lib/date-utils` -- never raw `date-fns` or `new Date()`
- Use `newDate()` instead of `new Date()`

### Components
- Shadcn: `npx shadcn@latest add <component>` (never manual)
- Icons: `react-icons` (not lucide-react for new icons)
- JSX entities: use `&apos;` and `&quot;` instead of quotes/apostrophes
- Feature folders: `src/components/<feature>/`
- Consider adding new features to cmdk commands (`src/lib/commands/`)

### SAAS vs Open Source
- `.saas.tsx`/`.saas.ts` -- SAAS-only (excluded from OSS build)
- `.open.tsx`/`.open.ts` -- OSS-only
- No extension -- included in both builds
- Route groups: `(saas)/`, `(open)/`, `(common)/`
- Feature flags: `isSaasEnabled` and `isFeatureEnabled()` from `@/lib/config.ts`
- Dynamic imports: `` dynamic(() => import(`./Component${isSaas ? ".saas" : ".open"}`)) ``
- When unsure if feature is SAAS or OSS, ask to confirm

### State Management
- Zustand stores in `src/store/` -- small, focused (atomic pattern)
- Persisted stores use localStorage with custom serializers
- Local state for component-specific data

### Git
- Commit prefix: `claude:` for AI-generated commits
- Use `docker compose` (not `docker-compose`)
- Update CHANGELOG.md under `[unreleased]` when making changes

## Environment Variables
```
DATABASE_URL                        # PostgreSQL connection string
NEXTAUTH_URL                        # App URL (http://localhost:3000)
NEXTAUTH_SECRET                     # Min 32 chars
NEXT_PUBLIC_APP_URL                 # Public app URL
NEXT_PUBLIC_SITE_URL                # Public site URL
NEXT_PUBLIC_ENABLE_SAAS_FEATURES    # "true" or "false"
RESEND_API_KEY                      # Email service (optional)
RESEND_FROM_EMAIL                   # From address (optional)
# Google/Outlook OAuth creds are stored in SystemSettings DB table, not env vars
# SAAS-only: STRIPE_PUBLIC_KEY, STRIPE_SECRET_KEY, INFISICAL_TOKEN
```

## NEVER DO
- Never use `new PrismaClient()` -- use `import { prisma } from "@/lib/prisma"`
- Never use `console.log` -- use `import { logger } from "@/lib/logger"`
- Never use `new Date()` or raw date-fns -- use `@/lib/date-utils`
- Never use `docker-compose` -- use `docker compose`
- Never use `npm install` without `--legacy-peer-deps`
- Never use `getServerSession` + manual role check -- use `requireAdmin` middleware
- Never remove `//todo` comments in code
- Never commit `.env` files
- Never modify SAAS code paths without confirming scope (SAAS vs OSS vs both)

## Known Issues
- Auto-scheduling sometimes creates tasks in the past (off-by-one day bug)
- Deleting one instance of a recurring event deletes entire series locally
- Hide upcoming tasks filter not working correctly
- UI shows blank list after toggling auto-schedule without page refresh
- Calendar cache invalidation not implemented (CalendarServiceImpl TODO)
- Clear data functionality not implemented in DataSettings
- Minimal test coverage (8 test files, most conditionally skipped)

## Business Context

### Auto-Scheduling Algorithm
7-factor weighted scoring in `src/services/scheduling/SlotScorer.ts`:
- **deadlineProximity** (3.0x) -- highest weight; overdue tasks escalate 1.0-2.0
- **priorityScore** (1.8x) -- HIGH=1.0, MEDIUM=0.75, LOW=0.5, NONE=0.25
- **energyLevelMatch** (1.5x) -- matches task energy to time-of-day energy
- **timePreference** (1.2x) -- morning/afternoon/evening slot matching
- **workHourAlignment** (1.0x) -- within configured work hours
- **bufferAdequacy** (0.8x) -- adequate break between tasks
- **projectProximity** (0.5x) -- clusters same-project tasks

### Calendar Provider Architecture
Three providers (Google, Outlook, CalDAV) with:
- OAuth token refresh via `src/lib/token-manager.ts`
- Incremental sync with syncToken (Google) / ctag (CalDAV)
- Webhook support for real-time updates (Google Calendar channels)
- All DB operations through `src/lib/calendar-db.ts`
- ConnectedAccount model stores OAuth tokens per provider

### Task Sync Architecture
Provider interface at `src/lib/task-sync/providers/task-provider.interface.ts`:
- 11 required methods (getType, getName, getTaskLists, getTasks, createTask, updateTask, deleteTask, getChanges, validateConnection, mapToInternalTask, mapToExternalTask)
- Field mappers translate status/priority/recurrence between systems
- TaskChangeTracker enables bidirectional sync
- Currently supports: Google Tasks, Outlook Tasks
