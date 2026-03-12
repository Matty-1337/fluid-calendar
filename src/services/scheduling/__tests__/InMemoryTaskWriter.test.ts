/**
 * Unit tests for InMemoryTaskWriter.
 * Validates the TaskWriter abstraction works without Prisma.
 */

import { InMemoryTaskWriter } from "../InMemoryTaskWriter";
import { SchedulerTask } from "../types";

function makeTask(overrides: Partial<SchedulerTask> = {}): SchedulerTask {
  return {
    id: "task-1",
    title: "Test task",
    duration: 30,
    scheduleLocked: false,
    energyLevel: null,
    preferredTime: null,
    dueDate: null,
    priority: null,
    projectId: null,
    startDate: null,
    userId: "user-1",
    isAutoScheduled: false,
    scheduledStart: null,
    scheduledEnd: null,
    scheduleScore: null,
    ...overrides,
  };
}

describe("InMemoryTaskWriter", () => {
  it("updateScheduledSlot sets scheduling fields", async () => {
    const task = makeTask();
    const writer = new InMemoryTaskWriter([task]);

    const start = new Date("2025-03-10T09:00:00Z");
    const end = new Date("2025-03-10T09:30:00Z");

    const result = await writer.updateScheduledSlot(
      "task-1",
      { start, end, score: 0.85 },
      30,
      "user-1"
    );

    expect(result.scheduledStart).toEqual(start);
    expect(result.scheduledEnd).toEqual(end);
    expect(result.scheduleScore).toBe(0.85);
    expect(result.isAutoScheduled).toBe(true);
    expect(result.duration).toBe(30);
  });

  it("updateScheduledSlot throws for unknown task", async () => {
    const writer = new InMemoryTaskWriter([]);
    await expect(
      writer.updateScheduledSlot(
        "nonexistent",
        { start: new Date(), end: new Date(), score: 0 },
        30,
        "user-1"
      )
    ).rejects.toThrow("task nonexistent not found");
  });

  it("fetchTasks returns matching tasks", async () => {
    const tasks = [
      makeTask({ id: "a", title: "Task A", userId: "user-1" }),
      makeTask({ id: "b", title: "Task B", userId: "user-1" }),
      makeTask({ id: "c", title: "Task C", userId: "user-1" }),
    ];
    const writer = new InMemoryTaskWriter(tasks);

    const result = await writer.fetchTasks(["a", "c"], "user-1");
    expect(result).toHaveLength(2);
    expect(result.map((t: { id: string }) => t.id)).toEqual(["a", "c"]);
  });

  it("fetchTasks skips unknown ids", async () => {
    const writer = new InMemoryTaskWriter([makeTask({ id: "x" })]);
    const result = await writer.fetchTasks(["x", "missing"], "user-1");
    expect(result).toHaveLength(1);
  });

  it("fetchTasks returns empty for empty input", async () => {
    const writer = new InMemoryTaskWriter([makeTask()]);
    const result = await writer.fetchTasks([], "user-1");
    expect(result).toHaveLength(0);
  });

  it("getTask returns a copy (mutations don't leak)", async () => {
    const writer = new InMemoryTaskWriter([makeTask()]);
    const copy = writer.getTask("task-1");
    expect(copy).toBeDefined();
    copy!.title = "mutated";
    expect(writer.getTask("task-1")!.title).toBe("Test task");
  });

  it("getAllTasks returns all stored tasks", () => {
    const tasks = [
      makeTask({ id: "1" }),
      makeTask({ id: "2" }),
      makeTask({ id: "3" }),
    ];
    const writer = new InMemoryTaskWriter(tasks);
    expect(writer.getAllTasks()).toHaveLength(3);
  });

  it("updateScheduledSlot persists across fetchTasks", async () => {
    const writer = new InMemoryTaskWriter([makeTask({ id: "t1" })]);

    await writer.updateScheduledSlot(
      "t1",
      {
        start: new Date("2025-03-10T10:00:00Z"),
        end: new Date("2025-03-10T10:30:00Z"),
        score: 0.9,
      },
      30,
      "user-1"
    );

    const [fetched] = await writer.fetchTasks(["t1"], "user-1");
    expect(fetched.scheduledStart).toEqual(new Date("2025-03-10T10:00:00Z"));
    expect(fetched.isAutoScheduled).toBe(true);
  });
});
