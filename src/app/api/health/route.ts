import { NextResponse } from "next/server";

import { getAppConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { getApiMetricsSnapshot } from "@/lib/server/metrics";
import {
  createApiRequestContext,
  finalizeApiSuccessResponse,
  toApiErrorResponse,
} from "@/lib/server/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestContext = createApiRequestContext(request, "/api/health");

  try {
    const config = getAppConfig();

    const aiConfigured =
      (config.aiProvider === "gemini" && Boolean(config.geminiApiKey)) ||
      (config.aiProvider === "openai" && Boolean(config.openAiApiKey)) ||
      (config.aiProvider === "auto" &&
        Boolean(config.geminiApiKey || config.openAiApiKey));

    const databaseCheck = await checkDatabase();
    const apiMetrics = getApiMetricsSnapshot();
    const apiCheck = {
      ok: apiMetrics.totals.serverErrorResponses === 0,
      totalRequests: apiMetrics.totals.totalRequests,
      serverErrorResponses: apiMetrics.totals.serverErrorResponses,
      averageDurationMs: apiMetrics.totals.averageDurationMs,
      maxDurationMs: apiMetrics.totals.maxDurationMs,
    };

    const isHealthy = databaseCheck.ok && aiConfigured;
    const status = isHealthy ? 200 : 503;

    return finalizeApiSuccessResponse(
      NextResponse.json(
        {
          status: isHealthy ? "ok" : "degraded",
          timestamp: new Date().toISOString(),
          requestId: requestContext.requestId,
          checks: {
            database: databaseCheck,
            ai: {
              ok: aiConfigured,
              providerMode: config.aiProvider,
              geminiConfigured: Boolean(config.geminiApiKey),
              openAiConfigured: Boolean(config.openAiApiKey),
            },
            api: apiCheck,
          },
        },
        {
          status,
        },
      ),
      requestContext,
      {
        event: "health.check",
        details: {
          status,
          databaseOk: databaseCheck.ok,
          aiOk: aiConfigured,
          aiProviderMode: config.aiProvider,
          apiTotalRequests: apiMetrics.totals.totalRequests,
          apiServerErrors: apiMetrics.totals.serverErrorResponses,
        },
      },
    );
  } catch (error) {
    return toApiErrorResponse(error, requestContext);
  }
}

async function checkDatabase() {
  try {
    const db = getDb();
    await db`SELECT 1`;
    return {
      ok: true,
      reason: null,
    };
  } catch (error) {
    return {
      ok: false,
      reason: mapDatabaseError(error),
    };
  }
}

function mapDatabaseError(error: unknown) {
  if (!(error instanceof Error)) {
    return "connection_failed";
  }

  if (error.message.includes("DATABASE_URL")) {
    return "not_configured";
  }

  return "connection_failed";
}
