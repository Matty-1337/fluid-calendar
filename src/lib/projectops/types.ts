/**
 * Project Ops ↔ FluidCalendar scheduler contract types.
 * See docs/project-ops-scheduler-contract.md.
 */

export interface ProjectOpsTask {
  externalTaskId?: string;
  title: string;
  description?: string | null;
  assigneeUserId?: string;
  projectId?: string | null;
  projectName?: string | null;
  priority?: "high" | "medium" | "low" | "none" | null;
  status?: "todo" | "in_progress" | "completed" | null;
  dueDate?: string | null;
  estimatedMinutes?: number | null;
  earliestStart?: string | null;
  recurrenceRule?: string | null;
  tags?: { id: string; name: string; color?: string }[];
  energyLevel?: "high" | "medium" | "low" | null;
  preferredTime?: "morning" | "afternoon" | "evening" | null;
  postponedUntil?: string | null;
  scheduleLocked?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProjectOpsScheduleSettings {
  workDays?: number[];
  workHourStart?: number;
  workHourEnd?: number;
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

export interface ProjectOpsScheduleRequest {
  requestId?: string;
  timezone: string;
  tasks: ProjectOpsTask[];
  settings?: ProjectOpsScheduleSettings;
  conflictWindows?: { start: string; end: string }[];
}

export interface TaskScheduleResult {
  externalTaskId?: string;
  title: string;
  success: boolean;
  scheduledStart?: string;
  scheduledEnd?: string;
  scheduleScore?: number;
  candidates?: { start: string; end: string; score: number }[];
  conflicts?: { start: string; end: string; source?: string }[];
  reason?: string;
  calendarWriteback?: "pending" | "success" | "failed" | "skipped";
}

export interface ScheduleResult {
  success: boolean;
  requestId?: string;
  results: TaskScheduleResult[];
  error?: string;
}
