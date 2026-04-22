import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

import { getAppConfig, type AiProvider, type AppConfig } from "@/lib/config";
import {
  deriveNotExtractedFields,
  type ParsedUploadedDocument,
  type RequiredFieldName,
} from "@/lib/documents/parser";

export const DOCUMENT_EXTRACTION_PROMPT_VERSION = "document-extractor-v2";

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentType: { type: ["string", "null"] },
    documentNumber: { type: ["string", "null"] },
    issueDateIso: { type: ["string", "null"] },
    supplierName: { type: ["string", "null"] },
    supplierCnpjNormalized: { type: ["string", "null"] },
    serviceDescription: { type: ["string", "null"] },
    grossAmount: { type: ["number", "null"] },
    paymentDateIso: { type: ["string", "null"] },
    invoiceIssueDateIso: { type: ["string", "null"] },
    approvedBy: { type: ["string", "null"] },
    destinationBank: { type: ["string", "null"] },
    status: { type: ["string", "null"] },
    verificationHash: { type: ["string", "null"] },
    observation: { type: ["string", "null"] },
    notExtractedFields: {
      type: "array",
      items: { type: "string" },
    },
  },
  required: [
    "documentType",
    "documentNumber",
    "issueDateIso",
    "supplierName",
    "supplierCnpjNormalized",
    "serviceDescription",
    "grossAmount",
    "paymentDateIso",
    "invoiceIssueDateIso",
    "approvedBy",
    "destinationBank",
    "status",
    "verificationHash",
    "observation",
    "notExtractedFields",
  ],
} as const;

let openAiClient: OpenAI | null = null;
let geminiClient: GoogleGenAI | null = null;

interface StructuredDocumentExtraction {
  documentType: string | null;
  documentNumber: string | null;
  issueDateIso: string | null;
  supplierName: string | null;
  supplierCnpjNormalized: string | null;
  serviceDescription: string | null;
  grossAmount: number | null;
  paymentDateIso: string | null;
  invoiceIssueDateIso: string | null;
  approvedBy: string | null;
  destinationBank: string | null;
  status: string | null;
  verificationHash: string | null;
  observation: string | null;
  notExtractedFields: string[];
}

interface ExtractionResult {
  document: ParsedUploadedDocument;
  provider: Exclude<AiProvider, "auto">;
  modelId: string;
}

interface ResolvedExtractionProvider {
  provider: Exclude<AiProvider, "auto">;
  modelId: string;
}

export function shouldUseAiExtraction(
  document: ParsedUploadedDocument,
  options?: { forceAiExtraction?: boolean },
) {
  if (options?.forceAiExtraction) {
    return true;
  }

  if (document.status !== "parsed") {
    return true;
  }

  if (
    document.warningCodes.length > 0 ||
    document.missingFields.length > 0 ||
    document.invalidLines.length > 0
  ) {
    return true;
  }

  return [
    document.normalized.documentType,
    document.normalized.documentNumber,
    document.normalized.supplierName,
    document.normalized.supplierCnpjNormalized,
    document.normalized.grossAmount,
    document.normalized.issueDateIso,
    document.normalized.paymentDateIso,
    document.normalized.approvedBy,
    document.normalized.destinationBank,
    document.normalized.status,
    document.normalized.verificationHash,
  ].some((value) => value === null || value === undefined || value === "");
}

export async function extractDocumentWithAi(
  document: ParsedUploadedDocument,
): Promise<ExtractionResult> {
  const resolvedProvider = resolveExtractionProvider(getAppConfig());

  if (resolvedProvider.provider === "gemini") {
    const extracted = await extractDocumentWithGemini(document, resolvedProvider.modelId);
    return {
      document: mergeExtraction(document, extracted),
      provider: resolvedProvider.provider,
      modelId: resolvedProvider.modelId,
    };
  }

  const extracted = await extractDocumentWithOpenAi(document, resolvedProvider.modelId);

  return {
    document: mergeExtraction(document, extracted),
    provider: resolvedProvider.provider,
    modelId: resolvedProvider.modelId,
  };
}

