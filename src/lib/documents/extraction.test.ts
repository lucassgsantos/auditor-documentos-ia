import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseUploadedDocument } from "@/lib/documents/parser";

async function loadFixture(fileName: string) {
  const fixturePath = path.resolve(process.cwd(), "..", fileName);
  return readFile(fixturePath);
}

describe("resolveExtractionProvider", () => {
  it("prefers Gemini in auto mode when both providers are configured", async () => {
    const extractionModule = (await import("@/lib/documents/extraction")) as Record<
      string,
      unknown
    >;
    const resolveExtractionProvider = extractionModule.resolveExtractionProvider as
      | ((config: {
          aiProvider: string;
          geminiApiKey: string | null;
          geminiModel: string;
          openAiApiKey: string | null;
          openAiModel: string;
        }) => { provider: string; modelId: string })
      | undefined;

    expect(typeof resolveExtractionProvider).toBe("function");
    expect(
      resolveExtractionProvider?.({
        aiProvider: "auto",
        geminiApiKey: "gemini-test-key",
        geminiModel: "gemini-2.5-flash-lite",
        openAiApiKey: "openai-test-key",
        openAiModel: "gpt-4.1-mini",
      }),
    ).toEqual({
      provider: "gemini",
      modelId: "gemini-2.5-flash-lite",
    });
  });

  it("throws a configuration error when Gemini is selected without a Gemini key", async () => {
    const extractionModule = (await import("@/lib/documents/extraction")) as Record<
      string,
      unknown
    >;
    const resolveExtractionProvider = extractionModule.resolveExtractionProvider as
      | ((config: {
          aiProvider: string;
          geminiApiKey: string | null;
          geminiModel: string;
          openAiApiKey: string | null;
          openAiModel: string;
        }) => { provider: string; modelId: string })
      | undefined;

    expect(typeof resolveExtractionProvider).toBe("function");
    expect(() =>
      resolveExtractionProvider?.({
        aiProvider: "gemini",
        geminiApiKey: null,
        geminiModel: "gemini-2.5-flash-lite",
        openAiApiKey: "openai-test-key",
        openAiModel: "gpt-4.1-mini",
      }),
    ).toThrow(/GEMINI_API_KEY/i);
  });
});

describe("shouldUseAiExtraction", () => {
  it("skips AI when the deterministic parser already extracted a clean document", async () => {
    const extractionModule = (await import("@/lib/documents/extraction")) as Record<
      string,
      unknown
    >;
    const shouldUseAiExtraction = extractionModule.shouldUseAiExtraction as
      | ((document: Awaited<ReturnType<typeof parseUploadedDocument>>) => boolean)
      | undefined;
    const bytes = await loadFixture("DOC_0001.txt");
    const parsed = parseUploadedDocument("DOC_0001.txt", bytes);

    expect(typeof shouldUseAiExtraction).toBe("function");
    expect(shouldUseAiExtraction?.(parsed)).toBe(false);
  });

  it("uses AI when the parser marks the document as partial or suspicious", async () => {
    const extractionModule = (await import("@/lib/documents/extraction")) as Record<
      string,
      unknown
    >;
    const shouldUseAiExtraction = extractionModule.shouldUseAiExtraction as
      | ((document: Awaited<ReturnType<typeof parseUploadedDocument>>) => boolean)
      | undefined;
    const bytes = await loadFixture("DOC_0089.txt");
    const parsed = parseUploadedDocument("DOC_0089.txt", bytes);

    expect(typeof shouldUseAiExtraction).toBe("function");
    expect(shouldUseAiExtraction?.(parsed)).toBe(true);
  });

  it("can force AI extraction even when the deterministic parser is clean", async () => {
    const extractionModule = (await import("@/lib/documents/extraction")) as Record<
      string,
      unknown
    >;
    const shouldUseAiExtraction = extractionModule.shouldUseAiExtraction as
      | ((
          document: Awaited<ReturnType<typeof parseUploadedDocument>>,
          options?: { forceAiExtraction?: boolean },
        ) => boolean)
      | undefined;
    const bytes = await loadFixture("DOC_0001.txt");
    const parsed = parseUploadedDocument("DOC_0001.txt", bytes);

    expect(shouldUseAiExtraction?.(parsed, { forceAiExtraction: true })).toBe(true);
  });
});

describe("mergeExtraction", () => {
  it("persists AI not-extracted fields and fills service description", async () => {
    const extractionModule = (await import("@/lib/documents/extraction")) as Record<
      string,
      unknown
    >;
    const mergeExtraction = extractionModule.mergeExtraction as
      | ((document: ReturnType<typeof parseUploadedDocument>, extracted: Record<string, unknown>) => ReturnType<typeof parseUploadedDocument>)
      | undefined;
    const bytes = await loadFixture("DOC_0089.txt");
    const parsed = parseUploadedDocument("DOC_0089.txt", bytes);

    const merged = mergeExtraction?.(parsed, {
      documentType: "NOTA_FISCAL",
      documentNumber: "NF-TESTE",
      issueDateIso: "2025-01-01",
      supplierName: "Fornecedor Teste",
      supplierCnpjNormalized: "12345678000190",
      serviceDescription: "Serviço recuperado pela IA",
      grossAmount: 100,
      paymentDateIso: "2025-01-02",
      invoiceIssueDateIso: "2025-01-01",
      approvedBy: "Maria Silva",
      destinationBank: "Banco Teste",
      status: "PAGO",
      verificationHash: null,
      observation: null,
      notExtractedFields: ["HASH_VERIFICACAO"],
    });

    expect((merged?.normalized as Record<string, unknown>).serviceDescription).toBe(
      "Serviço recuperado pela IA",
    );
    expect((merged as unknown as { notExtractedFields: string[] }).notExtractedFields).toEqual([
      "HASH_VERIFICACAO",
    ]);
  });
});
