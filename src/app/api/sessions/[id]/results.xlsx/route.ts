import { NextResponse } from "next/server";

import { buildResultsWorkbookSheets } from "@/lib/documents/exports";
import { buildWorkbookBuffer } from "@/lib/documents/workbook";
import {
  createApiRequestContext,
  finalizeApiSuccessResponse,
  toApiErrorResponse,
} from "@/lib/server/api";
import { loadSessionDocuments } from "@/lib/server/sessions";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestContext = createApiRequestContext(request, "/api/sessions/:id/results.xlsx");

  try {
    const { id } = await context.params;
    const documents = await loadSessionDocuments(id);
    const rows = buildResultsWorkbookSheets(documents);
    const buffer = await buildWorkbookBuffer(rows);

    return finalizeApiSuccessResponse(
      new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="session-${id}-results.xlsx"`,
        },
      }),
      requestContext,
      {
        event: "sessions.export.results",
        details: {
          sessionId: id,
          rowCount: documents.length,
        },
      },
    );
  } catch (error) {
    return toApiErrorResponse(error, requestContext);
  }
}
