# FluidCalendar - Codebase Analysis

**Generated:** 2026-03-07
**Analyzed by:** Claude Code (Repo Intelligence Engine)

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router + Turbopack) | 15.3.8 |
| UI | React | 19.0.3 |
| Language | TypeScript (strict) | 5.8.2 |
| Styling | Tailwind CSS + Shadcn/Radix UI | 3.4.1 |
| State | Zustand (with persist middleware) | 4.5.0 |
| Database | PostgreSQL via Prisma ORM | PG 16 / Prisma 6.3.1 |
| Auth | NextAuth (JWT strategy) | 4.24.11 |
| Calendar UI | FullCalendar (DayGrid, TimeGrid, MultiMonth) | 6.1.15 |
| Forms | React Hook Form + Zod | 7.54.2 / 3.24.2 |
| Data Fetching | TanStack React Query | 5.74.4 |
| Drag & Drop | @dnd-kit (core, sortable) | 6.3.1 |
| Date Handling | date-fns + date-fns-tz | 3.6.0 |
| Recurrence | rrule | 2.8.1 |
| Background Jobs | BullMQ + Redis (SAAS only) | 5.41.9 |
| Payments | Stripe | 18.0.0 |
| Email | Resend | 4.1.2 |
| Icons | react-icons, lucide-react, heroicons | various |
| Animations | framer-motion | 12.9.2 |
| Command Palette | cmdk | 1.0.4 |
| Testing | Jest + Playwright | 29.7.0 / 1.50.1 |
| Code Quality | ESLint 9, Prettier, Husky + lint-staged | various |

## Architecture

### App Router Structure
```
src/app/
  (common)/     - Shared pages (calendar, tasks, focus, settings, auth, setup)
  (open)/       - Open source only (homepage, waitlist settings)
  (saas)/       - SAAS only (private repo)
  api/          - 59 API route handlers
```

### Service Layer
```
src/services/scheduling/
  SchedulingService.ts    - Orchestrates multi-task scheduling (batch=8, window escalation)
  SlotScorer.ts           - 7-factor weighted scoring algorithm
  TimeSlotManager.ts      - Finds available time slots, conflict detection
  CalendarServiceImpl.ts  - Calendar conflict checking abstraction
  TaskSchedulingService.ts - High-level scheduling API
```

### Integration Layer
```
src/lib/
  google-calendar.ts      - Google Calendar API v3
  outlook-calendar.ts     - Microsoft Graph API
  caldav-calendar.ts      - CalDAV/WebDAV protocol (tsdav)
  token-manager.ts        - OAuth token lifecycle management
  task-sync/
    task-sync-manager.ts  - Multi-provider task sync orchestration
    task-change-tracker.ts - Bidirectional change tracking
    providers/
      task-provider.interface.ts - Provider contract
      outlook-provider.ts        - Outlook Tasks implementation
      google-provider.ts         - Google Tasks implementation
      outlook-field-mapper.ts    - Outlook field mapping
      google-field-mapper.ts     - Google Tasks field mapping
```

### State Layer (11 Zustand stores)
```
src/store/
  calendar.ts              - Calendar events, feeds, UI state
  task.ts                  - Task list, filters, CRUD
  settings.ts              - User preferences (persisted)
  focusMode.ts             - Focus mode state
  project.ts               - Project management
  taskListViewSettings.ts  - View preferences (persisted)
  taskModal.ts             - Task creation/edit modal
  setup.ts                 - Setup flow state
  logview.ts               - Log viewer state
  calendarUI.ts            - Calendar sidebar state
  view.ts                  - Current view + date (persisted)
```

## Code Patterns

### API Route Pattern (all 59 routes follow this)
```typescript
const LOG_SOURCE = "route-name";
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) return auth.response;
    const userId = auth.userId;
    // ... business logic with prisma
    return NextResponse.json(data);
  } catch (error) {
    logger.error("Message", { error: error instanceof Error ? error.message : String(error) }, LOG_SOURCE);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
```

### Shared Utilities (by import count)
1. `@/lib/logger` - 88 imports (structured logging with source tracking)
2. `@/lib/prisma` - 70 imports (global Prisma singleton)
3. `@/lib/auth/api-auth` - 45 imports (authenticateRequest, requireAdmin)
4. `@/lib/utils` - 43 imports (cn() class merging, general utils)
5. `@/lib/date-utils` - 42 imports (wraps date-fns/date-fns-tz)
6. `@/types/task` - 39 imports (TaskStatus, Priority, EnergyLevel, TimePreference enums)

