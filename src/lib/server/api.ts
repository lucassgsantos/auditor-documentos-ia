import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { observeApiRouteMetric } from "@/lib/server/metrics";

export interface ApiRequestContext {
  requestId: string;
  route: string;
  method: string;
  startedAtMs: number;
}

type LogLevel = "info" | "warn" | "error";

interface SuccessResponseOptions {
  event?: string;
  details?: Record<string, unknown>;
}

export function createApiRequestContext(request: Request, route: string): ApiRequestContext {
  const incomingRequestId = request.headers.get("x-request-id")?.trim();

  return {
    requestId: incomingRequestId && incomingRequestId.length > 0 ? incomingRequestId : randomUUID(),
    route,
    method: request.method,
    startedAtMs: Date.now(),
  };
}

export function withRequestId(response: NextResponse, requestId: string) {
  response.headers.set("x-request-id", requestId);
  return response;
}

export function finalizeApiSuccessResponse(
  response: NextResponse,
  context: ApiRequestContext,
  options?: SuccessResponseOptions,
) {
  const finalizedResponse = withRequestId(response, context.requestId);
  const durationMs = elapsedDurationMs(context);

  observeIfPossible(context, finalizedResponse.status, durationMs);

  logApiEvent("info", options?.event ?? "api.success", {
    requestId: context.requestId,
    route: context.route,
    method: context.method,
    status: finalizedResponse.status,
    durationMs,
    ...(options?.details ?? {}),
  });

  return finalizedResponse;
}

export function logApiEvent(level: LogLevel, event: string, details: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };

  const serializedEntry = JSON.stringify(entry);

  if (level === "error") {
    console.error(serializedEntry);
    return;
  }

  if (level === "warn") {
    console.warn(serializedEntry);
    return;
  }

  console.info(serializedEntry);
}

export function toApiErrorResponse(
  error: unknown,
  context?: Partial<ApiRequestContext>,
) {
  const durationMs = elapsedDurationMs(context);

  if (error instanceof ZodError) {
    observeIfPossible(context, 400, durationMs);

    logApiEvent("warn", "api.error", {
      requestId: context?.requestId ?? null,
      route: context?.route ?? null,
      method: context?.method ?? null,
      status: 400,
      reason: "validation_error",
      durationMs,
    });

    return attachRequestId(
      NextResponse.json(
        {
          error: "Invalid request payload.",
          details: error.flatten(),
          requestId: context?.requestId,
        },
        { status: 400 },
      ),
      context,
    );
  }

  if (error instanceof Error) {
    const message = error.message;
    const status = message.includes("not configured")
      ? 503
      : message.includes("not found")
        ? 404
        : message.includes(".txt") ||
            message.includes("Nome de arquivo") ||
            message.includes("Arquivo vazio") ||
            message.includes("lote excede")
          ? 400
          : message.includes("maximum size") || message.includes("acima do limite")
            ? 413
            : 500;

    observeIfPossible(context, status, durationMs);

    logApiEvent(status >= 500 ? "error" : "warn", "api.error", {
      requestId: context?.requestId ?? null,
      route: context?.route ?? null,
      method: context?.method ?? null,
      status,
      message: error.message,
      errorName: error.name,
      durationMs,
    });

    return attachRequestId(
      NextResponse.json(
        {
          error:
            status === 500
              ? "An internal error occurred while processing the request."
              : error.message,
          requestId: context?.requestId,
        },
        { status },
      ),
      context,
    );
  }

  observeIfPossible(context, 500, durationMs);

  logApiEvent("error", "api.error", {
    requestId: context?.requestId ?? null,
    route: context?.route ?? null,
    method: context?.method ?? null,
    status: 500,
    reason: "non_error_throwable",
    durationMs,
  });

  return attachRequestId(
    NextResponse.json(
      {
        error: "An internal error occurred while processing the request.",
        requestId: context?.requestId,
      },
      { status: 500 },
    ),
    context,
  );
}

function attachRequestId(
  response: NextResponse,
  context?: Partial<ApiRequestContext>,
) {
  if (context?.requestId) {
    response.headers.set("x-request-id", context.requestId);
  }

  return response;
}

function elapsedDurationMs(context?: Partial<ApiRequestContext>) {
  if (typeof context?.startedAtMs !== "number") {
    return null;
  }

  return Math.max(0, Date.now() - context.startedAtMs);
}

function observeIfPossible(
  context: Partial<ApiRequestContext> | undefined,
  status: number,
  durationMs: number | null,
) {
  if (!context?.route || durationMs === null) {
    return;
  }

  observeApiRouteMetric({
    route: context.route,
    status,
    durationMs,
  });
}
