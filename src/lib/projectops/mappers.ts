/**
 * Map Project Ops DTOs to FluidCalendar shapes.
 * See docs/project-ops-scheduler-contract.md.
 */

import { AutoScheduleSettings } from "@prisma/client";

import { newDate } from "@/lib/date-utils";

import type {
  ProjectOpsScheduleSettings,
  ProjectOpsTask,
} from "./types";

const DEFAULT_DURATION = 30;

/**
 * Map Project Ops task to Prisma Task create input (no id; id is generated on create).
 */
export function projectOpsTaskToCreateInput(
  po: ProjectOpsTask,
  userId: string
): {
  title: string;
  description: string | null;
  status: string;
  dueDate: Date | null;
  startDate: Date | null;
  duration: number;
  priority: string | null;
  energyLevel: string | null;
  preferredTime: string | null;
  projectId: string | null;
  userId: string;
  isAutoScheduled: boolean;
  scheduleLocked: boolean;
  recurrenceRule: string | null;
  postponedUntil: Date | null;
  externalTaskId: string | null;
} {
  return {
    title: po.title,
    description: po.description ?? null,
    status: po.status ?? "todo",
    dueDate: po.dueDate ? newDate(po.dueDate) : null,
    startDate: po.earliestStart ? newDate(po.earliestStart) : null,
    duration: po.estimatedMinutes ?? DEFAULT_DURATION,
    priority: po.priority ?? null,
    energyLevel: po.energyLevel ?? null,
    preferredTime: po.preferredTime ?? null,
    projectId: null,
    userId,
    isAutoScheduled: true,
    scheduleLocked: po.scheduleLocked ?? false,
    recurrenceRule: po.recurrenceRule ?? null,
    postponedUntil: po.postponedUntil ? newDate(po.postponedUntil) : null,
    externalTaskId: po.externalTaskId ?? null,
  };
}

/**
 * Build an AutoScheduleSettings-like object for SchedulingService from request settings.
 * FC stores workDays and selectedCalendars as JSON strings.
 */
export function projectOpsSettingsToAutoScheduleSettings(
  po: ProjectOpsScheduleSettings,
  userId: string
): AutoScheduleSettings {
  const now = newDate();
  return {
    id: "projectops-poc",
    userId,
    workDays: JSON.stringify(po.workDays ?? [1, 2, 3, 4, 5]),
    workHourStart: po.workHourStart ?? 9,
    workHourEnd: po.workHourEnd ?? 17,
    selectedCalendars: JSON.stringify(po.selectedCalendars ?? []),
    bufferMinutes: po.bufferMinutes ?? 15,
    highEnergyStart: po.highEnergyStart ?? null,
    highEnergyEnd: po.highEnergyEnd ?? null,
    mediumEnergyStart: po.mediumEnergyStart ?? null,
    mediumEnergyEnd: po.mediumEnergyEnd ?? null,
    lowEnergyStart: po.lowEnergyStart ?? null,
    lowEnergyEnd: po.lowEnergyEnd ?? null,
    groupByProject: po.groupByProject ?? false,
    createdAt: now,
    updatedAt: now,
  };
}
