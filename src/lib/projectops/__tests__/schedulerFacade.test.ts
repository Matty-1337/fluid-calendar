/**
 * Unit tests for Project Ops scheduler facade.
 * These test the facade logic without a real database — they mock Prisma and SchedulingService.
 */

import type { Task } from "@prisma/client";

import type { ProjectOpsScheduleRequest } from "../types";

// Mock prisma before importing facade
const mockCreate = jest.fn();
const mockFindMany = jest.fn();
const mockDeleteMany = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    task: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

// Mock logger
jest.mock("@/lib/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock SchedulingService
const mockScheduleMultipleTasks = jest.fn();
jest.mock("@/services/scheduling/SchedulingService", () => ({
  SchedulingService: jest.fn().mockImplementation(() => ({
    scheduleMultipleTasks: mockScheduleMultipleTasks,
  })),
}));

import { runProjectOpsSchedule } from "../schedulerFacade";

describe("projectops/schedulerFacade", () => {
  const userId = "test-user-id";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns error for missing timezone", async () => {
    const result = await runProjectOpsSchedule(
      { timezone: "", tasks: [{ title: "Test" }] } as ProjectOpsScheduleRequest,
      userId
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("timezone");
  });

  it("returns error for empty tasks", async () => {
    const result = await runProjectOpsSchedule(
      { timezone: "UTC", tasks: [] } as ProjectOpsScheduleRequest,
      userId
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain("task");
  });

  it("creates temp tasks, runs scheduler, returns results, and cleans up", async () => {
    const fakeTask: Partial<Task> = {
      id: "tmp-1",
      title: "Review brief",
      userId,
      scheduledStart: new Date("2025-03-10T14:00:00Z"),
      scheduledEnd: new Date("2025-03-10T15:00:00Z"),
      scheduleScore: 0.85,
    };

    mockCreate.mockResolvedValueOnce({ id: "tmp-1" });
    mockFindMany.mockResolvedValueOnce([fakeTask]); // findMany for created tasks
    mockScheduleMultipleTasks.mockResolvedValueOnce([fakeTask]);
    mockDeleteMany.mockResolvedValueOnce({ count: 1 });

    const request: ProjectOpsScheduleRequest = {
      requestId: "req-1",
      timezone: "America/New_York",
      tasks: [
        {
          externalTaskId: "po-001",
          title: "Review brief",
          estimatedMinutes: 60,
          priority: "high",
        },
      ],
      settings: {
        workDays: [1, 2, 3, 4, 5],
        workHourStart: 9,
        workHourEnd: 17,
      },
    };

    const result = await runProjectOpsSchedule(request, userId);

    expect(result.success).toBe(true);
    expect(result.requestId).toBe("req-1");
    expect(result.results).toHaveLength(1);
    expect(result.results[0].externalTaskId).toBe("po-001");
    expect(result.results[0].success).toBe(true);
    expect(result.results[0].scheduledStart).toBe("2025-03-10T14:00:00.000Z");
    expect(result.results[0].scheduledEnd).toBe("2025-03-10T15:00:00.000Z");
    expect(result.results[0].scheduleScore).toBe(0.85);

    // Verify temp task was created
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].data.title).toBe("Review brief");
    expect(mockCreate.mock.calls[0][0].data.userId).toBe(userId);
    expect(mockCreate.mock.calls[0][0].data.isAutoScheduled).toBe(true);
    expect(mockCreate.mock.calls[0][0].data.duration).toBe(60);

    // Verify timezone was passed to SchedulingService constructor
    const { SchedulingService } = require("@/services/scheduling/SchedulingService");
    expect(SchedulingService).toHaveBeenCalledWith(
      expect.objectContaining({ workHourStart: 9, workHourEnd: 17 }),
      "America/New_York",
      undefined
    );

    // Verify cleanup
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["tmp-1"] }, userId },
    });
  });

  it("cleans up temp tasks even when scheduler throws", async () => {
    mockCreate.mockResolvedValueOnce({ id: "tmp-err" });
    mockFindMany.mockResolvedValueOnce([{ id: "tmp-err", title: "Test" }]);
    mockScheduleMultipleTasks.mockRejectedValueOnce(new Error("Scheduler exploded"));
    mockDeleteMany.mockResolvedValueOnce({ count: 1 });

    const result = await runProjectOpsSchedule(
      {
        timezone: "UTC",
        tasks: [{ title: "Test" }],
      },
      userId
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Scheduler exploded");
    expect(result.results[0].success).toBe(false);
    expect(result.results[0].reason).toBe("scheduler_error");

    // Cleanup must have been called
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["tmp-err"] }, userId },
    });
  });

  it("maps multiple tasks with correct externalTaskIds", async () => {
    const task1: Partial<Task> = {
      id: "tmp-a",
      title: "Task A",
      userId,
      scheduledStart: new Date("2025-03-10T09:00:00Z"),
      scheduledEnd: new Date("2025-03-10T09:30:00Z"),
      scheduleScore: 0.9,
    };
    const task2: Partial<Task> = {
      id: "tmp-b",
      title: "Task B",
      userId,
      scheduledStart: null,
      scheduledEnd: null,
      scheduleScore: null,
    };

    mockCreate
      .mockResolvedValueOnce({ id: "tmp-a" })
      .mockResolvedValueOnce({ id: "tmp-b" });
    mockFindMany.mockResolvedValueOnce([task1, task2]);
    // Scheduler returns them in score order (only task1 got scheduled)
    mockScheduleMultipleTasks.mockResolvedValueOnce([task1, task2]);
    mockDeleteMany.mockResolvedValueOnce({ count: 2 });

    const result = await runProjectOpsSchedule(
      {
        timezone: "UTC",
        tasks: [
          { externalTaskId: "ext-a", title: "Task A", estimatedMinutes: 30 },
          { externalTaskId: "ext-b", title: "Task B", estimatedMinutes: 60 },
        ],
      },
      userId
    );

    expect(result.success).toBe(true);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].externalTaskId).toBe("ext-a");
    expect(result.results[0].success).toBe(true);
    expect(result.results[1].externalTaskId).toBe("ext-b");
    expect(result.results[1].success).toBe(false);
    expect(result.results[1].reason).toBe("no_slots_in_window");
  });
});
