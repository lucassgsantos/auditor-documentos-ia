import { NextResponse } from "next/server";

import { AUDIT_COLUMN_LABELS } from "@/lib/documents/exports";
import { buildWorkbookBuffer } from "@/lib/documents/workbook";
import {
  createApiRequestContext,
  finalizeApiSuccessResponse,
  toApiErrorResponse,
} from "@/lib/server/api";
import { loadSessionAuditRows } from "@/lib/server/sessions";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestContext = createApiRequestContext(request, "/api/sessions/:id/audit.xlsx");

  try {
    const { id } = await context.params;
    const rows = await loadSessionAuditRows(id);
    const buffer = await buildWorkbookBuffer([{ name: "audit", rows, columnLabels: AUDIT_COLUMN_LABELS }]);

    return finalizeApiSuccessResponse(
      new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="session-${id}-audit.xlsx"`,
        },
      }),
      requestContext,
      {
        event: "sessions.export.audit",
        details: {
          sessionId: id,
          rowCount: rows.length,
        },
      },
    );
  } catch (error) {
    return toApiErrorResponse(error, requestContext);
  }
}
