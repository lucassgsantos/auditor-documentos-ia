import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createApiRequestContext,
  finalizeApiSuccessResponse,
  logApiEvent,
  toApiErrorResponse,
} from "@/lib/server/api";
import { ingestDocumentForSession } from "@/lib/server/processing";

const uploadDocumentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  fileBytesBase64: z.string().min(1),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestContext = createApiRequestContext(request, "/api/sessions/:id/documents");

  try {
    const { id } = await context.params;
    const body = uploadDocumentSchema.parse(await request.json());

    logApiEvent("info", "sessions.documents.ingest.started", {
      requestId: requestContext.requestId,
      route: requestContext.route,
      method: requestContext.method,
      sessionId: id,
      fileName: body.fileName,
    });

    const result = await ingestDocumentForSession({
      sessionId: id,
      ...body,
    });

    return finalizeApiSuccessResponse(
      NextResponse.json(result),
      requestContext,
      {
        event: "sessions.documents.ingest.completed",
        details: {
          sessionId: id,
          fileName: body.fileName,
          parseStatus: result.document.status,
          extractionMethod: result.extractionMethod,
          modelId: result.modelId,
        },
      },
    );
  } catch (error) {
    return toApiErrorResponse(error, requestContext);
  }
}
