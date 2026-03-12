/**
 * Zod validation schemas for Project Ops schedule API.
 * See docs/project-ops-scheduler-contract.md.
 */

import { z } from "zod";

const projectOpsTaskSchema = z.object({
  externalTaskId: z.string().optional(),
  title: z.string().min(1, "title is required"),
  description: z.string().nullable().optional(),
  assigneeUserId: z.string().optional(),
  projectId: z.string().nullable().optional(),
  projectName: z.string().nullable().optional(),
  priority: z
    .enum(["high", "medium", "low", "none"])
    .nullable()
    .optional(),
  status: z
    .enum(["todo", "in_progress", "completed"])
    .nullable()
    .optional(),
  dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  estimatedMinutes: z
    .number()
    .int()
    .min(5, "estimatedMinutes must be at least 5")
    .max(480, "estimatedMinutes must be at most 480")
    .nullable()
    .optional(),
  earliestStart: z.string().datetime({ offset: true }).nullable().optional(),
  recurrenceRule: z.string().nullable().optional(),
  tags: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: z.string().optional(),
      })
    )
    .optional(),
  energyLevel: z.enum(["high", "medium", "low"]).nullable().optional(),
  preferredTime: z
    .enum(["morning", "afternoon", "evening"])
    .nullable()
    .optional(),
  postponedUntil: z.string().datetime({ offset: true }).nullable().optional(),
  scheduleLocked: z.boolean().optional(),
  createdAt: z.string().datetime({ offset: true }).optional(),
  updatedAt: z.string().datetime({ offset: true }).optional(),
});

const projectOpsScheduleSettingsSchema = z.object({
  workDays: z.array(z.number().int().min(0).max(6)).optional(),
  workHourStart: z.number().int().min(0).max(23).optional(),
  workHourEnd: z.number().int().min(0).max(23).optional(),
  bufferMinutes: z.number().int().min(0).optional(),
  selectedCalendars: z.array(z.string()).optional(),
  groupByProject: z.boolean().optional(),
  highEnergyStart: z.number().int().min(0).max(23).optional(),
  highEnergyEnd: z.number().int().min(0).max(23).optional(),
  mediumEnergyStart: z.number().int().min(0).max(23).optional(),
  mediumEnergyEnd: z.number().int().min(0).max(23).optional(),
  lowEnergyStart: z.number().int().min(0).max(23).optional(),
  lowEnergyEnd: z.number().int().min(0).max(23).optional(),
});

const conflictWindowSchema = z.object({
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
});

export const projectOpsScheduleRequestSchema = z.object({
  requestId: z.string().optional(),
  timezone: z
    .string()
    .min(1, "timezone is required")
    .refine(
      (tz) => {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: "timezone must be a valid IANA timezone (e.g. America/New_York)" }
    ),
  tasks: z
    .array(projectOpsTaskSchema)
    .min(1, "at least one task is required")
    .max(50, "at most 50 tasks per request"),
  settings: projectOpsScheduleSettingsSchema.optional(),
  conflictWindows: z.array(conflictWindowSchema).optional(),
});

export type ValidatedProjectOpsScheduleRequest = z.infer<
  typeof projectOpsScheduleRequestSchema
>;
