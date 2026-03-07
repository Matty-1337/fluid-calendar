---
name: task-sync-provider
description: >
  Add or modify task synchronization providers (Google Tasks, Outlook, etc.).
  Use when implementing a new task provider, fixing sync issues, or working
  with the task sync system. Triggers: "task sync", "task provider",
  "Google Tasks", "Outlook tasks", "bidirectional sync", "task mapping",
  "sync provider", "external tasks". Covers the TaskProviderInterface,
  field mappers, and change tracking.
---

# Task Sync Provider

## When to Use
- Implementing a new task provider (e.g., Todoist, Asana)
- Modifying existing providers (Google Tasks, Outlook Tasks)
- Working with task change tracking and bidirectional sync
- Debugging sync issues

## Architecture

### Core Components
```
TaskSyncManager (orchestrator)
  -> TaskProviderInterface (contract)
     -> OutlookProvider / GoogleProvider (implementations)
        -> FieldMapper (status/priority/recurrence translation)
  -> TaskChangeTracker (bidirectional change tracking)
  -> TaskListMapping (maps external lists to internal projects)
```

### Key Files
- `src/lib/task-sync/task-sync-manager.ts` - Sync orchestration
- `src/lib/task-sync/task-change-tracker.ts` - Change tracking for outgoing sync
- `src/lib/task-sync/providers/task-provider.interface.ts` - Provider contract
- `src/lib/task-sync/providers/outlook-provider.ts` - Outlook implementation
- `src/lib/task-sync/providers/google-provider.ts` - Google Tasks implementation
- `src/lib/task-sync/providers/outlook-field-mapper.ts` - Outlook field mapping
- `src/lib/task-sync/providers/google-field-mapper.ts` - Google field mapping
- `src/app/api/task-sync/` - Sync API routes

### Database Models
- **TaskProvider** - Provider config (type, tokens, settings)
- **TaskListMapping** - Maps external list to internal Project (direction: incoming/outgoing/bidirectional)
- **TaskChange** - Tracks local mutations for outgoing sync (changeType, changeData, synced flag)

## Implementing a New Provider

### 1. Create the provider class
```typescript
// src/lib/task-sync/providers/<name>-provider.ts
import { TaskProviderInterface, ExternalTaskList, ExternalTask, TaskToCreate, TaskUpdates, SyncOptions, TaskChange } from "./task-provider.interface";
import { Task } from "@/types/task";

export class NewProvider implements TaskProviderInterface {
  constructor(private accessToken: string) {}

  getType(): string { return "NEW_PROVIDER"; }
  getName(): string { return "New Provider"; }

  async getTaskLists(): Promise<ExternalTaskList[]> { /* ... */ }
  async getTasks(listId: string, options?: SyncOptions): Promise<ExternalTask[]> { /* ... */ }
  async createTask(listId: string, task: TaskToCreate): Promise<ExternalTask> { /* ... */ }
  async updateTask(listId: string, taskId: string, updates: TaskUpdates): Promise<ExternalTask> { /* ... */ }
  async deleteTask(listId: string, taskId: string): Promise<void> { /* ... */ }
  async getChanges(listId: string, since?: Date): Promise<TaskChange[]> { /* ... */ }
  async validateConnection(): Promise<boolean> { /* ... */ }
  mapToInternalTask(externalTask: ExternalTask, projectId: string): Partial<Task> { /* ... */ }
  mapToExternalTask(task: Partial<Task>): TaskToCreate { /* ... */ }
}
```

### 2. Create a field mapper
```typescript
// src/lib/task-sync/providers/<name>-field-mapper.ts
export function mapStatus(externalStatus: string): string { /* ... */ }
export function mapPriority(externalPriority: string): string { /* ... */ }
export function mapRecurrence(externalRule: string): string | null { /* ... */ }
```

### 3. Register in TaskSyncManager
Update `src/lib/task-sync/task-sync-manager.ts` to instantiate your provider based on type.

### 4. Add API routes (if needed)
At `src/app/api/task-sync/providers/` for provider-specific endpoints.

## TaskProviderInterface Methods (11 required)

| Method | Purpose |
|--------|---------|
| `getType()` | Return provider identifier (e.g., "OUTLOOK") |
| `getName()` | Human-readable name |
| `getTaskLists()` | List available external task lists |
| `getTasks(listId, options?)` | Fetch tasks from external list |
| `createTask(listId, task)` | Create task in external system |
| `updateTask(listId, taskId, updates)` | Update external task |
| `deleteTask(listId, taskId)` | Delete external task |
| `getChanges(listId, since?)` | Get changes since timestamp |
| `validateConnection()` | Test provider connection |
| `mapToInternalTask(external, projectId)` | External -> internal format |
| `mapToExternalTask(task)` | Internal -> external format |

## Change Tracking Pattern
```typescript
import { TaskChangeTracker, ChangeType } from "@/lib/task-sync/task-change-tracker";

const tracker = new TaskChangeTracker();
await tracker.trackChange(
  taskId,
  "UPDATE" as ChangeType,
  userId,
  { changes: { title: "new title" } },
  providerId,
  mappingId
);
```

## Common Pitfalls
- Not handling token refresh (tokens expire, use TokenManager)
- Field mapping mismatches (e.g., Outlook "completed" vs internal "completed")
- Missing bidirectional conflict resolution
- Not setting `syncHash` for change detection
- Forgetting to mark TaskChange as `synced: true` after successful sync
