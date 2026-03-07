---
name: add-api-endpoint
description: >
  Create new Next.js API route handlers following FluidCalendar patterns.
  Use when adding a new API endpoint, REST route, or backend handler.
  Triggers: "add endpoint", "create route", "new API", "add route handler",
  "backend endpoint", "REST API". Ensures correct auth, logging, error
  handling, and Prisma usage patterns.
---

# Add API Endpoint

## When to Use
- Creating a new API route handler in `src/app/api/`
- Adding GET, POST, PATCH, PUT, DELETE handlers
- Extending existing route files with new HTTP methods

## Prerequisites
- Route directory exists under `src/app/api/`
- Prisma schema has the model(s) you'll query
- Run `npx prisma generate` if schema was recently changed

## Step-by-Step Process

### 1. Create the route file
```
src/app/api/<resource>/route.ts          # Collection (GET list, POST create)
src/app/api/<resource>/[id]/route.ts     # Individual (GET one, PATCH, DELETE)
```

### 2. Use this template
```typescript
import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

const LOG_SOURCE = "<resource>-route";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }
    const userId = auth.userId;

    const data = await prisma.model.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(data);
  } catch (error) {
    logger.error(
      "Failed to fetch <resource>:",
      { error: error instanceof Error ? error.message : String(error) },
      LOG_SOURCE
    );
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
```

### 3. For routes with dynamic params (Next.js 15)
```typescript
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;  // Params are async in Next.js 15
  // ...
}
```

### 4. For admin-only routes
```typescript
import { requireAdmin } from "@/lib/auth/api-auth";

export async function GET(request: NextRequest) {
  const authResponse = await requireAdmin(request);
  if (authResponse) return authResponse;
  // ...
}
```

### 5. Track task changes for sync (if modifying tasks)
```typescript
import { ChangeType, TaskChangeTracker } from "@/lib/task-sync/task-change-tracker";

// After creating/updating/deleting a task in a mapped project:
if (mappingId) {
  const changeTracker = new TaskChangeTracker();
  await changeTracker.trackChange(task.id, "CREATE" as ChangeType, userId, { task }, undefined, mappingId);
}
```

## Key Files
- `src/app/api/tasks/route.ts` - Canonical example (GET with filters, POST with change tracking)
- `src/app/api/tasks/[id]/route.ts` - PATCH/DELETE with dynamic params
- `src/lib/auth/api-auth.ts` - Auth middleware (authenticateRequest, requireAdmin)
- `src/lib/logger/index.ts` - Logger singleton
- `src/lib/prisma.ts` - Global Prisma instance

## Verification
1. Test with `curl` or browser dev tools
2. Check auth works: request without token returns 401
3. Check logging: errors appear in log viewer (Settings > Logs)
4. Check TypeScript: `npm run type-check`

## Common Pitfalls
- Forgetting `await params` (Next.js 15 breaking change)
- Using `new PrismaClient()` instead of `@/lib/prisma`
- Missing `userId` filter (leaks other users' data)
- Using `console.log` instead of `logger`
- Not defining `LOG_SOURCE` constant
