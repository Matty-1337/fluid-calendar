/**
 * CalendarService adapter that uses conflict windows from the request payload
 * instead of querying FluidCalendar's database. This allows Project Ops to
 * supply its own calendar conflicts without needing FC calendar feeds.
 *
 * Implements the CalendarService interface from the scheduling engine.
 */

import { CalendarEvent } from "@prisma/client";

import { areIntervalsOverlapping, newDate } from "@/lib/date-utils";

import { Conflict, TimeSlot } from "@/types/scheduling";

import {
  BatchConflictCheck,
  CalendarService,
} from "@/services/scheduling/CalendarService";

interface ConflictWindow {
  start: string;
  end: string;
}

/**
 * Converts conflict windows from the request into synthetic CalendarEvents
 * and implements the CalendarService interface for the scheduling engine.
 */
export class ConflictWindowsCalendarService implements CalendarService {
  private events: CalendarEvent[];

  constructor(conflictWindows: ConflictWindow[]) {
    this.events = conflictWindows.map((w, i) => ({
      id: `conflict-window-${i}`,
      feedId: "projectops-conflict",
      externalEventId: null,
      title: "Busy (Project Ops)",
      description: null,
      start: newDate(w.start),
      end: newDate(w.end),
      location: null,
      isRecurring: false,
      recurrenceRule: null,
      allDay: false,
      status: "confirmed",
      sequence: null,
      created: null,
      lastModified: null,
      organizer: null,
      attendees: null,
      createdAt: newDate(),
      updatedAt: newDate(),
      isMaster: false,
      masterEventId: null,
      recurringEventId: null,
    }));
  }

  async findConflicts(
    slot: TimeSlot,
    _selectedCalendarIds: string[],
    _userId: string,
    _excludeTaskId?: string
  ): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];

    for (const event of this.events) {
      if (
        areIntervalsOverlapping(
          { start: slot.start, end: slot.end },
          { start: event.start, end: event.end }
        )
      ) {
        conflicts.push({
          type: "calendar_event",
          start: event.start,
          end: event.end,
          title: event.title,
          source: {
            type: "calendar",
            id: event.id,
          },
        });
        return conflicts;
      }
    }

    return conflicts;
  }

  async getEvents(
    start: Date,
    end: Date,
    _selectedCalendarIds: string[]
  ): Promise<CalendarEvent[]> {
    return this.events.filter(
      (event) => event.start <= end && event.end >= start
    );
  }

  async findBatchConflicts(
    slots: { slot: TimeSlot; taskId: string }[],
    _selectedCalendarIds: string[],
    _userId: string,
    _excludeTaskId?: string
  ): Promise<BatchConflictCheck[]> {
    if (!slots || slots.length === 0) {
      return [];
    }

    return slots.map(({ slot, taskId }) => {
      const conflicts: Conflict[] = [];

      for (const event of this.events) {
        if (
          areIntervalsOverlapping(
            { start: slot.start, end: slot.end },
            { start: event.start, end: event.end }
          )
        ) {
          conflicts.push({
            type: "calendar_event",
            start: event.start,
            end: event.end,
            title: event.title,
            source: {
              type: "calendar",
              id: event.id,
            },
          });
          break;
        }
      }

      return { slot, taskId, conflicts };
    });
  }
}
