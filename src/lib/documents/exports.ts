import type { DocumentAnomaly } from "@/lib/documents/anomalies";
import type { ParsedUploadedDocument } from "@/lib/documents/parser";

export interface ExportableDocumentRecord {
  document: ParsedUploadedDocument;
  anomalies: DocumentAnomaly[];
  promptVersion: string;
  processedAt: string;
  extractionMethod: string;
  modelId: string;
}

export interface ResultsRow {
  fileName: string;
  processingStatus: string;
  encoding: string;
  documentType: string;
  documentNumber: string;
  serviceDescription: string;
  supplierName: string;
  supplierCnpj: string;
  grossAmount: number | null;
  issueDateIso: string | null;
  paymentDateIso: string | null;
  invoiceIssueDateIso: string | null;
  approvedBy: string | null;
  destinationBank: string | null;
  status: string | null;
  verificationHash: string | null;
  anomalyCount: number;
  anomalyTypes: string;
  highestSeverity: string;
  notExtractedFields: string;
  promptVersion: string;
  extractionMethod: string;
  modelId: string;
  processedAt: string;
}

export interface AnomalySummaryRow {
  anomalyType: string;
  count: number;
  highestSeverity: string;
  exampleFiles: string;
}

export interface AuditRow {
  eventType: "PROCESSING_RESULT" | "ANOMALY_RULE";
  fileName: string;
  processedAt: string;
  outcome: string;
  ruleId: string | null;
  anomalyType: string | null;
  confidence: string | null;
  severity: string | null;
  evidenceJson: string;
  promptVersion: string;
  extractionMethod: string;
  modelId: string;
}

export function buildResultsRows(records: ExportableDocumentRecord[]): ResultsRow[] {
  return records.map(({ document, anomalies, promptVersion, processedAt, extractionMethod, modelId }) => ({
    fileName: document.fileName,
    processingStatus: document.status,
    encoding: document.encoding,
    documentType: document.normalized.documentType ?? "",
    documentNumber: document.normalized.documentNumber ?? "",
    serviceDescription: document.normalized.serviceDescription ?? "",
    supplierName: document.normalized.supplierName ?? "",
    supplierCnpj: document.normalized.supplierCnpjNormalized ?? "",
    grossAmount: document.normalized.grossAmount,
    issueDateIso: document.normalized.issueDateIso,
    paymentDateIso: document.normalized.paymentDateIso,
    invoiceIssueDateIso: document.normalized.invoiceIssueDateIso,
    approvedBy: document.normalized.approvedBy,
    destinationBank: document.normalized.destinationBank,
    status: document.normalized.status,
    verificationHash: document.normalized.verificationHash,
    anomalyCount: anomalies.length,
    anomalyTypes: anomalies.map((anomaly) => anomaly.type).join(", "),
    highestSeverity: pickHighestSeverity(anomalies),
    notExtractedFields: document.notExtractedFields.join(", "),
    promptVersion,
    extractionMethod,
    modelId,
    processedAt,
  }));
}

export function buildAnomalySummaryRows(records: ExportableDocumentRecord[]): AnomalySummaryRow[] {
  const summaries = new Map<
    string,
    { count: number; highestSeverity: string; exampleFiles: Set<string> }
  >();

  for (const record of records) {
    for (const anomaly of record.anomalies) {
      const current = summaries.get(anomaly.type) ?? {
        count: 0,
        highestSeverity: "none",
        exampleFiles: new Set<string>(),
      };
      current.count += 1;
      current.highestSeverity = pickHighestSeverity([
        { severity: current.highestSeverity },
        anomaly,
      ] as DocumentAnomaly[]);
      if (current.exampleFiles.size < 5) {
        current.exampleFiles.add(record.document.fileName);
      }
      summaries.set(anomaly.type, current);
    }
  }

  return Array.from(summaries.entries())
    .map(([anomalyType, summary]) => ({
      anomalyType,
      count: summary.count,
      highestSeverity: summary.highestSeverity,
      exampleFiles: Array.from(summary.exampleFiles).join(", "),
    }))
    .sort((left, right) => right.count - left.count || left.anomalyType.localeCompare(right.anomalyType));
}