export function resolveExtractionProvider(
  config: Pick<
    AppConfig,
    "aiProvider" | "geminiApiKey" | "geminiModel" | "openAiApiKey" | "openAiModel"
  >,
): ResolvedExtractionProvider {
  if (config.aiProvider === "gemini") {
    assertProviderKey("GEMINI_API_KEY", config.geminiApiKey);
    return {
      provider: "gemini",
      modelId: config.geminiModel,
    };
  }

  if (config.aiProvider === "openai") {
    assertProviderKey("OPENAI_API_KEY", config.openAiApiKey);
    return {
      provider: "openai",
      modelId: config.openAiModel,
    };
  }

  if (config.geminiApiKey) {
    return {
      provider: "gemini",
      modelId: config.geminiModel,
    };
  }

  if (config.openAiApiKey) {
    return {
      provider: "openai",
      modelId: config.openAiModel,
    };
  }

  throw new Error("No AI provider is configured. Set GEMINI_API_KEY or OPENAI_API_KEY.");
}

async function extractDocumentWithGemini(
  document: ParsedUploadedDocument,
  modelId: string,
) {
  const client = getGeminiClient();

  const input = [
    "Extract the financial document into the schema.",
    "Use null for values you cannot confirm from the text.",
    "Do not invent values.",
    "Dates must be ISO YYYY-MM-DD when present.",
    "CNPJ must contain digits only.",
    "Gross amount must be a number without currency symbols.",
    "",
    "Parser hints:",
    JSON.stringify(document.normalized, null, 2),
    "",
    "Document text:",
    document.normalizedText,
  ].join("\n");

  const response = await withRetry(async () =>
    client.models.generateContent({
      model: modelId,
      contents: input,
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: EXTRACTION_SCHEMA,
      },
    }),
  );

  const outputText = response.text;
  if (!outputText) {
    throw new Error("Gemini returned an empty extraction payload.");
  }

  let extracted: StructuredDocumentExtraction;
  try {
    extracted = JSON.parse(outputText) as StructuredDocumentExtraction;
  } catch {
    throw new Error("Gemini returned malformed JSON in extraction payload.");
  }

  return extracted;
}

async function extractDocumentWithOpenAi(
  document: ParsedUploadedDocument,
  modelId: string,
) {
  const client = getOpenAiClient();

  const input = [
    "Extract the financial document into the schema.",
    "Use null for values you cannot confirm from the text.",
    "Do not invent values.",
    "Dates must be ISO YYYY-MM-DD when present.",
    "CNPJ must contain digits only.",
    "Gross amount must be a number without currency symbols.",
    "",
    "Parser hints:",
    JSON.stringify(document.normalized, null, 2),
    "",
    "Document text:",
    document.normalizedText,
  ].join("\n");

  const response = await withRetry(async () =>
    client.responses.create({
      model: modelId,
      store: false,
      instructions:
        "You extract structured data from Brazilian financial documents and must return valid JSON matching the schema exactly.",
      input,
      text: {
        format: {
          type: "json_schema",
          name: "financial_document_extraction",
          strict: true,
          schema: EXTRACTION_SCHEMA,
        },
      },
    }),
  );

  const outputText = response.output_text;
  if (!outputText) {
    throw new Error("OpenAI returned an empty extraction payload.");
  }

  let extracted: StructuredDocumentExtraction;
  try {
    extracted = JSON.parse(outputText) as StructuredDocumentExtraction;
  } catch {
    throw new Error("OpenAI returned malformed JSON in extraction payload.");
  }

  return extracted;
}

