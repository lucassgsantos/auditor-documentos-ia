import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createApiRequestContext,
  finalizeApiSuccessResponse,
  toApiErrorResponse,
} from "@/lib/server/api";
import { createProcessingSession, loadSession } from "@/lib/server/sessions";

const createSessionSchema = z.object({
  sourceType: z.enum(["upload", "baseline_seed"]).optional(),
  label: z.string().trim().max(120).optional(),
});

export async function POST(request: Request) {
  const requestContext = createApiRequestContext(request, "/api/sessions");

  try {
    const body = createSessionSchema.parse(await request.json().catch(() => ({})));
    const sessionId = await createProcessingSession(body);
    const session = await loadSession(sessionId);

    return finalizeApiSuccessResponse(
      NextResponse.json({ session }),
      requestContext,
      {
        event: "sessions.create",
        details: {
          sessionId,
          sourceType: body.sourceType ?? "upload",
        },
      },
    );
  } catch (error) {
    return toApiErrorResponse(error, requestContext);
  }
}
