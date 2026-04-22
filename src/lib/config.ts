export type AiProvider = "auto" | "gemini" | "openai";

export interface AppConfig {
  databaseUrl: string | null;
  aiProvider: AiProvider;
  geminiApiKey: string | null;
  geminiModel: string;
  openAiApiKey: string | null;
  openAiModel: string;
  maxUploadBytes: number;
  maxSessionFiles: number;
  forceAiExtraction: boolean;
}

let cachedConfig: AppConfig | null = null;

export function getAppConfig(): AppConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    databaseUrl: process.env.DATABASE_URL ?? null,
    aiProvider: normalizeAiProvider(process.env.AI_PROVIDER),
    geminiApiKey: process.env.GEMINI_API_KEY ?? null,
    geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite",
    openAiApiKey: process.env.OPENAI_API_KEY ?? null,
    openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 2_000_000),
    maxSessionFiles: Number(process.env.MAX_SESSION_FILES ?? 1_200),
    forceAiExtraction: normalizeBoolean(process.env.FORCE_AI_EXTRACTION),
  };

  return cachedConfig;
}

function normalizeBoolean(value: string | undefined) {
  return ["1", "true", "yes", "sim", "on"].includes(
    value?.trim().toLowerCase() ?? "",
  );
}

export function resetConfigCache() {
  cachedConfig = null;
}

function normalizeAiProvider(value: string | undefined): AiProvider {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "gemini" || normalized === "openai") {
    return normalized;
  }

  return "auto";
}
