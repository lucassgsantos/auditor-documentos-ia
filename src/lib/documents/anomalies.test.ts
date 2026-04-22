import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { analyzeDocuments, buildReferenceProfile } from "@/lib/documents/anomalies";
import { parseUploadedDocument, type ParsedUploadedDocument } from "@/lib/documents/parser";

async function parseFixture(fileName: string) {
  const fixturePath = path.resolve(process.cwd(), "..", fileName);
  const bytes = await readFile(fixturePath);
  return parseUploadedDocument(fileName, bytes);
}

function makeSyntheticDocument(
  fileName: string,
  supplierName: string,
  grossAmount: number,
): ParsedUploadedDocument {
  return {
    fileName,
    encoding: "utf-8",
    rawText: "",
    normalizedText: "",
    fields: {},
    invalidLines: [],
    missingFields: [],
    notExtractedFields: [],
    warningCodes: [],
    status: "parsed",
    normalized: {
      documentType: "NOTA_FISCAL",
      documentNumber: fileName.replace(".txt", ""),
      serviceDescription: "Serviço sintético",
      supplierName,
      supplierCnpjRaw: "12.345.678/0001-90",
      supplierCnpjNormalized: "12345678000190",
      grossAmountRaw: `R$ ${grossAmount.toFixed(2)}`,
      grossAmount,
      issueDateIso: "2025-01-10",
      paymentDateIso: "2025-01-12",
      invoiceIssueDateIso: "2025-01-09",
      status: "PAGO",
      verificationHash: `NLC${fileName.replace(/\D/g, "").padStart(10, "0")}`,
      approvedBy: "Maria Silva",
      destinationBank: "Banco do Brasil Ag.1234 C/C 56789-0",
      observation: null,
    },
  };
}

describe("buildReferenceProfile", () => {
  it("creates canonical supplier baselines from historical documents", async () => {
    const historicalDocuments = await Promise.all([
      parseFixture("DOC_0001.txt"),
      parseFixture("DOC_0020.txt"),
      parseFixture("DOC_0200.txt"),
    ]);

    const profile = buildReferenceProfile(historicalDocuments);

    expect(profile.suppliers.get("TechSoft Ltda")?.canonicalCnpj).toBe("12345678000190");
    expect(profile.suppliers.get("Marketing Digital Pro")?.seenDocumentNumbers.has("NF-24322")).toBe(true);
    expect(profile.knownApprovers.has("Maria Silva")).toBe(true);
  });
});

