# Project Ops ↔ FluidCalendar Scheduler Contract

**Date:** 2025-03-07  
**Purpose:** Data contract and field mapping between Project Ops (source of truth) and the FluidCalendar scheduling engine.

---

## 1. Field Mapping Table

For each field, source system = Project Ops unless noted. FluidCalendar equivalents reference `Task`, `AutoScheduleSettings`, or `UserSettings` in Prisma / `src/types/task.ts`.

| Project Ops / Contract Field | Required | FluidCalendar Equivalent | Transformation | Integration Risks |
|-----------------------------|----------|--------------------------|----------------|-------------------|
| externalTaskId | Optional | Task.externalTaskId | Direct | Idempotency; use for dedup. |
| title | Required | Task.title | Direct | None. |
| description | Optional | Task.description | Direct | None. |
| assigneeUserId | Required (for run) | Task.userId | Map to FC user or scheduling context | FC expects userId for DB writes; PoC may use single context user. |
| assigneeEmail | Optional | — | Not stored in Task | Use for logging or lookup. |
| projectId | Optional | Task.projectId | Direct (or create stub project) | Project proximity scoring; null = no project. |
| projectName | Optional | Project.name (relation) | For display; scheduler uses projectId only | If passing by reference, need projectId. |
| priority | Optional | Task.priority | high/medium/low/none (string) | Map from Project Ops enum or string. |
| status | Optional | Task.status | todo/in_progress/completed | Scheduler skips completed/in_progress; map accordingly. |
| dueDate | Optional | Task.dueDate | ISO DateTime | Critical for deadlineProximity; null = neutral score. |
| estimatedMinutes | Optional | Task.duration | Int (minutes) | Default 30 in FC if null. |
| minimumBlockSize | Optional | — | Not in FC | Could constrain slot length; not implemented in FC. |
| maximumBlockSize | Optional | — | Not in FC | Same; FC uses single duration. |
| earliestStart | Optional | Task.startDate | DateTime | When task becomes schedulable; FC respects in slot generation. |
| latestFinish | Optional | — | Not explicit in FC | Would need to filter slots; not in current model. |
| recurrenceRule | Optional | Task.recurrenceRule | RRule string | FC stores it; scheduler treats task as single instance currently. |
| tags | Optional | Task.tags (Tag[]) | Array of { id, name, color? } | FC uses for display; not in scoring. |
| schedulingMode | Optional | Task.isAutoScheduled, scheduleLocked | boolean | isAutoScheduled=true, scheduleLocked=false for “schedule me”. |
| calendarProvider | Optional | AutoScheduleSettings.selectedCalendars | Calendar feed IDs (JSON string) | FC uses for conflict fetch; Project Ops may pass conflict windows instead. |
| calendarId | Optional | selectedCalendars (array in JSON) | JSON string array | Which FC calendars to check; or external event list in adapter. |
| timezone | Required | UserSettings.timeZone | IANA string (e.g. America/New_York) | Must be explicit for correct slots (B1 fix). |
| hardDeadline | Optional | — | Not in FC | Could map to “no slot after dueDate”; not implemented. |
| flexible | Optional | — | Not in FC | Could relax deadline scoring; not implemented. |
| dependencyIds | Optional | — | Not in FC | FC does not model task dependencies. |
| requiresFocusTime | Optional | — | Not in FC | Could map to energyLevel or buffer; not implemented. |
| createdAt | Optional | Task.createdAt | DateTime | For ordering/audit; FC default now(). |
| updatedAt | Optional | Task.updatedAt | DateTime | FC updatedAt. |
| energyLevel | Optional | Task.energyLevel | high/medium/low | Used in SlotScorer (energyLevelMatch). |
| preferredTime | Optional | Task.preferredTime | morning/afternoon/evening | Used in SlotScorer (timePreference). |
| postponedUntil | Optional | Task.postponedUntil | DateTime | FC: delay scheduling until this date. |

### AutoScheduleSettings (scheduling context)

| Contract Field | Required | FC Field | Transformation | Notes |
|----------------|----------|----------|-----------------|-------|
| workDays | Required | AutoScheduleSettings.workDays | JSON string "[0,1,2,3,4,5,6]" (0=Sun) | Which days are work days. |
| workHourStart | Required | workHourStart | 0–23 | Start of work window. |
| workHourEnd | Required | workHourEnd | 0–23 | End of work window. |
| bufferMinutes | Optional | bufferMinutes | Int, default 15 | Between tasks (scored, not enforced in FC). |
| selectedCalendars | Optional | selectedCalendars | JSON string of feed IDs | For conflict check; [] = no calendar conflicts. |
| groupByProject | Optional | groupByProject | boolean | Project proximity scoring. |
| highEnergyStart/End, etc. | Optional | highEnergyStart, highEnergyEnd, … | 0–23 | Energy windows for scoring. |

