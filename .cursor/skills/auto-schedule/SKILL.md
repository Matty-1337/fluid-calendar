---
name: auto-schedule
description: >
  Work with the intelligent auto-scheduling engine that assigns tasks to
  optimal time slots. Use when modifying scheduling logic, scoring factors,
  time slot management, or auto-schedule settings. Triggers: "auto-schedule",
  "scheduling algorithm", "slot scoring", "time slots", "schedule tasks",
  "energy levels", "work hours", "buffer time", "scheduling service".
  Covers the 7-factor scoring system and scheduling architecture.
---

# Auto-Schedule Engine

## When to Use
- Modifying the scheduling algorithm or scoring weights
- Adding new scoring factors
- Changing time slot detection or conflict checking
- Working with AutoScheduleSettings
- Debugging scheduling issues

## Architecture

### Component Hierarchy
```
TaskSchedulingService (high-level API - fetches settings, manages DB)
  -> SchedulingService (orchestrator - batch processing, window escalation)
     -> SlotScorer (7-factor weighted scoring)
     -> TimeSlotManager (available slot detection, conflict checking)
     -> CalendarServiceImpl (calendar event conflict data)
```

### Key Files
- `src/services/scheduling/TaskSchedulingService.ts` - Entry point, fetches settings from DB
- `src/services/scheduling/SchedulingService.ts` - Core orchestrator (317 LOC)
- `src/services/scheduling/SlotScorer.ts` - Scoring algorithm (213 LOC)
- `src/services/scheduling/TimeSlotManager.ts` - Slot finding + conflicts
- `src/services/scheduling/CalendarServiceImpl.ts` - Calendar conflict abstraction
- `src/lib/autoSchedule.ts` - Energy level helpers (`getEnergyLevelForTime`)
- `src/app/api/tasks/schedule-all/route.ts` - API endpoint that triggers scheduling
- `src/types/scheduling.ts` - TimeSlot, SlotScore, EnergyLevel types

## 7-Factor Scoring System

```typescript
const weights = {
  workHourAlignment: 1.0,   // Binary: within configured work hours
  energyLevelMatch: 1.5,    // Task energy vs time-of-day energy
  projectProximity: 0.5,    // Cluster same-project tasks
  bufferAdequacy: 0.8,      // Adequate break between tasks
  timePreference: 1.2,      // Morning/afternoon/evening match
  deadlineProximity: 3.0,   // HIGHEST weight - urgency
  priorityScore: 1.8,       // HIGH=1.0, MEDIUM=0.75, LOW=0.5, NONE=0.25
};
// Total weight: 9.8, final score = weightedSum / totalWeight
```

### Factor Details

**deadlineProximity (3.0x):**
- Overdue tasks: score 1.0-2.0 (escalates with days overdue, max at 14 days)
- Overdue + later slots: time penalty (up to 50% reduction at 2 weeks out)
- Future tasks: exponential decay `exp(-daysToDeadline / 3)`
- No due date: neutral 0.5

**priorityScore (1.8x):**
- HIGH: 1.0, MEDIUM: 0.75, LOW: 0.5, NONE: 0.25

**energyLevelMatch (1.5x):**
- Uses `getEnergyLevelForTime(hour, settings)` from `@/lib/autoSchedule.ts`
- Exact match: 1.0, Adjacent: 0.5, Opposite: 0.0, No preference: 0.5

**timePreference (1.2x):**
- Morning: 5-12, Afternoon: 12-17, Evening: 17-22
- No preference: exponential decay favoring sooner slots

**workHourAlignment (1.0x):**
- Binary: `slot.isWithinWorkHours ? 1 : 0`

**bufferAdequacy (0.8x):**
- Binary: `slot.hasBufferTime ? 1 : 0`

**projectProximity (0.5x):**
- Exponential decay: `exp(-closestDistance / 4)` based on hours from same-project tasks
- Only active when `settings.groupByProject` is true

## Scheduling Process

1. **TaskSchedulingService** fetches AutoScheduleSettings + user timezone from DB
2. Separates locked tasks (user-pinned) from schedulable tasks
3. **SchedulingService** scores ALL tasks first, then schedules in descending score order
4. Batch processing: 8 tasks at a time for performance
5. Window escalation: tries 1 week, then 2 weeks, then 1 month
6. **TimeSlotManager** checks conflicts against calendar events AND already-scheduled tasks
7. Tasks updated with: `scheduledStart`, `scheduledEnd`, `scheduleScore`, `lastScheduled`

## Database Model: AutoScheduleSettings
```prisma
workDays          String  @default("[]")    // JSON: [1,2,3,4,5]
workHourStart     Int                       // 0-23
workHourEnd       Int                       // 0-23
selectedCalendars String  @default("[]")    // JSON: calendar IDs for conflict check
bufferMinutes     Int     @default(15)
highEnergyStart   Int?    // 0-23
highEnergyEnd     Int?    // 0-23
mediumEnergyStart Int?
mediumEnergyEnd   Int?
lowEnergyStart    Int?
lowEnergyEnd      Int?
groupByProject    Boolean @default(false)
```

## Task Scheduling Fields
```prisma
isAutoScheduled Boolean   @default(false)
scheduleLocked  Boolean   @default(false)   // User-pinned, skip re-scheduling
scheduledStart  DateTime?
scheduledEnd    DateTime?
scheduleScore   Float?
lastScheduled   DateTime?
postponedUntil  DateTime?                   // Delay scheduling until this date
```

## Common Pitfalls
- Not considering timezone (scheduling runs in user's timezone from UserSettings)
- Modifying weights without understanding the total-weight normalization
- Not updating `scheduledTasks` map in SlotScorer after scheduling each task
- CalendarServiceImpl caching TODO: cache invalidation not yet implemented
- Known bug: sometimes schedules tasks in the past (off-by-one day)
