/**
 * Abstraction for persisting scheduled slots and fetching tasks.
 * Allows SchedulingService to run without direct Prisma dependency (e.g. for extraction or testing).
 * See docs/scheduler-extraction-next-step.md.
 */

import { Task } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export interface ScheduledSlot {
  start: Date;
  end: Date;
  score: number;
}

/**
 * Implementations persist the chosen slot for a task and fetch tasks by id.
 * Default: PrismaTaskWriter (DB). Alternative: in-memory map for tests or extracted service.
 */
export interface TaskWriter {
  updateScheduledSlot(
    taskId: string,
    slot: ScheduledSlot,
    durationMinutes: number,
    userId: string
  ): Promise<Task>;

  fetchTasks(taskIds: string[], userId: string): Promise<Task[]>;
}

/**
 * Default implementation using Prisma. Used by SchedulingService when no TaskWriter is injected.
 */
export class PrismaTaskWriter implements TaskWriter {
  async updateScheduledSlot(
    taskId: string,
    slot: ScheduledSlot,
    durationMinutes: number,
    userId: string
  ): Promise<Task> {
    return prisma.task.update({
      where: { id: taskId },
      data: {
        scheduledStart: slot.start,
        scheduledEnd: slot.end,
        isAutoScheduled: true,
        duration: durationMinutes,
        scheduleScore: slot.score,
        userId,
      },
    });
  }

  async fetchTasks(taskIds: string[], userId: string): Promise<Task[]> {
    if (taskIds.length === 0) return [];
    return prisma.task.findMany({
      where: {
        id: { in: taskIds },
        userId,
      },
    });
  }
}
