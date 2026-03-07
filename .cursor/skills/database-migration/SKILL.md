---
name: database-migration
description: >
  Create Prisma database migrations following FluidCalendar schema conventions.
  Use when adding models, fields, indexes, or modifying the database schema.
  Triggers: "add migration", "new table", "add field", "database change",
  "schema update", "prisma migrate", "add column", "create model".
  Ensures correct ID types, timestamps, indexes, and naming.
---

# Database Migration

## When to Use
- Adding a new model to `prisma/schema.prisma`
- Adding fields to an existing model
- Adding indexes or unique constraints
- Changing field types or defaults

## Prerequisites
- PostgreSQL running: `npm run db:up`
- Prisma client generated: `npx prisma generate`

## Step-by-Step Process

### 1. Edit the schema
File: `prisma/schema.prisma`

### 2. New model template
```prisma
model NewModel {
  id        String   @id @default(cuid())
  // ... fields ...

  // User relationship (if per-user data)
  userId    String?
  user      User?    @relation(fields: [userId], references: [id])

  // Metadata (ALWAYS include)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Indexes
  @@index([userId])
}
```

### 3. Follow these conventions

**IDs:**
- Most models: `String @id @default(cuid())`
- CalendarFeed/CalendarEvent: `String @id @default(uuid())`

**Timestamps:**
- Always: `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`

**Indexes -- add `@@index` for:**
- All foreign keys (`userId`, `feedId`, `projectId`, etc.)
- Status/type fields used in WHERE clauses
- Date fields used in range queries
- External ID fields
- Composite: `@@index([field1, field2])` for multi-column lookups

**String enums (NOT Prisma enums):**
```prisma
status String // enum: 'active', 'inactive'
type   String // enum: 'google', 'outlook', 'caldav'
```
Only use Prisma `enum` for JobStatus, SubscriptionPlan, SubscriptionStatus (existing enums).

**JSON string arrays (NOT native JSON):**
```prisma
workDays String @default("[]")  // Parse with JSON.parse() in app code
```

**User relationship pattern:**
```prisma
userId String?
user   User?  @relation(fields: [userId], references: [id])
@@index([userId])
```
Add the reverse relation to the User model too.

### 4. Run the migration
```bash
npx prisma migrate dev --name descriptive_snake_case
npx prisma generate
```
Name examples: `add_task_postponed_field`, `create_task_change_model`, `add_sync_hash_to_task`

### 5. If adding a relation to User, update the User model
```prisma
model User {
  // ... existing fields ...
  newModels NewModel[]  // Add reverse relation
}
```

## Key Files
- `prisma/schema.prisma` - The schema (27 models currently)
- `prisma/migrations/` - 35 existing migrations
- `src/lib/prisma.ts` - Global client singleton

## Code Patterns
After migration, access new fields via the global prisma instance:
```typescript
import { prisma } from "@/lib/prisma";
import { NewModel } from "@prisma/client";  // Type import

const items = await prisma.newModel.findMany({ where: { userId } });
```

## Verification
1. Migration runs without errors
2. `npx prisma studio` shows new model/fields
3. `npm run type-check` passes (types auto-generated)
4. Existing tests still pass: `npm run test:unit`

## Common Pitfalls
- Forgetting `npx prisma generate` after migration
- Missing `@@index` on foreign keys (causes slow queries)
- Using native JSON instead of String for array fields (breaks existing pattern)
- Forgetting reverse relation on User model
- Using PascalCase for migration name (use snake_case)
- Not adding createdAt/updatedAt timestamps
