/**
 * Unit tests for Project Ops Zod validation schemas.
 */

import { projectOpsScheduleRequestSchema } from "../validation";

describe("projectops/validation", () => {
  describe("projectOpsScheduleRequestSchema", () => {
    it("accepts a valid minimal request", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "America/New_York",
        tasks: [{ title: "Test task" }],
      });
      expect(result.success).toBe(true);
    });

    it("accepts a full request with all fields", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        requestId: "req-123",
        timezone: "America/Los_Angeles",
        tasks: [
          {
            externalTaskId: "po-001",
            title: "Full task",
            description: "A description",
            priority: "high",
            status: "todo",
            dueDate: "2025-03-10T17:00:00.000Z",
            estimatedMinutes: 60,
            earliestStart: "2025-03-08T00:00:00.000Z",
            energyLevel: "high",
            preferredTime: "morning",
            scheduleLocked: true,
            tags: [{ id: "t1", name: "urgent", color: "#ff0000" }],
          },
        ],
        settings: {
          workDays: [1, 2, 3, 4, 5],
          workHourStart: 9,
          workHourEnd: 17,
          bufferMinutes: 15,
          selectedCalendars: ["cal-1"],
          groupByProject: true,
          highEnergyStart: 9,
          highEnergyEnd: 12,
        },
        conflictWindows: [
          {
            start: "2025-03-10T10:00:00.000Z",
            end: "2025-03-10T11:00:00.000Z",
          },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing timezone", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        tasks: [{ title: "Test" }],
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const fields = result.error.flatten().fieldErrors;
        expect(fields.timezone).toBeDefined();
      }
    });

    it("rejects empty timezone", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "",
        tasks: [{ title: "Test" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing tasks", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty tasks array", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects task without title", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks: [{ description: "no title" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid priority enum", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks: [{ title: "Test", priority: "urgent" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid workHourStart", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks: [{ title: "Test" }],
        settings: { workHourStart: 25 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid workDay value", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks: [{ title: "Test" }],
        settings: { workDays: [7] },
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid dueDate format", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks: [{ title: "Test", dueDate: "not-a-date" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative estimatedMinutes", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks: [{ title: "Test", estimatedMinutes: -10 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects estimatedMinutes below minimum (5)", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks: [{ title: "Test", estimatedMinutes: 1 }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts estimatedMinutes at minimum (5)", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks: [{ title: "Test", estimatedMinutes: 5 }],
      });
      expect(result.success).toBe(true);
    });

    it("rejects estimatedMinutes above maximum (480)", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks: [{ title: "Test", estimatedMinutes: 481 }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects more than 50 tasks", () => {
      const tasks = Array.from({ length: 51 }, (_, i) => ({
        title: `Task ${i}`,
      }));
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks,
      });
      expect(result.success).toBe(false);
    });

    it("accepts exactly 50 tasks", () => {
      const tasks = Array.from({ length: 50 }, (_, i) => ({
        title: `Task ${i}`,
      }));
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "UTC",
        tasks,
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid IANA timezone", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "Not/A/Real/Timezone",
        tasks: [{ title: "Test" }],
      });
      expect(result.success).toBe(false);
    });

    it("accepts valid IANA timezone", () => {
      const result = projectOpsScheduleRequestSchema.safeParse({
        timezone: "America/New_York",
        tasks: [{ title: "Test" }],
      });
      expect(result.success).toBe(true);
    });
  });
});