export function mergeExtraction(
  document: ParsedUploadedDocument,
  extracted: StructuredDocumentExtraction,
): ParsedUploadedDocument {
  const normalized = {
    ...document.normalized,
    documentType: extracted.documentType ?? document.normalized.documentType,
    documentNumber: extracted.documentNumber ?? document.normalized.documentNumber,
    issueDateIso: extracted.issueDateIso ?? document.normalized.issueDateIso,
    supplierName: extracted.supplierName ?? document.normalized.supplierName,
    serviceDescription:
      extracted.serviceDescription ?? document.normalized.serviceDescription,
    supplierCnpjNormalized:
      extracted.supplierCnpjNormalized ?? document.normalized.supplierCnpjNormalized,
    grossAmount: extracted.grossAmount ?? document.normalized.grossAmount,
    paymentDateIso: extracted.paymentDateIso ?? document.normalized.paymentDateIso,
    invoiceIssueDateIso:
      extracted.invoiceIssueDateIso ?? document.normalized.invoiceIssueDateIso,
    approvedBy: extracted.approvedBy ?? document.normalized.approvedBy,
    destinationBank: extracted.destinationBank ?? document.normalized.destinationBank,
    status: extracted.status ?? document.normalized.status,
    verificationHash:
      extracted.verificationHash ?? document.normalized.verificationHash,
    observation: extracted.observation ?? document.normalized.observation,
  };

  return {
    ...document,
    normalized,
    notExtractedFields: mergeNotExtractedFields(
      extracted.notExtractedFields,
      deriveNotExtractedFields(normalized),
    ),
  };
}

function mergeNotExtractedFields(
  aiReportedFields: string[],
  normalizedMissingFields: RequiredFieldName[],
): RequiredFieldName[] {
  const allowedFields = new Set<string>(normalizedMissingFields);

  for (const field of aiReportedFields) {
    if (field in REQUIRED_FIELD_MARKER) {
      allowedFields.add(field);
    }
  }

  return Array.from(allowedFields) as RequiredFieldName[];
}

const REQUIRED_FIELD_MARKER: Record<RequiredFieldName, true> = {
  TIPO_DOCUMENTO: true,
  NUMERO_DOCUMENTO: true,
  DATA_EMISSAO: true,
  FORNECEDOR: true,
  CNPJ_FORNECEDOR: true,
  DESCRICAO_SERVICO: true,
  VALOR_BRUTO: true,
  DATA_PAGAMENTO: true,
  DATA_EMISSAO_NF: true,
  APROVADO_POR: true,
  BANCO_DESTINO: true,
  STATUS: true,
  HASH_VERIFICACAO: true,
};

function getOpenAiClient() {
  if (openAiClient) {
    return openAiClient;
  }

  const { openAiApiKey } = getAppConfig();
  if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  openAiClient = new OpenAI({ apiKey: openAiApiKey });
  return openAiClient;
}

function getGeminiClient() {
  if (geminiClient) {
    return geminiClient;
  }

  const { geminiApiKey } = getAppConfig();
  assertProviderKey("GEMINI_API_KEY", geminiApiKey);

  geminiClient = new GoogleGenAI({ apiKey: geminiApiKey });
  return geminiClient;
}

function assertProviderKey(
  envName: "GEMINI_API_KEY" | "OPENAI_API_KEY",
  apiKey: string | null,
): asserts apiKey is string {
  if (!apiKey) {
    throw new Error(`${envName} is not configured.`);
  }
}

async function withRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!shouldRetry(error) || attempt === 3) {
        throw error;
      }

      const sleepMs = Math.round((350 + Math.random() * 200) * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));
    }
  }

  throw lastError;
}

function shouldRetry(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeStatus = "status" in error ? Number(error.status) : null;
  if (maybeStatus && [408, 409, 429, 500, 502, 503, 504].includes(maybeStatus)) {
    return true;
  }

  const maybeCode = "code" in error ? String(error.code) : "";
  return ["ETIMEDOUT", "ECONNRESET", "ECONNABORTED"].includes(maybeCode);
}
