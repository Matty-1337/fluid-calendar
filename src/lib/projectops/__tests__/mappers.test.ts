/**
 * Unit tests for Project Ops mappers.
 */

import {
  projectOpsSettingsToAutoScheduleSettings,
  projectOpsTaskToCreateInput,
} from "../mappers";

describe("projectops/mappers", () => {
  const userId = "test-user-id";

  describe("projectOpsTaskToCreateInput", () => {
    it("maps minimal task with defaults", () => {
      const input = projectOpsTaskToCreateInput(
        { title: "Minimal task" },
        userId
      );
      expect(input.title).toBe("Minimal task");
      expect(input.userId).toBe(userId);
      expect(input.status).toBe("todo");
      expect(input.duration).toBe(30);
      expect(input.isAutoScheduled).toBe(true);
      expect(input.scheduleLocked).toBe(false);
      expect(input.priority).toBeNull();
      expect(input.energyLevel).toBeNull();
      expect(input.preferredTime).toBeNull();
      expect(input.projectId).toBeNull();
    });

    it("maps full task fields", () => {
      const input = projectOpsTaskToCreateInput(
        {
          title: "Full task",
          description: "Desc",
          status: "todo",
          dueDate: "2025-03-10T17:00:00.000Z",
          earliestStart: "2025-03-08T00:00:00.000Z",
          estimatedMinutes: 60,
          priority: "high",
          energyLevel: "high",
          preferredTime: "morning",
          scheduleLocked: true,
          externalTaskId: "po-123",
        },
        userId
      );
      expect(input.title).toBe("Full task");
      expect(input.description).toBe("Desc");
      expect(input.status).toBe("todo");
      expect(input.duration).toBe(60);
      expect(input.priority).toBe("high");
      expect(input.energyLevel).toBe("high");
      expect(input.preferredTime).toBe("morning");
      expect(input.scheduleLocked).toBe(true);
      expect(input.externalTaskId).toBe("po-123");
      expect(input.dueDate).toBeInstanceOf(Date);
      expect(input.startDate).toBeInstanceOf(Date);
    });
  });

  describe("projectOpsSettingsToAutoScheduleSettings", () => {
    it("maps with defaults", () => {
      const settings = projectOpsSettingsToAutoScheduleSettings({}, userId);
      expect(settings.userId).toBe(userId);
      expect(settings.workDays).toBe(JSON.stringify([1, 2, 3, 4, 5]));
      expect(settings.workHourStart).toBe(9);
      expect(settings.workHourEnd).toBe(17);
      expect(settings.bufferMinutes).toBe(15);
      expect(settings.selectedCalendars).toBe(JSON.stringify([]));
      expect(settings.groupByProject).toBe(false);
    });

    it("maps custom work days and hours", () => {
      const settings = projectOpsSettingsToAutoScheduleSettings(
        {
          workDays: [0, 6],
          workHourStart: 8,
          workHourEnd: 18,
          bufferMinutes: 30,
          selectedCalendars: ["cal-1"],
          groupByProject: true,
        },
        userId
      );
      expect(settings.workDays).toBe(JSON.stringify([0, 6]));
      expect(settings.workHourStart).toBe(8);
      expect(settings.workHourEnd).toBe(18);
      expect(settings.bufferMinutes).toBe(30);
      expect(settings.selectedCalendars).toBe(JSON.stringify(["cal-1"]));
      expect(settings.groupByProject).toBe(true);
    });
  });
});
