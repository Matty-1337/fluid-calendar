/**
 * Project Ops scheduler facade: accepts ProjectOpsScheduleRequest,
 * runs FluidCalendar scheduling engine, returns ScheduleResult.
 * Uses temporary DB tasks; cleans up after.
 * See docs/project-ops-scheduler-contract.md and docs/scheduler-extraction-dependency-map.md.
 */

import { Task } from "@prisma/client";

import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { CalendarService } from "@/services/scheduling/CalendarService";
import { SchedulingService } from "@/services/scheduling/SchedulingService";

import { ConflictWindowsCalendarService } from "./ConflictWindowsCalendarService";
import {
  projectOpsSettingsToAutoScheduleSettings,
  projectOpsTaskToCreateInput,
} from "./mappers";
import type {
  ProjectOpsScheduleRequest,
  ScheduleResult,
  TaskScheduleResult,
} from "./types";

const LOG_SOURCE = "projectops-schedulerFacade";

/**
 * Run the scheduler for Project Ops payload. Creates temporary tasks,
 * runs SchedulingService, returns results, then deletes temporary tasks.
 */
export async function runProjectOpsSchedule(
  request: ProjectOpsScheduleRequest,
  userId: string
): Promise<ScheduleResult> {
  if (!request.timezone || !request.tasks?.length) {
    return {
      success: false,
      requestId: request.requestId ?? "",
      results: [],
      error: "timezone and at least one task are required",
    };
  }

  const taskIds: string[] = [];

  try {
    const settings = projectOpsSettingsToAutoScheduleSettings(
      request.settings ?? {},
      userId
    );
    const timezone = request.timezone;

    // Create temporary tasks in DB for the scheduler to update
    for (const poTask of request.tasks) {
      const input = projectOpsTaskToCreateInput(poTask, userId);
      const created = await prisma.task.create({
        data: input,
      });
      taskIds.push(created.id);
    }

    const createdTasks = await prisma.task.findMany({
      where: { id: { in: taskIds }, userId },
      include: { project: true, tags: true },
    });

    if (createdTasks.length !== request.tasks.length) {
      logger.warn(
        "Created task count mismatch",
        { created: createdTasks.length, requested: request.tasks.length },
        LOG_SOURCE
      );
    }

    // Use conflict windows from request if provided, otherwise fall back to DB-based calendar service
    const calendarService: CalendarService | undefined =
      request.conflictWindows?.length
        ? new ConflictWindowsCalendarService(request.conflictWindows)
        : undefined;

    const schedulingService = new SchedulingService(
      settings,
      timezone,
      calendarService
    );
    const updatedTasks = await schedulingService.scheduleMultipleTasks(
      createdTasks as Task[],
      userId
    );

    const results: TaskScheduleResult[] = request.tasks.map((po, i) => {
      const task = updatedTasks.find((t) => t.id === taskIds[i]) ?? updatedTasks[i];
      const hasSlot = !!task?.scheduledStart && !!task?.scheduledEnd;
      return {
        externalTaskId: po.externalTaskId,
        title: po.title,
        success: hasSlot,
        scheduledStart: task?.scheduledStart?.toISOString(),
        scheduledEnd: task?.scheduledEnd?.toISOString(),
        scheduleScore: task?.scheduleScore ?? undefined,
        reason: hasSlot ? undefined : "no_slots_in_window",
      };
    });

    return {
      success: true,
      requestId: request.requestId ?? "",
      results,
    };
  } catch (error) {
    logger.error(
      "Project Ops schedule run failed",
      {
        error: error instanceof Error ? error.message : String(error),
        userId,
        requestId: request.requestId ?? "",
      },
      LOG_SOURCE
    );
    return {
      success: false,
      requestId: request.requestId ?? "",
      results: request.tasks.map((po) => ({
        externalTaskId: po.externalTaskId,
        title: po.title,
        success: false,
        reason: "scheduler_error",
      })),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (taskIds.length > 0) {
      try {
        await prisma.task.deleteMany({
          where: { id: { in: taskIds }, userId },
        });
      } catch (deleteError) {
        logger.error(
          "Failed to delete temporary Project Ops tasks",
          {
            error:
              deleteError instanceof Error
                ? deleteError.message
                : String(deleteError),
            taskIds,
            userId,
          },
          LOG_SOURCE
        );
      }
    }
  }
}