---

## 2. Normalized Request DTO: ProjectOpsScheduleRequest

Proposed shape for Project Ops to send into the scheduler (API or facade):

```typescript
interface ProjectOpsScheduleRequest {
  /** Request id for idempotency / logging */
  requestId?: string;
  /** IANA timezone (e.g. "America/New_York"). Required. */
  timezone: string;
  /** Tasks to schedule (at least one). */
  tasks: ProjectOpsTask[];
  /** Scheduling context. If omitted, defaults used. */
  settings?: ProjectOpsScheduleSettings;
  /** Optional: calendar event windows to avoid (if not using FC calendars). */
  conflictWindows?: { start: string; end: string }[];
}

interface ProjectOpsTask {
  externalTaskId?: string;
  title: string;
  description?: string | null;
  assigneeUserId?: string;  // maps to FC userId for this run
  projectId?: string | null;
  projectName?: string | null;
  priority?: "high" | "medium" | "low" | "none" | null;
  status?: "todo" | "in_progress" | "completed" | null;
  dueDate?: string | null;  // ISO 8601
  estimatedMinutes?: number | null;
  earliestStart?: string | null;  // ISO 8601
  recurrenceRule?: string | null;
  tags?: { id: string; name: string; color?: string }[];
  energyLevel?: "high" | "medium" | "low" | null;
  preferredTime?: "morning" | "afternoon" | "evening" | null;
  postponedUntil?: string | null;  // ISO 8601
  scheduleLocked?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface ProjectOpsScheduleSettings {
  workDays?: number[];       // 0–6, default [1,2,3,4,5]
  workHourStart?: number;    // 0–23, default 9
  workHourEnd?: number;       // 0–23, default 17
  bufferMinutes?: number;
  selectedCalendars?: string[];
  groupByProject?: boolean;
  highEnergyStart?: number;
  highEnergyEnd?: number;
  mediumEnergyStart?: number;
  mediumEnergyEnd?: number;
  lowEnergyStart?: number;
  lowEnergyEnd?: number;
}
```

---

## 3. Normalized Response DTO: ScheduleResult

Proposed shape for scheduler to return:

```typescript
interface ScheduleResult {
  success: boolean;
  requestId?: string;
  /** Per-task results in same order as request (or by externalTaskId). */
  results: TaskScheduleResult[];
  /** Global error if request invalid or scheduler failed. */
  error?: string;
}

interface TaskScheduleResult {
  externalTaskId?: string;
  title: string;
  success: boolean;
  /** Selected slot (if success). */
  scheduledStart?: string;   // ISO 8601
  scheduledEnd?: string;     // ISO 8601
  scheduleScore?: number;
  /** Top candidate slots (e.g. top 5) for debugging or UI. */
  candidates?: { start: string; end: string; score: number }[];
  /** Conflicting events/slots if unschedulable. */
  conflicts?: { start: string; end: string; source?: string }[];
  /** Reason if unschedulable. */
  reason?: string;  // e.g. "no_slots_in_window", "overdue_no_slots", "conflict"
  /** Calendar writeback status if applicable. */
  calendarWriteback?: "pending" | "success" | "failed" | "skipped";
}
```

---

## 4. Transformation Summary

- **Required from Project Ops for a valid request:** `timezone`, `tasks` (at least one task with `title`). Optionally `settings`; defaults can apply for work days/hours.
- **FluidCalendar defaults when mapping:** duration = 30 if missing; status = "todo"; priority = "none"; isAutoScheduled = true; scheduleLocked = false.
- **Risks:** (1) assigneeUserId → FC userId: if FC persists, must exist in FC DB or use a single “scheduler” user for PoC. (2) conflictWindows: FC today uses its own CalendarServiceImpl; for Project Ops–owned calendars, pass conflict windows in request or add adapter. (3) hardDeadline / latestFinish / minimumBlockSize / maximumBlockSize: not in FC; document as future extensions.

---

## 5. Key Files in FluidCalendar

- Task type: `src/types/task.ts` (Task, TaskWithRelations, Priority, EnergyLevel, TimePreference, TaskStatus).
- Prisma: `prisma/schema.prisma` (Task, AutoScheduleSettings, UserSettings).
- Scheduler expects: Prisma `Task` (with id, userId, duration, dueDate, priority, energyLevel, preferredTime, projectId, scheduleLocked, …) and `AutoScheduleSettings`; timezone from constructor or UserSettings.
