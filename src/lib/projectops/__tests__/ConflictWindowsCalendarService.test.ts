/**
 * Unit tests for ConflictWindowsCalendarService.
 */

import { TimeSlot } from "@/types/scheduling";

import { ConflictWindowsCalendarService } from "../ConflictWindowsCalendarService";

function makeSlot(start: string, end: string): TimeSlot {
  return {
    start: new Date(start),
    end: new Date(end),
    score: 0,
    conflicts: [],
    energyLevel: null,
    isWithinWorkHours: true,
    hasBufferTime: true,
  };
}

describe("ConflictWindowsCalendarService", () => {
  const windows = [
    { start: "2025-03-10T09:00:00.000Z", end: "2025-03-10T10:00:00.000Z" },
    { start: "2025-03-10T14:00:00.000Z", end: "2025-03-10T15:00:00.000Z" },
  ];

  describe("findConflicts", () => {
    it("returns conflict when slot overlaps a window", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      const conflicts = await service.findConflicts(
        makeSlot("2025-03-10T09:30:00.000Z", "2025-03-10T10:30:00.000Z"),
        [],
        "user-1"
      );
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].type).toBe("calendar_event");
      expect(conflicts[0].title).toBe("Busy (Project Ops)");
    });

    it("returns empty when slot does not overlap any window", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      const conflicts = await service.findConflicts(
        makeSlot("2025-03-10T11:00:00.000Z", "2025-03-10T12:00:00.000Z"),
        [],
        "user-1"
      );
      expect(conflicts).toHaveLength(0);
    });

    it("returns at most one conflict per call", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      const conflicts = await service.findConflicts(
        makeSlot("2025-03-10T08:00:00.000Z", "2025-03-10T16:00:00.000Z"),
        [],
        "user-1"
      );
      expect(conflicts).toHaveLength(1);
    });
  });

  describe("getEvents", () => {
    it("returns events within the date range", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      const events = await service.getEvents(
        new Date("2025-03-10T00:00:00.000Z"),
        new Date("2025-03-10T23:59:59.000Z"),
        []
      );
      expect(events).toHaveLength(2);
    });

    it("returns empty when no events in range", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      const events = await service.getEvents(
        new Date("2025-03-11T00:00:00.000Z"),
        new Date("2025-03-11T23:59:59.000Z"),
        []
      );
      expect(events).toHaveLength(0);
    });
  });

  describe("findBatchConflicts", () => {
    it("returns conflict info for each slot", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      const results = await service.findBatchConflicts(
        [
          {
            slot: makeSlot(
              "2025-03-10T09:30:00.000Z",
              "2025-03-10T10:30:00.000Z"
            ),
            taskId: "task-1",
          },
          {
            slot: makeSlot(
              "2025-03-10T11:00:00.000Z",
              "2025-03-10T12:00:00.000Z"
            ),
            taskId: "task-2",
          },
        ],
        [],
        "user-1"
      );
      expect(results).toHaveLength(2);
      expect(results[0].conflicts).toHaveLength(1);
      expect(results[0].taskId).toBe("task-1");
      expect(results[1].conflicts).toHaveLength(0);
      expect(results[1].taskId).toBe("task-2");
    });

    it("returns empty array for empty slots input", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      const results = await service.findBatchConflicts([], [], "user-1");
      expect(results).toHaveLength(0);
    });
  });

  describe("B2 overlap prevention", () => {
    it("detects conflict when slot exactly matches a window", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      // Slot 9:00–10:00 exactly matches window 9:00–10:00
      const conflicts = await service.findConflicts(
        makeSlot("2025-03-10T09:00:00.000Z", "2025-03-10T10:00:00.000Z"),
        [],
        "user-1"
      );
      expect(conflicts).toHaveLength(1);
    });

    it("detects conflict when slot is inside a window", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      // Slot 9:15–9:45 is inside window 9:00–10:00
      const conflicts = await service.findConflicts(
        makeSlot("2025-03-10T09:15:00.000Z", "2025-03-10T09:45:00.000Z"),
        [],
        "user-1"
      );
      expect(conflicts).toHaveLength(1);
    });

    it("allows slot adjacent to window (no gap, no overlap)", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      // Slot 10:00–10:30 starts exactly when window 9:00–10:00 ends
      const conflicts = await service.findConflicts(
        makeSlot("2025-03-10T10:00:00.000Z", "2025-03-10T10:30:00.000Z"),
        [],
        "user-1"
      );
      expect(conflicts).toHaveLength(0);
    });

    it("allows slot ending exactly when window starts", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      // Slot 8:30–9:00 ends exactly when window 9:00–10:00 starts
      const conflicts = await service.findConflicts(
        makeSlot("2025-03-10T08:30:00.000Z", "2025-03-10T09:00:00.000Z"),
        [],
        "user-1"
      );
      expect(conflicts).toHaveLength(0);
    });

    it("detects conflict with 1-minute overlap at start", async () => {
      const service = new ConflictWindowsCalendarService(windows);
      // Slot 8:30–9:01 overlaps window 9:00–10:00 by 1 minute
      const conflicts = await service.findConflicts(
        makeSlot("2025-03-10T08:30:00.000Z", "2025-03-10T09:01:00.000Z"),
        [],
        "user-1"
      );
      expect(conflicts).toHaveLength(1);
    });

    it("batch: filters overlapping and non-overlapping slots correctly", async () => {
      const service = new ConflictWindowsCalendarService([
        {
          start: "2025-03-10T10:00:00.000Z",
          end: "2025-03-10T11:00:00.000Z",
        },
      ]);
      const results = await service.findBatchConflicts(
        [
          {
            slot: makeSlot(
              "2025-03-10T09:00:00.000Z",
              "2025-03-10T09:30:00.000Z"
            ),
            taskId: "before",
          },
          {
            slot: makeSlot(
              "2025-03-10T09:30:00.000Z",
              "2025-03-10T10:00:00.000Z"
            ),
            taskId: "adjacent-before",
          },
          {
            slot: makeSlot(
              "2025-03-10T10:00:00.000Z",
              "2025-03-10T10:30:00.000Z"
            ),
            taskId: "inside",
          },
          {
            slot: makeSlot(
              "2025-03-10T10:30:00.000Z",
              "2025-03-10T11:00:00.000Z"
            ),
            taskId: "inside-end",
          },
          {
            slot: makeSlot(
              "2025-03-10T11:00:00.000Z",
              "2025-03-10T11:30:00.000Z"
            ),
            taskId: "adjacent-after",
          },
        ],
        [],
        "user-1"
      );
      // before: no conflict (9:00–9:30 vs 10:00–11:00)
      expect(results[0].conflicts).toHaveLength(0);
      // adjacent-before: no conflict (9:30–10:00 vs 10:00–11:00, touching only)
      expect(results[1].conflicts).toHaveLength(0);
      // inside: conflict (10:00–10:30 inside 10:00–11:00)
      expect(results[2].conflicts).toHaveLength(1);
      // inside-end: conflict (10:30–11:00 inside 10:00–11:00)
      expect(results[3].conflicts).toHaveLength(1);
      // adjacent-after: no conflict (11:00–11:30 vs 10:00–11:00, touching only)
      expect(results[4].conflicts).toHaveLength(0);
    });
  });

  describe("constructor", () => {
    it("handles empty conflict windows", async () => {
      const service = new ConflictWindowsCalendarService([]);
      const conflicts = await service.findConflicts(
        makeSlot("2025-03-10T09:00:00.000Z", "2025-03-10T10:00:00.000Z"),
        [],
        "user-1"
      );
      expect(conflicts).toHaveLength(0);
    });
  });
});
