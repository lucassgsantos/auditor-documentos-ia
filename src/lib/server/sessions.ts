import { randomUUID } from "node:crypto";

import type {
  DocumentAnalysis,
  DocumentAnomaly,
  EvidenceValue,
  ReferenceProfile,
} from "@/lib/documents/anomalies";
import type { AuditRow, ExportableDocumentRecord } from "@/lib/documents/exports";
import {
  deriveNotExtractedFields,
  type ParsedUploadedDocument,
} from "@/lib/documents/parser";
import { ensureDatabaseSchema, getDb } from "@/lib/db/client";

export interface ProcessingSessionRecord {
  id: string;
  sourceType: string;
  label: string | null;
  status: string;
  totalFiles: number;
  processedFiles: number;
  anomalyCount: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface StoredDocumentRecord extends ExportableDocumentRecord {
  id: string;
  sessionId: string;
  modelId: string;
}

export async function createProcessingSession(input?: {
  sourceType?: "upload" | "baseline_seed";
  label?: string;
}) {
  await ensureDatabaseSchema();
  const db = getDb();
  const id = randomUUID();
  const sourceType = input?.sourceType ?? "upload";
  const label = input?.label ?? null;

  await db`
    INSERT INTO processing_sessions (
      id,
      source_type,
      label,
      status
    ) VALUES (
      ${id},
      ${sourceType},
      ${label},
      ${"collecting"}
    )
  `;

  return id;
}

export async function saveProcessedDocument(input: {
  sessionId: string;
  document: ParsedUploadedDocument;
  promptVersion: string;
  modelId: string;
  extractionMethod: string;
}) {
  await ensureDatabaseSchema();
  const db = getDb();
  const id = randomUUID();

  await db`
    INSERT INTO documents (
      id,
      session_id,
      file_name,
      raw_text,
      normalized_text,
      encoding,
      parse_status,
      warning_codes_text,
      missing_fields_text,
      invalid_lines_text,
      structured_text,
      prompt_version,
      model_id,
      extraction_method
    ) VALUES (
      ${id},
      ${input.sessionId},
      ${input.document.fileName},
      ${input.document.rawText},
      ${input.document.normalizedText},
      ${input.document.encoding},
      ${input.document.status},
      ${JSON.stringify(input.document.warningCodes)},
      ${JSON.stringify(input.document.missingFields)},
      ${JSON.stringify(input.document.invalidLines)},
      ${JSON.stringify(input.document)},
      ${input.promptVersion},
      ${input.modelId},
      ${input.extractionMethod}
    )
  `;

  await refreshSessionCounts(input.sessionId);

  return id;
}

export async function loadSession(sessionId: string) {
  await ensureDatabaseSchema();
  const db = getDb();
  const rows = await db<DbSessionRow[]>`
    SELECT
      id,
      source_type,
      label,
      status,
      total_files,
      processed_files,
      anomaly_count,
      started_at,
      finished_at
    FROM processing_sessions
    WHERE id = ${sessionId}
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return mapSession(row);
}

export async function loadSessionDocuments(sessionId: string) {
  await ensureDatabaseSchema();
  const db = getDb();
  const documentRows = await db<DbDocumentRow[]>`
    SELECT
      id,
      session_id,
      structured_text,
      prompt_version,
      model_id,
      extraction_method,
      created_at
    FROM documents
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
  `;

  const anomalyRows = await db<DbAnomalyRow[]>`
    SELECT
      document_id,
      type,
      rule_id,
      severity,
      confidence,
      message,
      evidence_text
    FROM anomalies
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
  `;

  const anomaliesByDocumentId = new Map<string, DocumentAnomaly[]>();
  for (const row of anomalyRows) {
    const list = anomaliesByDocumentId.get(row.document_id) ?? [];
    list.push({
      type: row.type as DocumentAnomaly["type"],
      ruleId: row.rule_id,
      severity: row.severity as DocumentAnomaly["severity"],
      confidence: row.confidence as DocumentAnomaly["confidence"],
      message: row.message,
      evidence: safeParseJson<Record<string, EvidenceValue>>(row.evidence_text, {}),
    });
    anomaliesByDocumentId.set(row.document_id, list);
  }

  return documentRows.map((row) => {
    const document = normalizeStoredDocument(
      safeParseJson<ParsedUploadedDocument>(row.structured_text),
    );

    return {
      id: row.id,
      sessionId: row.session_id,
      document,
      anomalies: anomaliesByDocumentId.get(row.id) ?? [],
      promptVersion: row.prompt_version,
      processedAt: new Date(row.created_at).toISOString(),
      extractionMethod: row.extraction_method,
      modelId: row.model_id,
    };
  });
}

export async function countSessionDocuments(sessionId: string) {
  await ensureDatabaseSchema();
  const db = getDb();
  const rows = await db<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM documents
    WHERE session_id = ${sessionId}
  `;

  return Number(rows[0]?.count ?? "0");
}

export async function loadBaselineSeedDocuments() {
  await ensureDatabaseSchema();
  const db = getDb();
  const rows = await db<{ id: string }[]>`
    SELECT id
    FROM processing_sessions
    WHERE source_type = ${"baseline_seed"} AND status = ${"finalized"}
    ORDER BY finished_at DESC NULLS LAST, created_at DESC
  `;

  const documents = await Promise.all(rows.map((row) => loadSessionDocuments(row.id)));
  return documents.flat();
}

export async function loadLatestBaselineSeedSession() {
  await ensureDatabaseSchema();
  const db = getDb();
  const rows = await db<DbSessionRow[]>`
    SELECT
      id,
      source_type,
      label,
      status,
      total_files,
      processed_files,
      anomaly_count,
      started_at,
      finished_at
    FROM processing_sessions
    WHERE source_type = ${"baseline_seed"} AND status = ${"finalized"}
    ORDER BY finished_at DESC NULLS LAST, started_at DESC
    LIMIT 1
  `;

  const row = rows[0];
  if (!row) {
    return null;
  }

  return mapSession(row);
}

export async function replaceSessionAnalysis(input: {
  sessionId: string;
  documents: StoredDocumentRecord[];
  analysis: DocumentAnalysis[];
  auditRows: AuditRow[];
}) {
  await ensureDatabaseSchema();
  const db = getDb();

  const anomaliesByFile = new Map(input.analysis.map((item) => [item.fileName, item.anomalies]));

  const documentByFileName = new Map(
    input.documents.map((doc) => [doc.document.fileName, doc]),
  );

  await db.begin(async (tx) => {
    await tx`DELETE FROM anomalies WHERE session_id = ${input.sessionId}`;
    await tx`DELETE FROM audit_entries WHERE session_id = ${input.sessionId}`;

    for (const document of input.documents) {
      const anomalies = anomaliesByFile.get(document.document.fileName) ?? [];
      for (const anomaly of anomalies) {
        await tx`
          INSERT INTO anomalies (
            id,
            session_id,
            document_id,
            type,
            rule_id,
            severity,
            confidence,
            message,
            evidence_text
          ) VALUES (
            ${randomUUID()},
            ${input.sessionId},
            ${document.id},
            ${anomaly.type},
            ${anomaly.ruleId},
            ${anomaly.severity},
            ${anomaly.confidence},
            ${anomaly.message},
            ${JSON.stringify(anomaly.evidence)}
          )
        `;
      }
    }

    for (const row of input.auditRows) {
      const document = documentByFileName.get(row.fileName);
      await tx`
        INSERT INTO audit_entries (
          id,
          session_id,
          document_id,
          event_type,
          outcome,
          rule_id,
          anomaly_type,
          confidence,
          severity,
          evidence_text,
          prompt_version,
          extraction_method,
          created_at
        ) VALUES (
          ${randomUUID()},
          ${input.sessionId},
          ${document?.id ?? null},
          ${row.eventType},
          ${row.outcome},
          ${row.ruleId},
          ${row.anomalyType},
          ${row.confidence},
          ${row.severity},
          ${row.evidenceJson},
          ${row.promptVersion},
          ${row.extractionMethod},
          ${row.processedAt}
        )
      `;
    }
  });

  await refreshSessionCounts(input.sessionId, {
    finalized: true,
    anomalyCount: input.analysis.reduce(
      (total, document) => total + document.anomalies.length,
      0,
    ),
  });
}

export async function replaceSupplierBaselines(profile: ReferenceProfile) {
  await ensureDatabaseSchema();
  const db = getDb();
  const knownApprovers = Array.from(profile.knownApprovers);

  await db.begin(async (tx) => {
    await tx`DELETE FROM supplier_baselines`;

    for (const [supplierName, supplier] of profile.suppliers) {
      await tx`
        INSERT INTO supplier_baselines (
          supplier_name,
          canonical_cnpj,
          known_approvers_text,
          known_banks_text,
          historical_amounts_text,
          seen_document_numbers_text,
          document_count,
          updated_at
        ) VALUES (
          ${supplierName},
          ${supplier.canonicalCnpj},
          ${JSON.stringify(knownApprovers)},
          ${JSON.stringify(Array.from(supplier.knownBanks.entries()))},
          ${JSON.stringify(supplier.historicalAmounts)},
          ${JSON.stringify(Array.from(supplier.seenDocumentNumbers.values()))},
          ${supplier.documentCount},
          ${new Date().toISOString()}
        )
      `;
    }
  });
}

export async function loadSupplierBaselineProfile() {
  await ensureDatabaseSchema();
  const db = getDb();
  const rows = await db<DbSupplierBaselineRow[]>`
    SELECT
      supplier_name,
      canonical_cnpj,
      known_approvers_text,
      known_banks_text,
      historical_amounts_text,
      seen_document_numbers_text,
      document_count
    FROM supplier_baselines
  `;

  const suppliers = new Map<string, ReferenceProfile["suppliers"] extends Map<string, infer Supplier> ? Supplier : never>();
  const knownApprovers = new Set<string>();

  for (const row of rows) {
    const rowApprovers = safeParseJson<string[]>(row.known_approvers_text, []);
    for (const approver of rowApprovers) {
      knownApprovers.add(approver);
    }

    suppliers.set(row.supplier_name, {
      supplierName: row.supplier_name,
      canonicalCnpj: row.canonical_cnpj,
      knownBanks: new Map(safeParseJson<Array<[string, number]>>(row.known_banks_text, [])),
      historicalAmounts: safeParseJson<number[]>(row.historical_amounts_text, []),
      seenDocumentNumbers: new Set(safeParseJson<string[]>(row.seen_document_numbers_text, [])),
      documentCount: row.document_count,
    });
  }

  return {
    suppliers,
    knownApprovers,
  };
}

export async function loadSessionAuditRows(sessionId: string) {
  await ensureDatabaseSchema();
  const db = getDb();
  const rows = await db<DbAuditRow[]>`
    SELECT
      event_type,
      outcome,
      rule_id,
      anomaly_type,
      confidence,
      severity,
      evidence_text,
      prompt_version,
      extraction_method,
      created_at,
      document_id
    FROM audit_entries
    WHERE session_id = ${sessionId}
    ORDER BY created_at ASC
  `;

  const documents = await loadSessionDocuments(sessionId);
  const documentNameById = new Map(documents.map((document) => [document.id, document.document.fileName]));
  const modelIdByDocumentId = new Map(documents.map((document) => [document.id, document.modelId]));

  return rows.map((row) => ({
    eventType: row.event_type as AuditRow["eventType"],
    fileName: row.document_id ? documentNameById.get(row.document_id) ?? "unknown" : "session",
    processedAt: new Date(row.created_at).toISOString(),
    outcome: row.outcome,
    ruleId: row.rule_id,
    anomalyType: row.anomaly_type,
    confidence: row.confidence,
    severity: row.severity,
    evidenceJson: row.evidence_text,
    promptVersion: row.prompt_version,
    extractionMethod: row.extraction_method,
    modelId: row.document_id ? modelIdByDocumentId.get(row.document_id) ?? "unknown" : "unknown",
  }));
}

async function refreshSessionCounts(
  sessionId: string,
  options?: { finalized?: boolean; anomalyCount?: number },
) {
  const db = getDb();
  const rows = await db<{ count: string }[]>`
    SELECT COUNT(*)::text AS count
    FROM documents
    WHERE session_id = ${sessionId}
  `;

  const processedFiles = Number(rows[0]?.count ?? "0");
  const anomalyCount = options?.anomalyCount ?? 0;

  await db`
    UPDATE processing_sessions
    SET
      processed_files = ${processedFiles},
      total_files = GREATEST(total_files, ${processedFiles}),
      anomaly_count = ${anomalyCount},
      status = ${options?.finalized ? "finalized" : "collecting"},
      finished_at = ${options?.finalized ? new Date().toISOString() : null},
      updated_at = NOW()
    WHERE id = ${sessionId}
  `;
}

function mapSession(row: DbSessionRow): ProcessingSessionRecord {
  return {
    id: row.id,
    sourceType: row.source_type,
    label: row.label,
    status: row.status,
    totalFiles: row.total_files,
    processedFiles: row.processed_files,
    anomalyCount: row.anomaly_count,
    startedAt: new Date(row.started_at).toISOString(),
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
  };
}

function safeParseJson<T>(value: string, fallback?: T) {
  try {
    return JSON.parse(value) as T;
  } catch {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error("Failed to parse JSON from database.");
  }
}

function normalizeStoredDocument(document: ParsedUploadedDocument): ParsedUploadedDocument {
  const normalized = {
    ...document.normalized,
    serviceDescription:
      document.normalized.serviceDescription ??
      document.fields.DESCRICAO_SERVICO ??
      null,
  };

  return {
    ...document,
    normalized,
    notExtractedFields:
      document.notExtractedFields ?? deriveNotExtractedFields(normalized),
  };
}

interface DbSessionRow {
  id: string;
  source_type: string;
  label: string | null;
  status: string;
  total_files: number;
  processed_files: number;
  anomaly_count: number;
  started_at: string;
  finished_at: string | null;
}

interface DbDocumentRow {
  id: string;
  session_id: string;
  structured_text: string;
  prompt_version: string;
  model_id: string;
  extraction_method: string;
  created_at: string;
}

interface DbAnomalyRow {
  document_id: string;
  type: string;
  rule_id: string;
  severity: string;
  confidence: string;
  message: string;
  evidence_text: string;
}

interface DbAuditRow {
  event_type: string;
  outcome: string;
  rule_id: string | null;
  anomaly_type: string | null;
  confidence: string | null;
  severity: string | null;
  evidence_text: string;
  prompt_version: string;
  extraction_method: string;
  created_at: string;
  document_id: string | null;
}

interface DbSupplierBaselineRow {
  supplier_name: string;
  canonical_cnpj: string | null;
  known_approvers_text: string;
  known_banks_text: string;
  historical_amounts_text: string;
  seen_document_numbers_text: string;
  document_count: number;
}
