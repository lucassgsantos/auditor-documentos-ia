import { buildAuditRows } from "@/lib/documents/exports";
import {
  extractDocumentWithAi,
  DOCUMENT_EXTRACTION_PROMPT_VERSION,
  shouldUseAiExtraction,
} from "@/lib/documents/extraction";
import { parseUploadedDocument } from "@/lib/documents/parser";
import { analyzeDocuments } from "@/lib/documents/anomalies";
import { getAppConfig } from "@/lib/config";
import { logApiEvent } from "@/lib/server/api";
import {
  countSessionDocuments,
  loadBaselineSeedDocuments,
  loadSession,
  loadSessionDocuments,
  loadSupplierBaselineProfile,
  replaceSessionAnalysis,
  replaceSupplierBaselines,
  saveProcessedDocument,
  type StoredDocumentRecord,
} from "@/lib/server/sessions";
import {
  assertSessionFileLimit,
  validateUploadDocumentInput,
} from "@/lib/server/upload-validation";

export async function ingestDocumentForSession(input: {
  sessionId: string;
  fileName: string;
  fileBytesBase64: string;
}) {
  logApiEvent("info", "processing.ingest.started", {
    sessionId: input.sessionId,
    fileName: input.fileName,
  });

  const { forceAiExtraction, maxSessionFiles, maxUploadBytes } = getAppConfig();
  const fileBytes = Buffer.from(input.fileBytesBase64, "base64");

  validateUploadDocumentInput({
    fileName: input.fileName,
    fileSize: fileBytes.byteLength,
    maxUploadBytes,
  });

  assertSessionFileLimit({
    currentFiles: await countSessionDocuments(input.sessionId),
    incomingFiles: 1,
    maxSessionFiles,
  });

  const parsed = parseUploadedDocument(input.fileName, fileBytes);
  let extracted = parsed;
  let extractionMethod = "parser-only";
  let modelId = "parser";

  if (shouldUseAiExtraction(parsed, { forceAiExtraction })) {
    try {
      const extraction = await extractDocumentWithAi(parsed);
      extracted = extraction.document;
      extractionMethod = `${extraction.provider}+parser`;
      modelId = extraction.modelId;

      logApiEvent("info", "processing.ingest.ai_extraction", {
        sessionId: input.sessionId,
        fileName: input.fileName,
        provider: extraction.provider,
        modelId,
      });
    } catch (error) {
      if (isConfigurationError(error)) {
        throw error;
      }

      extractionMethod = "parser-fallback";

      logApiEvent("warn", "processing.ingest.ai_fallback", {
        sessionId: input.sessionId,
        fileName: input.fileName,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  const documentId = await saveProcessedDocument({
    sessionId: input.sessionId,
    document: extracted,
    promptVersion: DOCUMENT_EXTRACTION_PROMPT_VERSION,
    modelId,
    extractionMethod,
  });

  logApiEvent("info", "processing.ingest.completed", {
    sessionId: input.sessionId,
    fileName: input.fileName,
    documentId,
    parseStatus: extracted.status,
    extractionMethod,
    modelId,
  });

  return {
    documentId,
    document: extracted,
    extractionMethod,
    modelId,
  };
}

export async function finalizeSession(sessionId: string) {
  const session = await loadSession(sessionId);
  if (!session) {
    throw new Error("Session not found.");
  }

  const storedDocuments = await loadSessionDocuments(sessionId);
  const currentDocuments = storedDocuments.map((document) => document.document);
  const persistedProfile =
    session.sourceType === "baseline_seed" ? null : await loadSupplierBaselineProfile();
  const historicalDocuments =
    session.sourceType === "baseline_seed"
      ? []
      : (await loadBaselineSeedDocuments()).map((document) => document.document);

  const analysis = analyzeDocuments({
    historicalDocuments,
    currentDocuments,
    referenceProfile:
      persistedProfile && persistedProfile.suppliers.size > 0
        ? persistedProfile
        : undefined,
  });

  const anomalyCount = analysis.documents.reduce(
    (sum, document) => sum + document.anomalies.length,
    0,
  );

  const anomaliesByFile = new Map(analysis.documents.map((item) => [item.fileName, item.anomalies]));
  const exportableDocuments: StoredDocumentRecord[] = storedDocuments.map((document) => ({
    ...document,
    anomalies: anomaliesByFile.get(document.document.fileName) ?? [],
  }));

  const auditRows = buildAuditRows(exportableDocuments);

  await replaceSessionAnalysis({
    sessionId,
    documents: exportableDocuments,
    analysis: analysis.documents,
    auditRows,
  });

  if (session.sourceType === "baseline_seed") {
    await replaceSupplierBaselines(analysis.profile);
  }

  logApiEvent("info", "processing.finalize.completed", {
    sessionId,
    sourceType: session.sourceType,
    documentCount: currentDocuments.length,
    anomalyCount,
  });

  return {
    session: await loadSession(sessionId),
    documents: await loadSessionDocuments(sessionId),
  };
}

function isConfigurationError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("GEMINI_API_KEY") ||
      error.message.includes("OPENAI_API_KEY") ||
      error.message.includes("No AI provider is configured") ||
      error.message.includes("DATABASE_URL"))
  );
}
