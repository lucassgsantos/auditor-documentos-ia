import { describe, expect, it } from "vitest";

import {
  buildAuditRows,
  buildResultsRows,
  type ExportableDocumentRecord,
} from "@/lib/documents/exports";
import type { ParsedUploadedDocument } from "@/lib/documents/parser";

const sampleDocument: ParsedUploadedDocument = {
  fileName: "DOC_0001.txt",
  encoding: "utf-8",
  rawText: "raw",
  normalizedText: "normalized",
  fields: {
    TIPO_DOCUMENTO: "NOTA_FISCAL",
    NUMERO_DOCUMENTO: "NF-87397",
    FORNECEDOR: "TechSoft Ltda",
  },
  invalidLines: [],
  missingFields: [],
  warningCodes: [],
  status: "parsed",
  normalized: {
    documentType: "NOTA_FISCAL",
    documentNumber: "NF-87397",
    serviceDescription: "Licença de Software ERP",
    supplierName: "TechSoft Ltda",
    supplierCnpjRaw: "12.345.678/0001-90",
    supplierCnpjNormalized: "12345678000190",
    grossAmountRaw: "R$ 8.500,00",
    grossAmount: 8500,
    issueDateIso: "2025-01-29",
    paymentDateIso: "2025-02-07",
    invoiceIssueDateIso: "2025-01-28",
    status: "PAGO",
    verificationHash: "NLC0001542417",
    approvedBy: "Maria Silva",
    destinationBank: "Caixa Ag.0023 C/C 44321-0",
    observation: null,
  },
  notExtractedFields: ["OBSERVACAO"],
} as ParsedUploadedDocument;

describe("buildResultsRows", () => {
  it("creates BI-friendly result rows with flattened anomaly summaries", () => {
    const record = {
        document: sampleDocument,
        anomalies: [
          {
            type: "CNPJ_DIVERGENT",
            ruleId: "supplier-cnpj-divergent",
            severity: "high",
            confidence: "HIGH",
            message: "CNPJ divergente.",
            evidence: {
              canonicalCnpj: "12345678000190",
              currentCnpj: "99888777000100",
            },
          },
        ],
        promptVersion: "document-extractor-v1",
        processedAt: "2026-04-17T02:10:00.000Z",
        extractionMethod: "openai+parser",
        modelId: "gpt-4.1-mini",
      };
    const rows = buildResultsRows([record]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fileName: "DOC_0001.txt",
      documentNumber: "NF-87397",
      serviceDescription: "Licença de Software ERP",
      supplierName: "TechSoft Ltda",
      anomalyCount: 1,
      anomalyTypes: "CNPJ_DIVERGENT",
      promptVersion: "document-extractor-v1",
      extractionMethod: "openai+parser",
      modelId: "gpt-4.1-mini",
      notExtractedFields: "OBSERVACAO",
    });
  });

  it("builds a results workbook shape with an anomaly summary sheet", async () => {
    const exportsModule = (await import("@/lib/documents/exports")) as Record<string, unknown>;
    const buildResultsWorkbookSheets = exportsModule.buildResultsWorkbookSheets as
      | ((records: ExportableDocumentRecord[]) => Array<{ name: string; rows: object[] }>)
      | undefined;
    const record = {
      document: sampleDocument,
      anomalies: [
        {
          type: "CNPJ_DIVERGENT",
          ruleId: "supplier-cnpj-divergent",
          severity: "high",
          confidence: "HIGH",
          message: "CNPJ divergente.",
          evidence: {},
        },
      ],
      promptVersion: "document-extractor-v1",
      processedAt: "2026-04-17T02:10:00.000Z",
      extractionMethod: "openai+parser",
      modelId: "gpt-4.1-mini",
    };

    expect(typeof buildResultsWorkbookSheets).toBe("function");
    const sheets = buildResultsWorkbookSheets?.([record]);

    expect(sheets?.map((sheet) => sheet.name)).toEqual(["results", "anomaly_summary"]);
    expect(sheets?.[1]?.rows[0]).toMatchObject({
      anomalyType: "CNPJ_DIVERGENT",
      count: 1,
      highestSeverity: "high",
      exampleFiles: "DOC_0001.txt",
    });
  });
});

describe("buildAuditRows", () => {
  it("creates one audit row for parsing and one per anomaly decision", () => {
    const record = {
        document: sampleDocument,
        anomalies: [
          {
            type: "CNPJ_DIVERGENT",
            ruleId: "supplier-cnpj-divergent",
            severity: "high",
            confidence: "HIGH",
            message: "CNPJ divergente.",
            evidence: {
              canonicalCnpj: "12345678000190",
              currentCnpj: "99888777000100",
            },
          },
        ],
        promptVersion: "document-extractor-v1",
        processedAt: "2026-04-17T02:10:00.000Z",
        extractionMethod: "openai+parser",
        modelId: "gpt-4.1-mini",
      };
    const rows = buildAuditRows([record]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      eventType: "PROCESSING_RESULT",
      fileName: "DOC_0001.txt",
      outcome: "parsed",
      modelId: "gpt-4.1-mini",
    });
    expect(JSON.parse(rows[0]?.evidenceJson ?? "{}")).toMatchObject({
      notExtractedFields: ["OBSERVACAO"],
    });
    expect(rows[1]).toMatchObject({
      eventType: "ANOMALY_RULE",
      anomalyType: "CNPJ_DIVERGENT",
      ruleId: "supplier-cnpj-divergent",
      confidence: "HIGH",
      modelId: "gpt-4.1-mini",
    });
  });
});
