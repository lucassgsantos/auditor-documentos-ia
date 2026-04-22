import { NextResponse } from "next/server";

import {
  createApiRequestContext,
  finalizeApiSuccessResponse,
  toApiErrorResponse,
} from "@/lib/server/api";
import { getApiMetricsSnapshot } from "@/lib/server/metrics";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestContext = createApiRequestContext(request, "/api/metrics");

  try {
    const snapshot = getApiMetricsSnapshot();

    return finalizeApiSuccessResponse(
      NextResponse.json({
        requestId: requestContext.requestId,
        ...snapshot,
      }),
      requestContext,
      {
        event: "metrics.snapshot",
        details: {
          routeCount: snapshot.routes.length,
          totalRequests: snapshot.totals.totalRequests,
        },
      },
    );
  } catch (error) {
    return toApiErrorResponse(error, requestContext);
  }
}
