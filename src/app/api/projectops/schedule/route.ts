import { NextRequest, NextResponse } from "next/server";

import { authenticateRequest } from "@/lib/auth/api-auth";
import { logger } from "@/lib/logger";
import { runProjectOpsSchedule } from "@/lib/projectops/schedulerFacade";
import { projectOpsScheduleRequestSchema } from "@/lib/projectops/validation";

const LOG_SOURCE = "projectops-schedule-route";

/**
 * POST /api/projectops/schedule
 * Accepts a Project Ops schedule request (timezone, tasks, optional settings),
 * runs the FluidCalendar scheduler, returns ScheduleResult.
 * Internal / dev harness use; requires authentication.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request, LOG_SOURCE);
    if ("response" in auth) {
      return auth.response;
    }
    const userId = auth.userId;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const parsed = projectOpsScheduleRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request body",
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const result = await runProjectOpsSchedule(parsed.data, userId);
    return NextResponse.json(result);
  } catch (error) {
    logger.error(
      "Project Ops schedule route failed",
      {
        error: error instanceof Error ? error.message : String(error),
      },
      LOG_SOURCE
    );
    return NextResponse.json(
      { error: "Failed to run schedule" },
      { status: 500 }
    );
  }
}
