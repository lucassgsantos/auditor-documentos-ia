import { NextResponse } from "next/server";

import {
  createApiRequestContext,
  finalizeApiSuccessResponse,
  toApiErrorResponse,
} from "@/lib/server/api";
import { finalizeSession } from "@/lib/server/processing";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestContext = createApiRequestContext(request, "/api/sessions/:id/finalize");

  try {
    const { id } = await context.params;
    const result = await finalizeSession(id);

    return finalizeApiSuccessResponse(
      NextResponse.json(result),
      requestContext,
      {
        event: "sessions.finalize",
        details: {
          sessionId: id,
          status: result.session?.status ?? null,
          processedFiles: result.session?.processedFiles ?? null,
          totalFiles: result.session?.totalFiles ?? null,
        },
      },
    );
  } catch (error) {
    return toApiErrorResponse(error, requestContext);
  }
}