describe("analyzeDocuments", () => {
  it("flags duplicate document numbers for the same supplier", async () => {
    const currentDocuments = await Promise.all([
      parseFixture("DOC_0150.txt"),
      parseFixture("DOC_0151.txt"),
    ]);

    const analysis = analyzeDocuments({ currentDocuments });

    expect(analysis.documents.every((document) =>
      document.anomalies.some((anomaly) => anomaly.type === "DUPLICATE_DOCUMENT"),
    )).toBe(true);

    const firstDuplicate = analysis.documents[0]?.anomalies.find((anomaly) => anomaly.type === "DUPLICATE_DOCUMENT");
    const secondDuplicate = analysis.documents[1]?.anomalies.find((anomaly) => anomaly.type === "DUPLICATE_DOCUMENT");

    expect(firstDuplicate?.evidence.relatedCurrentFiles).toEqual(["DOC_0151.txt"]);
    expect(secondDuplicate?.evidence.relatedCurrentFiles).toEqual(["DOC_0150.txt"]);
  });

  it("stores which historical files caused a duplicate match", async () => {
    const historicalDocuments = await Promise.all([parseFixture("DOC_0001.txt")]);
    const currentDocuments = await Promise.all([parseFixture("DOC_0001.txt")]);
    currentDocuments[0]!.fileName = "DOC_FRAUD.txt";

    const analysis = analyzeDocuments({ historicalDocuments, currentDocuments });
    const duplicate = analysis.documents[0]?.anomalies.find((anomaly) => anomaly.type === "DUPLICATE_DOCUMENT");

    expect(duplicate?.evidence.duplicateAgainstHistoricalReference).toBe(true);
    expect(duplicate?.evidence.relatedHistoricalFiles).toEqual(["DOC_0001.txt"]);
  });

  it("suppresses the duplicate flag when the same file is re-uploaded (same fileName + hash)", async () => {
    const historicalDocuments = await Promise.all([parseFixture("DOC_0001.txt")]);
    const currentDocuments = await Promise.all([parseFixture("DOC_0001.txt")]);

    const analysis = analyzeDocuments({ historicalDocuments, currentDocuments });
    const duplicate = analysis.documents[0]?.anomalies.find((anomaly) => anomaly.type === "DUPLICATE_DOCUMENT");

    expect(duplicate).toBeUndefined();
  });

  it("flags divergent supplier CNPJ values against the historical baseline", async () => {
    const historicalDocuments = await Promise.all([parseFixture("DOC_0020.txt")]);
    const currentDocuments = await Promise.all([
      parseFixture("DOC_0300.txt"),
      parseFixture("DOC_0301.txt"),
      parseFixture("DOC_0302.txt"),
    ]);

    const analysis = analyzeDocuments({ historicalDocuments, currentDocuments });

    expect(analysis.documents.every((document) =>
      document.anomalies.some((anomaly) => anomaly.type === "CNPJ_DIVERGENT"),
    )).toBe(true);
  });

  it("can use a persisted reference profile instead of rebuilding from historical documents", async () => {
    const historicalDocuments = await Promise.all([parseFixture("DOC_0020.txt")]);
    const currentDocuments = await Promise.all([parseFixture("DOC_0300.txt")]);
    const referenceProfile = buildReferenceProfile(historicalDocuments);
    const analyzeWithPersistedProfile = analyzeDocuments as unknown as (input: {
      referenceProfile: ReturnType<typeof buildReferenceProfile>;
      currentDocuments: ParsedUploadedDocument[];
    }) => ReturnType<typeof analyzeDocuments>;

    const analysis = analyzeWithPersistedProfile({ referenceProfile, currentDocuments });

    expect(analysis.documents[0]?.anomalies.some((anomaly) => anomaly.type === "CNPJ_DIVERGENT")).toBe(true);
  });

  it("does not flood the synthetic corpus with non-brief soft rules", async () => {
    const currentDocuments = await Promise.all([
      parseFixture("DOC_0001.txt"),
      parseFixture("DOC_0003.txt"),
    ]);

    const analysis = analyzeDocuments({ currentDocuments });
    const noisyTypes = new Set(["CNPJ_CHECKSUM_INVALID", "DOCUMENT_NUMBER_PREFIX_MISMATCH"]);

    expect(
      analysis.documents.flatMap((document) =>
        document.anomalies.filter((anomaly) => noisyTypes.has(anomaly.type)),
      ),
    ).toEqual([]);
  });

  it("flags invoice dates later than payment dates", async () => {
    const currentDocuments = await Promise.all([
      parseFixture("DOC_0750.txt"),
      parseFixture("DOC_0751.txt"),
    ]);

    const analysis = analyzeDocuments({ currentDocuments });

    expect(analysis.documents.every((document) =>
      document.anomalies.some((anomaly) => anomaly.type === "INVOICE_AFTER_PAYMENT"),
    )).toBe(true);
  });

  it("flags unrecognized approvers when they are absent from the baseline", async () => {
    const historicalDocuments = await Promise.all([
      parseFixture("DOC_0001.txt"),
      parseFixture("DOC_0002.txt"),
      parseFixture("DOC_0089.txt"),
      parseFixture("DOC_0200.txt"),
      parseFixture("DOC_0301.txt"),
    ]);
    const currentDocuments = await Promise.all([parseFixture("DOC_0850.txt")]);

    const analysis = analyzeDocuments({ historicalDocuments, currentDocuments });

    expect(analysis.documents[0]?.anomalies.some((anomaly) => anomaly.type === "APPROVER_UNRECOGNIZED")).toBe(true);
  });

  it("flags suppliers without history and suspicious revised files", async () => {
    const historicalDocuments = await Promise.all([
      parseFixture("DOC_0001.txt"),
      parseFixture("DOC_0200.txt"),
    ]);
    const currentDocuments = await Promise.all([
      parseFixture("DOC_0451.txt"),
      parseFixture("DOC_0633_v2.txt"),
    ]);

    const analysis = analyzeDocuments({ historicalDocuments, currentDocuments });

    const byFile = new Map(analysis.documents.map((document) => [document.fileName, document]));

    expect(byFile.get("DOC_0451.txt")?.anomalies.some((anomaly) => anomaly.type === "SUPPLIER_WITHOUT_HISTORY")).toBe(true);
    expect(byFile.get("DOC_0633_v2.txt")?.anomalies.some((anomaly) => anomaly.type === "FILENAME_VERSIONED")).toBe(true);
    expect(byFile.get("DOC_0633_v2.txt")?.anomalies.some((anomaly) => anomaly.type === "OBSERVATION_SUSPICIOUS")).toBe(true);
    expect(byFile.get("DOC_0633_v2.txt")?.anomalies.some((anomaly) => anomaly.type === "STATUS_INCONSISTENT")).toBe(true);
  });

  it("flags supplier value outliers from an established range", () => {
    const historicalDocuments = [
      makeSyntheticDocument("DOC_A.txt", "Fornecedor Alpha", 100),
      makeSyntheticDocument("DOC_B.txt", "Fornecedor Alpha", 105),
      makeSyntheticDocument("DOC_C.txt", "Fornecedor Alpha", 110),
      makeSyntheticDocument("DOC_D.txt", "Fornecedor Alpha", 95),
    ];
    const currentDocuments = [makeSyntheticDocument("DOC_OUTLIER.txt", "Fornecedor Alpha", 1000)];

    const analysis = analyzeDocuments({ historicalDocuments, currentDocuments });

    expect(analysis.documents[0]?.anomalies.some((anomaly) => anomaly.type === "VALUE_OUTLIER")).toBe(true);
  });

  it("does not flag an atypical bank as a standalone anomaly", () => {
    const historicalDocuments = [
      makeSyntheticDocument("DOC_BANK_A.txt", "Fornecedor Alpha", 300),
      makeSyntheticDocument("DOC_BANK_B.txt", "Fornecedor Alpha", 320),
      makeSyntheticDocument("DOC_BANK_C.txt", "Fornecedor Alpha", 310),
      makeSyntheticDocument("DOC_BANK_D.txt", "Fornecedor Alpha", 315),
    ].map((document) => ({
      ...document,
      normalized: {
        ...document.normalized,
        supplierCnpjRaw: "11.222.333/0001-81",
        supplierCnpjNormalized: "11222333000181",
      },
    }));
    const currentDocuments = [
      {
        ...makeSyntheticDocument("DOC_BANK_NEW.txt", "Fornecedor Alpha", 305),
        normalized: {
          ...makeSyntheticDocument("DOC_BANK_NEW.txt", "Fornecedor Alpha", 305).normalized,
          documentNumber: "NF-BANK-NEW",
          supplierCnpjRaw: "11.222.333/0001-81",
          supplierCnpjNormalized: "11222333000181",
          destinationBank: "Banco Novo Ag.0001 C/C 123-0",
        },
      },
    ];

    const analysis = analyzeDocuments({ historicalDocuments, currentDocuments });

    expect(analysis.documents[0]?.anomalies.some((anomaly) => anomaly.type === "BANK_ATYPICAL")).toBe(false);
  });

});
