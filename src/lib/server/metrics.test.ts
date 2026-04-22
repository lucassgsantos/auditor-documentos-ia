import { describe, expect, it, beforeEach } from "vitest";

import {
  getApiMetricsSnapshot,
  observeApiRouteMetric,
  resetApiMetrics,
} from "@/lib/server/metrics";

describe("api metrics", () => {
  beforeEach(() => {
    resetApiMetrics();
  });

  it("aggregates route status classes and latency", () => {
    observeApiRouteMetric({ route: "/api/sessions", status: 200, durationMs: 20 });
    observeApiRouteMetric({ route: "/api/sessions", status: 400, durationMs: 10 });
    observeApiRouteMetric({ route: "/api/sessions", status: 503, durationMs: 30 });

    const snapshot = getApiMetricsSnapshot();
    const sessions = snapshot.routes.find((route) => route.route === "/api/sessions");

    expect(sessions).toBeDefined();
    expect(sessions?.totalRequests).toBe(3);
    expect(sessions?.successResponses).toBe(1);
    expect(sessions?.clientErrorResponses).toBe(1);
    expect(sessions?.serverErrorResponses).toBe(1);
    expect(sessions?.averageDurationMs).toBe(20);
    expect(sessions?.maxDurationMs).toBe(30);
    expect(snapshot.totals.totalRequests).toBe(3);
    expect(snapshot.totals.serverErrorResponses).toBe(1);
  });

  it("keeps independent counters per route", () => {
    observeApiRouteMetric({ route: "/api/health", status: 200, durationMs: 5 });
    observeApiRouteMetric({ route: "/api/metrics", status: 200, durationMs: 7 });

    const snapshot = getApiMetricsSnapshot();

    expect(snapshot.routes).toHaveLength(2);
    expect(snapshot.totals.totalRequests).toBe(2);
    expect(snapshot.totals.averageDurationMs).toBe(6);
  });
});
