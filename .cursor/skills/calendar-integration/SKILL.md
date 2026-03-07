---
name: calendar-integration
description: >
  Work with calendar provider integrations (Google, Outlook, CalDAV).
  Use when adding calendar features, fixing sync issues, or modifying
  calendar event handling. Triggers: "calendar sync", "Google Calendar",
  "Outlook calendar", "CalDAV", "calendar events", "calendar feed",
  "OAuth token", "webhook", "sync token". Covers auth flows, sync
  patterns, and event CRUD for all three providers.
---

# Calendar Integration

## When to Use
- Adding or modifying calendar provider features
- Debugging sync issues
- Working with OAuth token refresh
- Handling calendar webhooks
- Modifying event CRUD operations

## Architecture Overview

### Three Providers
| Provider | Library | Auth | Sync Method |
|----------|---------|------|-------------|
| Google | `googleapis` | OAuth2 + refresh token | syncToken (incremental) |
| Outlook | `@microsoft/microsoft-graph-client` | MSAL OAuth2 | delta links |
| CalDAV | `tsdav` | Basic auth or OAuth | ctag + etag |

### Data Flow
```
External Calendar -> OAuth Auth -> ConnectedAccount (tokens)
                                -> CalendarFeed (feed config)
                                -> CalendarEvent (synced events)
```

### Key Files
- `src/lib/google-calendar.ts` - Google Calendar API wrapper
- `src/lib/outlook-calendar.ts` - Microsoft Graph wrapper
- `src/lib/caldav-calendar.ts` - CalDAV protocol wrapper
- `src/lib/google.ts` - Google OAuth client creation
- `src/lib/token-manager.ts` - Token lifecycle management
- `src/lib/calendar-db.ts` - ALL calendar DB operations
- `src/app/api/calendar/google/` - Google API routes (auth, events, sync)
- `src/app/api/calendar/outlook/` - Outlook API routes
- `src/app/api/calendar/caldav/` - CalDAV API routes
- `src/app/api/feeds/` - Feed management routes

### Database Models
- **ConnectedAccount** - OAuth tokens per provider (accessToken, refreshToken, expiresAt)
- **CalendarFeed** - Calendar subscription (type, syncToken, ctag, channelId)
- **CalendarEvent** - Synced events (externalEventId, recurring support)

## Key Patterns

### Token Refresh
```typescript
import { TokenManager } from "@/lib/token-manager";

const tokenManager = new TokenManager();
const freshToken = await tokenManager.getValidToken(connectedAccount);
```
TokenManager checks expiry and refreshes automatically before API calls.

### Calendar DB Operations
ALWAYS use helpers from `@/lib/calendar-db.ts`:
```typescript
import { createEvent, updateEvent, deleteEvent, getEventsByFeed } from "@/lib/calendar-db";
```
Do NOT use raw `prisma.calendarEvent` for calendar operations.

### Date Handling
```typescript
import { newDate, formatDate } from "@/lib/date-utils";
// Never use new Date() or raw date-fns
```

### Recurring Events
- Master event: `isMaster: true`
- Instances: `masterEventId` references the master
- Self-referencing relation in schema
- Recurrence rules stored as iCal RRULE strings

### Google Webhook Pattern
```typescript
// CalendarFeed stores:
channelId         // Google push notification channel
resourceId        // Google resource being watched
channelExpiration // When the watch expires
```

### Incremental Sync
- Google: `syncToken` on CalendarFeed (pass to list call, get new token back)
- CalDAV: `ctag` on CalendarFeed (compare to detect changes)
- Outlook: delta links via Microsoft Graph

## Adding a New Calendar Provider

1. Create `src/lib/<provider>-calendar.ts` with CRUD methods
2. Add API routes at `src/app/api/calendar/<provider>/`
3. Add provider type to ConnectedAccount (update schema if needed)
4. Implement token refresh in TokenManager
5. Add sync route with incremental sync support
6. Register in feed manager UI

## Common Pitfalls
- Not refreshing tokens before API calls (tokens expire in ~1 hour)
- Using raw Prisma instead of `calendar-db.ts` for event operations
- Not handling recurring event instances correctly (master vs instance)
- Missing `feedId` filter on event queries (shows events from other feeds)
- Forgetting timezone handling (use `@/lib/date-utils`)
