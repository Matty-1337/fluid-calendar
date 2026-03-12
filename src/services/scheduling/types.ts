/**
 * Prisma-independent types for the scheduling engine.
 *
 * These mirror the subset of Prisma's Task and AutoScheduleSettings actually
 * used by SlotScorer, TimeSlotManager, and SchedulingService.  Code that only
 * needs to *run the algorithm* (tests, extracted service, Project Ops native
 * rebuild) can depend on these instead of @prisma/client.
 *
 * The Prisma-backed FluidCalendar app continues to pass its own Task objects
 * which structurally satisfy this interface.
 */

// ---------------------------------------------------------------------------
// SchedulerTask — fields the scoring / slot engine actually reads
// ---------------------------------------------------------------------------

export interface SchedulerTask {
  id: string;
  title: string;
  duration: number | null;
  scheduleLocked: boolean;

  // Scoring inputs
  energyLevel: string | null;
  preferredTime: string | null;
  dueDate: Date | null;
  priority: string | null;
  projectId: string | null;

  // Window constraints
  startDate: Date | null;

  // Ownership
  userId: string | null;

  // Scheduled output (mutated by the engine, read back for conflict tracking)
  isAutoScheduled: boolean;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  scheduleScore: number | null;
}

// ---------------------------------------------------------------------------
// SchedulerSettings — fields used by TimeSlotManager, SlotScorer, and helpers
// ---------------------------------------------------------------------------

export interface SchedulerSettings {
  workHourStart: number;
  workHourEnd: number;
  bufferMinutes: number;
  workDays: string; // JSON-encoded number[] (e.g. "[1,2,3,4,5]")
  selectedCalendars: string; // JSON-encoded string[] (e.g. '["cal-1"]')
  groupByProject: boolean;

  // Energy-level time ranges (nullable = not configured)
  highEnergyStart: number | null;
  highEnergyEnd: number | null;
  mediumEnergyStart: number | null;
  mediumEnergyEnd: number | null;
  lowEnergyStart: number | null;
  lowEnergyEnd: number | null;
}
