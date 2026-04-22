import { afterEach, describe, expect, it, vi } from "vitest";

import { getAppConfig, resetConfigCache } from "@/lib/config";

afterEach(() => {
  vi.unstubAllEnvs();
  resetConfigCache();
});

describe("getAppConfig", () => {
  it("defaults to Gemini free-tier settings when no provider is explicitly selected", () => {
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubEnv("OPENAI_API_KEY", "openai-test-key");
    vi.stubEnv("AI_PROVIDER", "");

    const config = getAppConfig() as Record<string, unknown>;

    expect(config.aiProvider).toBe("auto");
    expect(config.geminiApiKey).toBe("gemini-test-key");
    expect(config.geminiModel).toBe("gemini-2.5-flash-lite");
    expect(config.openAiApiKey).toBe("openai-test-key");
  });

  it("honors an explicit provider selection from the environment", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("OPENAI_MODEL", "gpt-4.1-mini");

    const config = getAppConfig() as Record<string, unknown>;

    expect(config.aiProvider).toBe("openai");
    expect(config.openAiModel).toBe("gpt-4.1-mini");
  });

  it("exposes review safety limits and the optional forced AI mode", () => {
    vi.stubEnv("FORCE_AI_EXTRACTION", "true");
    vi.stubEnv("MAX_SESSION_FILES", "25");

    const config = getAppConfig() as Record<string, unknown>;

    expect(config.forceAiExtraction).toBe(true);
    expect(config.maxSessionFiles).toBe(25);
  });
});
