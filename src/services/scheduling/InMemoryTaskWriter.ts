/**
 * In-memory TaskWriter for testing and extracted/standalone scheduler use.
 *
 * Stores tasks in a Map, applies scheduled slot updates in-place, and returns
 * task snapshots — no database dependency.  Useful for:
 *   - Unit testing SchedulingService without Prisma
 *   - Running the scheduler in a microservice or native rebuild
 *   - Validating the TaskWriter abstraction boundary
 */

import { SchedulerTask } from "./types";

import { ScheduledSlot, TaskWriter } from "./TaskWriter";

/**
 * InMemoryTaskWriter operates on SchedulerTask objects.
 * Because TaskWriter's return type is Prisma's Task, we cast — callers that
 * only read SchedulerTask fields will work fine.  This is intentionally loose
 * to avoid pulling in all 30+ Prisma Task fields for a test double.
 */
export class InMemoryTaskWriter implements TaskWriter {
  private tasks: Map<string, SchedulerTask>;

  constructor(tasks: SchedulerTask[]) {
    this.tasks = new Map(tasks.map((t) => [t.id, { ...t }]));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateScheduledSlot(
    taskId: string,
    slot: ScheduledSlot,
    durationMinutes: number,
    _userId: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`InMemoryTaskWriter: task ${taskId} not found`);
    }
    const updated: SchedulerTask = {
      ...task,
      scheduledStart: slot.start,
      scheduledEnd: slot.end,
      scheduleScore: slot.score,
      isAutoScheduled: true,
      duration: durationMinutes,
    };
    this.tasks.set(taskId, updated);
    return updated;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async fetchTasks(taskIds: string[], _userId: string): Promise<any[]> {
    return taskIds
      .map((id) => this.tasks.get(id))
      .filter((t): t is SchedulerTask => t !== undefined);
  }

  /** Retrieve current state of a single task (test helper). */
  getTask(taskId: string): SchedulerTask | undefined {
    const t = this.tasks.get(taskId);
    return t ? { ...t } : undefined;
  }

  /** Retrieve all tasks (test helper). */
  getAllTasks(): SchedulerTask[] {
    return [...this.tasks.values()].map((t) => ({ ...t }));
  }
}
