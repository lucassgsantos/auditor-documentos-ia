interface RouteMetricsBucket {
  route: string;
  totalRequests: number;
  successResponses: number;
  clientErrorResponses: number;
  serverErrorResponses: number;
  cumulativeDurationMs: number;
  maxDurationMs: number;
  lastDurationMs: number;
  lastStatusCode: number;
  lastRequestAtIso: string;
}

const routeMetrics = new Map<string, RouteMetricsBucket>();

export interface ApiRouteObservation {
  route: string;
  status: number;
  durationMs: number;
}

export function observeApiRouteMetric(observation: ApiRouteObservation) {
  const route = observation.route.trim();
  if (route.length === 0) {
    return;
  }

  const bucket = routeMetrics.get(route) ?? {
    route,
    totalRequests: 0,
    successResponses: 0,
    clientErrorResponses: 0,
    serverErrorResponses: 0,
    cumulativeDurationMs: 0,
    maxDurationMs: 0,
    lastDurationMs: 0,
    lastStatusCode: 0,
    lastRequestAtIso: new Date(0).toISOString(),
  };

  bucket.totalRequests += 1;
  bucket.cumulativeDurationMs += observation.durationMs;
  bucket.maxDurationMs = Math.max(bucket.maxDurationMs, observation.durationMs);
  bucket.lastDurationMs = observation.durationMs;
  bucket.lastStatusCode = observation.status;
  bucket.lastRequestAtIso = new Date().toISOString();

  if (observation.status >= 500) {
    bucket.serverErrorResponses += 1;
  } else if (observation.status >= 400) {
    bucket.clientErrorResponses += 1;
  } else {
    bucket.successResponses += 1;
  }

  routeMetrics.set(route, bucket);
}

export function getApiMetricsSnapshot() {
  const routes = Array.from(routeMetrics.values())
    .sort((left, right) => left.route.localeCompare(right.route))
    .map((bucket) => {
      const averageDurationMs =
        bucket.totalRequests > 0
          ? Number((bucket.cumulativeDurationMs / bucket.totalRequests).toFixed(2))
          : 0;

      return {
        route: bucket.route,
        totalRequests: bucket.totalRequests,
        successResponses: bucket.successResponses,
        clientErrorResponses: bucket.clientErrorResponses,
        serverErrorResponses: bucket.serverErrorResponses,
        averageDurationMs,
        maxDurationMs: bucket.maxDurationMs,
        lastDurationMs: bucket.lastDurationMs,
        lastStatusCode: bucket.lastStatusCode,
        lastRequestAtIso: bucket.lastRequestAtIso,
      };
    });

  const totals = routes.reduce(
    (accumulator, route) => {
      accumulator.totalRequests += route.totalRequests;
      accumulator.successResponses += route.successResponses;
      accumulator.clientErrorResponses += route.clientErrorResponses;
      accumulator.serverErrorResponses += route.serverErrorResponses;
      accumulator.cumulativeDurationMs +=
        route.averageDurationMs * route.totalRequests;
      accumulator.maxDurationMs = Math.max(accumulator.maxDurationMs, route.maxDurationMs);
      return accumulator;
    },
    {
      totalRequests: 0,
      successResponses: 0,
      clientErrorResponses: 0,
      serverErrorResponses: 0,
      cumulativeDurationMs: 0,
      maxDurationMs: 0,
    },
  );

  return {
    capturedAtIso: new Date().toISOString(),
    totals: {
      totalRequests: totals.totalRequests,
      successResponses: totals.successResponses,
      clientErrorResponses: totals.clientErrorResponses,
      serverErrorResponses: totals.serverErrorResponses,
      averageDurationMs:
        totals.totalRequests > 0
          ? Number((totals.cumulativeDurationMs / totals.totalRequests).toFixed(2))
          : 0,
      maxDurationMs: totals.maxDurationMs,
    },
    routes,
  };
}

export function resetApiMetrics() {
  routeMetrics.clear();
}