export function buildResultsWorkbookSheets(records: ExportableDocumentRecord[]) {
  return [
    {
      name: "results",
      rows: buildResultsRows(records),
      columnLabels: RESULTS_COLUMN_LABELS,
    },
    {
      name: "anomaly_summary",
      rows: buildAnomalySummaryRows(records),
      columnLabels: ANOMALY_SUMMARY_COLUMN_LABELS,
    },
  ];
}

export const RESULTS_COLUMN_LABELS: Record<string, string> = {
  fileName: "Nome do Arquivo",
  processingStatus: "Status de Processamento",
  encoding: "Codificação",
  documentType: "Tipo de Documento",
  documentNumber: "Número do Documento",
  serviceDescription: "Descrição do Serviço",
  supplierName: "Fornecedor",
  supplierCnpj: "CNPJ Fornecedor",
  grossAmount: "Valor Bruto (R$)",
  issueDateIso: "Data de Emissão",
  paymentDateIso: "Data de Pagamento",
  invoiceIssueDateIso: "Data de Emissão NF",
  approvedBy: "Aprovado Por",
  destinationBank: "Banco de Destino",
  status: "Status Documento",
  verificationHash: "Hash de Verificação",
  anomalyCount: "Qtd. Anomalias",
  anomalyTypes: "Tipos de Anomalia",
  highestSeverity: "Severidade Máxima",
  notExtractedFields: "Campos Não Extraídos",
  promptVersion: "Versão do Prompt",
  extractionMethod: "Método de Extração",
  modelId: "Modelo de IA",
  processedAt: "Processado Em",
};

export const ANOMALY_SUMMARY_COLUMN_LABELS: Record<string, string> = {
  anomalyType: "Tipo de Anomalia",
  count: "Quantidade",
  highestSeverity: "Severidade Máxima",
  exampleFiles: "Arquivos de Exemplo",
};

export const AUDIT_COLUMN_LABELS: Record<string, string> = {
  eventType: "Tipo de Evento",
  fileName: "Nome do Arquivo",
  processedAt: "Processado Em",
  outcome: "Resultado",
  ruleId: "ID da Regra",
  anomalyType: "Tipo de Anomalia",
  confidence: "Confiança",
  severity: "Severidade",
  evidenceJson: "Evidência (JSON)",
  promptVersion: "Versão do Prompt",
  extractionMethod: "Método de Extração",
  modelId: "Modelo de IA",
};

export function buildAuditRows(records: ExportableDocumentRecord[]): AuditRow[] {
  return records.flatMap(({ document, anomalies, promptVersion, processedAt, extractionMethod, modelId }) => {
    const parseRow: AuditRow = {
      eventType: "PROCESSING_RESULT",
      fileName: document.fileName,
      processedAt,
      outcome: document.status,
      ruleId: null,
      anomalyType: null,
      confidence: null,
      severity: null,
      evidenceJson: JSON.stringify(
        {
          missingFields: document.missingFields,
          notExtractedFields: document.notExtractedFields,
          warningCodes: document.warningCodes,
          invalidLines: document.invalidLines,
        },
        null,
        2,
      ),
      promptVersion,
      extractionMethod,
      modelId,
    };

    const anomalyRows: AuditRow[] = anomalies.map((anomaly) => ({
      eventType: "ANOMALY_RULE",
      fileName: document.fileName,
      processedAt,
      outcome: "anomaly-flagged",
      ruleId: anomaly.ruleId,
      anomalyType: anomaly.type,
      confidence: anomaly.confidence,
      severity: anomaly.severity,
      evidenceJson: JSON.stringify(anomaly.evidence, null, 2),
      promptVersion,
      extractionMethod,
      modelId,
    }));

    return [parseRow, ...anomalyRows];
  });
}

function pickHighestSeverity(anomalies: DocumentAnomaly[]) {
  if (anomalies.some((anomaly) => anomaly.severity === "high")) {
    return "high";
  }

  if (anomalies.some((anomaly) => anomaly.severity === "medium")) {
    return "medium";
  }

  if (anomalies.some((anomaly) => anomaly.severity === "low")) {
    return "low";
  }

  return "none";
}