### Naming Conventions
- **Files**: kebab-case for utilities (`date-utils.ts`), PascalCase for components (`TaskItem.tsx`)
- **Functions/Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE (`LOG_SOURCE`, `DEFAULT_TASK_COLOR`)
- **Types/Interfaces**: PascalCase
- **Enums**: PascalCase names, UPPER_SNAKE_CASE values
- **DB columns**: camelCase (Prisma convention)
- **API routes**: kebab-case directories

### Import Ordering (enforced by Prettier plugin)
1. React/Next.js imports
2. Third-party libraries
3. Internal components (`@/components/`)
4. Types (`@/types/`)
5. Utilities and hooks (`@/lib/`, `@/hooks/`, `@/store/`)

### SAAS/OSS Dual Build
- `.saas.tsx`/`.saas.ts` - SAAS-only (excluded from OSS build)
- `.open.tsx`/`.open.ts` - OSS-only
- No extension - both builds
- Dynamic import: `dynamic(() => import(\`./Component\${isSaas ? ".saas" : ".open"}\`))`
- Feature flags: `isSaasEnabled`, `isFeatureEnabled()` from `@/lib/config.ts`

## Business Logic Hot Spots

### Auto-Scheduling Engine (`src/services/scheduling/`)
7-factor weighted scoring:
| Factor | Weight | Description |
|--------|--------|-------------|
| deadlineProximity | 3.0 | Overdue tasks escalate (1.0-2.0), future tasks decay exponentially |
| priorityScore | 1.8 | HIGH=1.0, MEDIUM=0.75, LOW=0.5, NONE=0.25 |
| energyLevelMatch | 1.5 | Matches task energy to time-of-day energy levels |
| timePreference | 1.2 | Morning/afternoon/evening slot matching |
| workHourAlignment | 1.0 | Binary: within work hours or not |
| bufferAdequacy | 0.8 | Binary: has buffer time between tasks |
| projectProximity | 0.5 | Exponential decay clustering same-project tasks |

### Task Sync System (`src/lib/task-sync/`)
- Provider interface with 11 required methods
- Field mappers translate between internal/external formats
- TaskChangeTracker for bidirectional sync
- Supports: Google Tasks, Outlook Tasks (CalDAV planned)

### Calendar Integration
- Three providers: Google (googleapis), Outlook (Microsoft Graph), CalDAV (tsdav)
- Token refresh via TokenManager
- Incremental sync with syncToken/ctag
- Webhook support (Google channelId/resourceId)
- All DB ops through `@/lib/calendar-db.ts`

## Database

- **27 models** in Prisma schema
- **35 migrations** (timestamped, latest: 20250425231923)
- **IDs**: cuid() for most models, uuid() for CalendarFeed/CalendarEvent
- **Timestamps**: createdAt/updatedAt on all models
- **JSON string pattern**: workDays, selectedCalendars, workingHoursDays stored as JSON strings
- **Indexes**: Strategic on userId, status, dates, externalIds, foreign keys

### Key Models
- **User** (27 relations) - Central entity
- **Task** (15 indexes, 30+ fields) - Most complex model
- **CalendarEvent** (self-referencing for recurring instances)
- **ConnectedAccount** (OAuth tokens, multi-provider)
- **AutoScheduleSettings** (work hours, energy mappings, buffer config)
- **SystemSettings** (OAuth creds, logging config, feature flags)

## Key Metrics
- Total TypeScript/TSX files: 282
- Total lines of code: ~9,300
- Prisma models: 27
- Prisma migrations: 35 (latest: 20250425231923)
- API routes: 59 endpoints
- Frontend pages: 7
- Zustand stores: 11
- React components: ~99
- External integrations: Google Calendar, Google Tasks, Microsoft Graph (Outlook), CalDAV, Stripe, Resend

## Known Issues (from TODO.md and code)
- Auto-scheduling creates tasks in the past (off by one day)
- Deleting one recurring event instance deletes entire series locally
- Hide upcoming tasks filter not working correctly
- UI blank list after toggling auto-schedule without refresh
- CalendarServiceImpl TODO: cache invalidation on sync/CRUD
- DataSettings: clear data functionality not implemented
- Minimal test coverage (8 test files, most conditionally skipped)
