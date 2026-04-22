"use client";

import { type ReactNode, startTransition, useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Download, FileSearch, Inbox, Search } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { InfoRow } from "@/components/info-row";
import { StatusPill } from "@/components/status-pill";

export interface SessionDocumentView {
  id: string;
  fileName: string;
  parseStatus: string;
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
  extractionMethod: string;
  modelId: string;
  promptVersion: string;
  processedAt: string;
  notExtractedFields: string[];
  anomalies: Array<{
    type: string;
    severity: string;
    confidence: string;
    message: string;
    evidence: Record<string, unknown>;
  }>;
}

interface SessionOverview {
  id: string;
  status: string;
  processedFiles: number;
  totalFiles: number;
  anomalyCount: number;
  startedAt: string;
  finishedAt: string | null;
}

interface AnomalySummary {
  type: string;
  count: number;
  severity: "high" | "medium" | "low";
}

const severityRank = {
  high: 3,
  medium: 2,
  low: 1,
} as const;

const ANOMALY_LABELS: Record<string, string> = {
  APPROVER_UNRECOGNIZED: "Aprovador não reconhecido",
  BANK_ATYPICAL: "Banco atípico",
  CNPJ_CHECKSUM_INVALID: "CNPJ com digitos invalidos",
  CNPJ_DIVERGENT: "CNPJ divergente",
  DOCUMENT_NUMBER_PREFIX_MISMATCH: "Prefixo de documento incompatível",
  DUPLICATE_DOCUMENT: "Documento já existente",
  FILE_UNPROCESSABLE: "Arquivo não processável",
  FILENAME_VERSIONED: "Arquivo versionado",
  HASH_MALFORMED: "Hash mal formado",
  INVOICE_AFTER_PAYMENT: "NF emitida após pagamento",
  OBSERVATION_SUSPICIOUS: "Observação suspeita",
  STATUS_INCONSISTENT: "Status inconsistente",
  STATUS_MALFORMED: "Status fora do padrão",
  SUPPLIER_WITHOUT_HISTORY: "Fornecedor sem histórico",
  VALUE_OUTLIER: "Valor fora da faixa",
};

const DOCUMENTS_PAGE_SIZE = 50;

export function ResultsExplorer({
  session,
  documents,
}: {
  session: SessionOverview;
  documents: SessionDocumentView[];
}) {
  const [search, setSearch] = useState("");
  const [selectedAnomaly, setSelectedAnomaly] = useState("ALL");
  const [selectedSeverity, setSelectedSeverity] = useState("ALL");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    documents[0]?.id ?? null,
  );
  const [currentPage, setCurrentPage] = useState(1);
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());

  const anomalyBreakdown = useMemo(() => {
    const counts = new Map<string, AnomalySummary>();

    for (const document of documents) {
      for (const anomaly of document.anomalies) {
        const current = counts.get(anomaly.type);
        const nextSeverity = normalizeSeverity(anomaly.severity);

        if (!current) {
          counts.set(anomaly.type, {
            type: anomaly.type,
            count: 1,
            severity: nextSeverity,
          });
          continue;
        }

        counts.set(anomaly.type, {
          type: anomaly.type,
          count: current.count + 1,
          severity:
            severityRank[nextSeverity] > severityRank[current.severity]
              ? nextSeverity
              : current.severity,
        });
      }
    }

    return Array.from(counts.values()).sort(
      (left, right) => right.count - left.count || left.type.localeCompare(right.type),
    );
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    return documents.filter((document) => {
      const matchesSearch =
        deferredSearch.length === 0 ||
        [
          document.fileName,
          document.documentNumber,
          document.supplierName,
          document.approvedBy ?? "",
          document.supplierCnpj,
        ]
          .join(" ")
          .toLowerCase()
          .includes(deferredSearch);

      const matchesAnomaly =
        selectedAnomaly === "ALL" ||
        document.anomalies.some((anomaly) => anomaly.type === selectedAnomaly);

      const matchesSeverity =
        selectedSeverity === "ALL" ||
        document.anomalies.some(
          (anomaly) => normalizeSeverity(anomaly.severity).toUpperCase() === selectedSeverity,
        );

      return matchesSearch && matchesAnomaly && matchesSeverity;
    });
  }, [deferredSearch, documents, selectedAnomaly, selectedSeverity]);

  const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / DOCUMENTS_PAGE_SIZE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartOffset = (safeCurrentPage - 1) * DOCUMENTS_PAGE_SIZE;

  const paginatedDocuments = useMemo(() => {
    return filteredDocuments.slice(
      pageStartOffset,
      pageStartOffset + DOCUMENTS_PAGE_SIZE,
    );
  }, [filteredDocuments, pageStartOffset]);

  const pageEndOffset = Math.min(
    filteredDocuments.length,
    pageStartOffset + paginatedDocuments.length,
  );

  const selectedDocument =
    filteredDocuments.find((document) => document.id === selectedDocumentId) ??
    filteredDocuments[0] ??
    null;

  const partialDocuments = documents.filter((document) => document.parseStatus !== "parsed").length;
  const cleanDocuments = documents.filter((document) => document.anomalies.length === 0).length;
  const openDateLabel = formatTimestamp(session.startedAt, "short") ?? "Sem registro";
  const closeDateLabel = formatTimestamp(session.finishedAt, "short") ?? "Em curso";

  return (
    <div className="stagger-group space-y-4">
      <header className="surface-command rounded-[10px] px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <p className="folio-mark">Dossiê de Lote · Rev. {session.id.slice(0, 6).toUpperCase()}</p>
          <p className="folio-mark">
            {session.status === "finalized" ? "§ Encerrado" : "§ Em curso"}
          </p>
        </div>

        <div className="mt-5 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="min-w-0 space-y-3">
            <p className="section-kicker">Comando do lote</p>
            <h1 className="display-title text-[2.4rem] leading-[0.98] sm:text-[2.9rem]">
              Lote{" "}
              <span className="editorial-accent">№</span>{" "}
              <span style={{ fontVariantNumeric: "tabular-nums lining-nums" }}>
                {session.id.slice(0, 8)}
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                surface="dark"
                tone={session.status === "finalized" ? "success" : "warning"}
              >
                {session.status === "finalized" ? "Encerrado" : session.status}
              </StatusPill>
              <span className="meta-chip meta-chip-dark">Abertura {openDateLabel}</span>
              <span className="meta-chip meta-chip-dark">Encerramento {closeDateLabel}</span>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              className="action-seal"
              href={`/api/sessions/${session.id}/results.xlsx`}
            >
              <Download className="size-4" />
              Resultados · XLSX
            </Link>
            <Link
              className="action-secondary rounded-[4px] px-4 py-2.5 text-sm font-semibold"
              href={`/api/sessions/${session.id}/audit.xlsx`}
            >
              <ArrowUpRight className="size-4" />
              Auditoria · XLSX
            </Link>
          </div>
        </div>

        <div
          aria-hidden
          className="mt-5 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(121,174,226,0.35) 14%, rgba(121,174,226,0.35) 86%, transparent)",
          }}
        />

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <CommandCounter label="Documentos" value={session.processedFiles} />
          <CommandCounter label="Achados" value={session.anomalyCount} />
          <CommandCounter label="Parciais" value={partialDocuments} />
          <CommandCounter label="Sem divergências" value={cleanDocuments} />
          <CommandCounter label="Encerramento" value={closeDateLabel} />
        </div>
      </header>

      <section className="results-layout">
        <aside className="surface-panel rounded-[10px] px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="section-kicker">Filtros &amp; achados</p>
            <span className="meta-chip">
              <span className="ledger-number">{String(anomalyBreakdown.length).padStart(2, "0")}</span>
            </span>
          </div>

          <div className="mt-4 space-y-2">
            <label className="relative block">
              <span className="sr-only">Buscar arquivo, documento ou fornecedor</span>
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--text-faint)]"
              />
              <input
                className="ops-input rounded-[4px] py-2.5 pl-10 pr-3 text-sm"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Buscar arquivo, documento, fornecedor…"
                type="search"
                value={search}
              />
            </label>

            <div className="flex flex-wrap gap-1.5 pt-1">
              <button
                type="button"
                className="filter-chip"
                data-active={selectedSeverity === "ALL"}
                onClick={() => {
                  setSelectedSeverity("ALL");
                  setCurrentPage(1);
                }}
              >
                Todas
              </button>
              <button
                type="button"
                className="filter-chip"
                data-active={selectedSeverity === "HIGH"}
                onClick={() => {
                  setSelectedSeverity("HIGH");
                  setCurrentPage(1);
                }}
              >
                Alta
              </button>
              <button
                type="button"
                className="filter-chip"
                data-active={selectedSeverity === "MEDIUM"}
                onClick={() => {
                  setSelectedSeverity("MEDIUM");
                  setCurrentPage(1);
                }}
              >
                Média
              </button>
              <button
                type="button"
                className="filter-chip"
                data-active={selectedSeverity === "LOW"}
                onClick={() => {
                  setSelectedSeverity("LOW");
                  setCurrentPage(1);
                }}
              >
                Baixa
              </button>
            </div>
          </div>

          <div
            aria-hidden
            className="mt-4 h-px w-full"
            style={{
              background: "repeating-linear-gradient(90deg, var(--border) 0 4px, transparent 4px 8px)",
            }}
          />

          <div className="mt-4 space-y-2">
            <button
              type="button"
              className="filter-chip w-full justify-between"
              data-active={selectedAnomaly === "ALL"}
              onClick={() => {
                setSelectedAnomaly("ALL");
                setCurrentPage(1);
              }}
            >
              <span>Todos os achados</span>
              <span className="filter-chip-count">
                [{String(documents.reduce((acc, d) => acc + d.anomalies.length, 0)).padStart(3, "0")}]
              </span>
            </button>

            {anomalyBreakdown.map((item) => {
              const selected = selectedAnomaly === item.type;
              return (
                <button
                  key={item.type}
                  className="finding-row finding-item w-full rounded-[6px] px-3 py-3 text-left"
                  data-selected={selected}
                  data-severity={item.severity}
                  onClick={() => {
                    setSelectedAnomaly(item.type);
                    setCurrentPage(1);
                  }}
                  type="button"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <span className="margin-note" data-severity={item.severity}>
                        <span className="margin-note-glyph">
                          {item.severity === "high"
                            ? "⊘"
                            : item.severity === "medium"
                              ? "△"
                              : "·"}
                        </span>
                        {severityLabel(item.severity)}
                      </span>
                      <p className="mt-1.5 text-sm font-semibold leading-snug text-[var(--text)]">
                        {formatAnomalyType(item.type)}
                      </p>
                    </div>
                    <span className="finding-count ledger-number">
                      {String(item.count).padStart(2, "0")}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="surface-panel overflow-hidden rounded-[10px]">
          <div className="workspace-header">
            <div>
              <p className="section-kicker">Revisão do lote</p>
              <h2
                className="mt-2 text-[1.6rem] leading-tight text-[var(--text)]"
                style={{
                  fontFamily: "var(--font-fraunces)",
                  fontWeight: 600,
                  fontVariationSettings: "'opsz' 36",
                  letterSpacing: "-0.02em",
                }}
              >
                Documentos revisados
              </h2>
            </div>
            <span className="meta-chip">
              <span className="ledger-number">{String(filteredDocuments.length).padStart(3, "0")}</span> em análise
              {filteredDocuments.length > 0 ? ` · pág ${safeCurrentPage}/${totalPages}` : ""}
            </span>
          </div>

          {documents.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-6" />}
              title="Lote sem documentos"
              helper="O lote foi aberto, mas nenhum arquivo foi consolidado na revisão."
            />
          ) : filteredDocuments.length === 0 ? (
            <EmptyState
              icon={<FileSearch className="size-6" />}
              title="Nenhum documento atende aos filtros"
              helper="Reduza a busca, troque a severidade ou volte para todos os achados."
              action={
                <button
                  className="action-secondary rounded-[14px] px-3 py-2 text-sm font-semibold"
                  onClick={() => {
                    setSearch("");
                    setSelectedAnomaly("ALL");
                    setSelectedSeverity("ALL");
                    setCurrentPage(1);
                  }}
                  type="button"
                >
                  Limpar filtros
                </button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table
                aria-label="Documentos revisados no lote"
                className="review-table min-w-full border-collapse text-left"
              >
                <caption className="sr-only">
                  Lista de documentos processados. Clique ou pressione Enter para inspecionar
                  um documento.
                </caption>
                <thead>
                  <tr>
                    <th className="w-12 px-4 py-3">Fl.</th>
                    <th className="px-4 py-3">Arquivo</th>
                    <th className="px-4 py-3">Fornecedor</th>
                    <th className="px-4 py-3">Documento</th>
                    <th className="px-4 py-3 text-right">Valor</th>
                    <th className="px-4 py-3">Leitura</th>
                    <th className="px-4 py-3">Achados</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedDocuments.map((document, rowIndex) => {
                    const selected = selectedDocument?.id === document.id;
                    const firstAnomaly = document.anomalies[0];
                    const highestSeverity = document.anomalies.reduce<"high" | "medium" | "low" | null>(
                      (acc, anomaly) => {
                        const s = normalizeSeverity(anomaly.severity);
                        if (!acc) return s;
                        return severityRank[s] > severityRank[acc] ? s : acc;
                      },
                      null,
                    );

                    return (
                      <tr
                        key={document.id}
                        aria-label={`Inspecionar documento ${document.fileName}`}
                        aria-selected={selected}
                        className="selection-row"
                        data-selected={selected}
                        onClick={() =>
                          startTransition(() => {
                            setSelectedDocumentId(document.id);
                          })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            startTransition(() => {
                              setSelectedDocumentId(document.id);
                            });
                          }
                        }}
                        tabIndex={0}
                      >
                        <td className="px-4 py-3 align-top">
                          <span className="ledger-number text-[11px] text-[var(--text-faint)]">
                            {String(pageStartOffset + rowIndex + 1).padStart(3, "0")}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold leading-snug text-[var(--text)]">
                              {document.fileName}
                            </p>
                            <p className="table-meta">{document.encoding}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="space-y-1">
                            <p className="text-sm leading-snug text-[var(--text)]">
                              {document.supplierName || "Não identificado"}
                            </p>
                            <p className="table-meta">{document.supplierCnpj || "Sem CNPJ"}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <div className="space-y-1">
                            <p className="table-meta text-[var(--text)]">
                              {document.documentNumber || "Sem número"}
                            </p>
                            <p className="text-sm leading-snug text-[var(--text-muted)]">
                              {document.documentType || "Tipo não identificado"}
                            </p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right align-top">
                          <p className="table-value">{formatCurrency(document.grossAmount)}</p>
                        </td>
                        <td className="px-4 py-3 align-top">
                          <StatusPill
                            tone={document.parseStatus === "parsed" ? "success" : "warning"}
                          >
                            {formatParseStatus(document.parseStatus)}
                          </StatusPill>
                        </td>
                        <td className="px-4 py-3 align-top">
                          {firstAnomaly && highestSeverity ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className="evidence-stamp"
                                data-severity={highestSeverity}
                                title={formatAnomalyType(firstAnomaly.type)}
                              >
                                {highestSeverity === "high"
                                  ? "Evidência"
                                  : highestSeverity === "medium"
                                    ? "Alerta"
                                    : "Nota"}
                              </span>
                              <span className="ledger-number text-[11px] text-[var(--text-muted)]">
                                {document.anomalies.length === 1
                                  ? "1 achado"
                                  : `${document.anomalies.length} achados`}
                              </span>
                            </div>
                          ) : (
                            <span className="margin-note" data-severity="low">
                              <span className="margin-note-glyph">✓</span>
                              Sem achados
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {filteredDocuments.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3">
                  <p className="table-meta">
                    Mostrando {filteredDocuments.length === 0 ? 0 : pageStartOffset + 1}–{pageEndOffset} de {filteredDocuments.length}
                  </p>

                  <div className="flex items-center gap-2">
                    <button
                      className="action-secondary rounded-[4px] px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={safeCurrentPage === 1}
                      onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                      type="button"
                    >
                      Página anterior
                    </button>
                    <button
                      className="action-secondary rounded-[4px] px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={safeCurrentPage === totalPages}
                      onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                      type="button"
                    >
                      Próxima página
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </section>

        <aside className="surface-panel rounded-[18px] px-4 py-4">
          <p className="section-kicker">Inspeção e evidências</p>

          {selectedDocument ? (
            <div className="inspection-panel mt-4">
              <PanelSection>
                <div className="space-y-2">
                  <h3 className="display-title text-[1.4rem] leading-tight">
                    {selectedDocument.fileName}
                  </h3>
                  <p className="text-sm leading-6 text-[var(--text-muted)]">
                    {selectedDocument.supplierName || "Fornecedor não identificado"} /{" "}
                    {selectedDocument.documentNumber || "sem número"}
                  </p>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <StatusPill
                    tone={selectedDocument.parseStatus === "parsed" ? "success" : "warning"}
                  >
                    {formatParseStatus(selectedDocument.parseStatus)}
                  </StatusPill>
                  <StatusPill
                    tone={selectedDocument.anomalies.length > 0 ? "danger" : "success"}
                  >
                    {formatFindingCount(selectedDocument.anomalies.length)}
                  </StatusPill>
                  <span className="meta-chip">
                    {formatExtractionMethod(selectedDocument.extractionMethod)}
                  </span>
                </div>
              </PanelSection>

              <PanelSection title="Resumo do documento">
                <dl className="space-y-3">
                  <DetailRow label="Fornecedor" value={selectedDocument.supplierName || "Não identificado"} />
                  <DetailRow label="Documento" value={selectedDocument.documentNumber || "Sem número"} />
                  <DetailRow label="Tipo" value={selectedDocument.documentType || "Não identificado"} />
                  <DetailRow label="Serviço" value={selectedDocument.serviceDescription || "Não identificado"} />
                  <DetailRow label="Valor" value={formatCurrency(selectedDocument.grossAmount)} />
                </dl>
              </PanelSection>

              <PanelSection title="Campos extraídos">
                <dl className="space-y-3">
                  <DetailRow
                    label="Emissão"
                    value={formatCalendarDate(selectedDocument.issueDateIso) || "Não identificada"}
                  />
                  <DetailRow
                    label="Pagamento"
                    value={formatCalendarDate(selectedDocument.paymentDateIso) || "Não identificado"}
                  />
                  <DetailRow label="Aprovador" value={selectedDocument.approvedBy || "Não identificado"} />
                  <DetailRow label="Banco" value={selectedDocument.destinationBank || "Não identificado"} />
                  <DetailRow label="Status" value={selectedDocument.status || "Não identificado"} />
                </dl>
              </PanelSection>

              <PanelSection title="Divergências">
                {selectedDocument.anomalies.length > 0 ? (
                  <div className="space-y-3">
                    {selectedDocument.anomalies.map((anomaly) => (
                      <article
                        key={`${selectedDocument.id}-${anomaly.type}`}
                        className="inspection-anomaly"
                        data-severity={normalizeSeverity(anomaly.severity)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold leading-snug text-[var(--text)]">
                              {formatAnomalyType(anomaly.type)}
                            </p>
                            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                              {anomaly.message}
                            </p>
                            {describeAnomalyEvidence(anomaly, selectedDocument.fileName).length > 0 ? (
                              <div className="mt-2 space-y-1">
                                {describeAnomalyEvidence(anomaly, selectedDocument.fileName).map((line) => (
                                  <p
                                    key={`${selectedDocument.id}-${anomaly.type}-${line}`}
                                    className="text-xs leading-5 text-[var(--text-muted)]"
                                  >
                                    {line}
                                  </p>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <StatusPill tone={mapSeverityTone(anomaly.severity)}>
                            {anomaly.confidence}
                          </StatusPill>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="surface-subtle rounded-[14px] px-3 py-3">
                    <p className="text-sm leading-6 text-[var(--text-muted)]">
                      Nenhuma divergência associada ao documento selecionado.
                    </p>
                  </div>
                )}
              </PanelSection>

              <PanelSection title="Campos não extraídos">
                {selectedDocument.notExtractedFields.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedDocument.notExtractedFields.map((field) => (
                      <span key={field} className="evidence-stamp" data-severity="low">
                        {field}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm leading-6 text-[var(--text-muted)]">
                    Todos os campos obrigatórios foram extraídos.
                  </p>
                )}
              </PanelSection>

              <PanelSection title="Rastreabilidade">
                <dl className="space-y-3">
                  <DetailRow label="Encoding" value={selectedDocument.encoding} />
                  <DetailRow label="Prompt" value={selectedDocument.promptVersion} />
                  <DetailRow label="Modelo" value={selectedDocument.modelId} />
                  <DetailRow
                    label="Hash"
                    value={selectedDocument.verificationHash || "Não identificado"}
                  />
                  <DetailRow
                    label="Processado"
                    value={formatTimestamp(selectedDocument.processedAt, "full") ?? "Sem registro"}
                  />
                </dl>
              </PanelSection>
            </div>
          ) : (
            <div className="surface-subtle mt-4 flex items-start gap-3 rounded-[16px] px-4 py-4">
              <AlertTriangle className="mt-0.5 size-4 text-[var(--danger)]" />
              <p className="text-sm leading-6 text-[var(--text-muted)]">
                Ajuste os filtros ou selecione um documento na tabela.
              </p>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}

function PanelSection({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="inspection-section">
      {title ? <p className="section-kicker">{title}</p> : null}
      <div className={title ? "mt-3" : undefined}>{children}</div>
    </section>
  );
}

function CommandCounter({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="command-counter rounded-[14px] px-3 py-3">
      <p className="table-meta text-[var(--command-muted)]">{label}</p>
      <p className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[var(--command-text)]">
        {value}
      </p>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <InfoRow label={label} value={value} variant="mono" />;
}

function normalizeSeverity(severity: string): "high" | "medium" | "low" {
  if (severity === "high") {
    return "high";
  }

  if (severity === "medium") {
    return "medium";
  }

  return "low";
}

function severityLabel(severity: "high" | "medium" | "low") {
  if (severity === "high") {
    return "alta";
  }

  if (severity === "medium") {
    return "média";
  }

  return "baixa";
}

function formatCurrency(value: number | null) {
  if (typeof value !== "number") {
    return "Não identificado";
  }

  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatTimestamp(value: string | null, mode: "full" | "short" = "full") {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: mode === "short" ? "short" : "medium",
    timeStyle: mode === "short" ? undefined : "short",
  }).format(new Date(value));
}

function formatCalendarDate(value: string | null) {
  if (!value) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return formatTimestamp(value, "short");
  }

  const [, year, month, day] = match;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
  }).format(new Date(Number(year), Number(month) - 1, Number(day)));
}

function mapSeverityTone(severity: string) {
  if (severity === "high") {
    return "danger" as const;
  }

  if (severity === "medium") {
    return "warning" as const;
  }

  return "neutral" as const;
}

function formatParseStatus(value: string) {
  if (value === "parsed") {
    return "Validado";
  }

  if (value === "partial") {
    return "Parcial";
  }

  if (value === "unprocessable") {
    return "Não processável";
  }

  return value;
}

function formatExtractionMethod(value: string) {
  if (value === "parser-only") {
    return "Parser";
  }

  if (value === "gemini+parser") {
    return "Gemini + parser";
  }

  if (value === "parser-fallback") {
    return "Fallback parser";
  }

  return value;
}

function formatFindingCount(value: number) {
  return value === 1 ? "1 achado" : `${value} achados`;
}

function formatAnomalyType(value: string) {
  return ANOMALY_LABELS[value] ?? value;
}

function describeAnomalyEvidence(
  anomaly: SessionDocumentView["anomalies"][number],
  currentFileName: string,
) {
  if (anomaly.type === "DUPLICATE_DOCUMENT") {
    const relatedCurrentFiles = readEvidenceList(anomaly.evidence.relatedCurrentFiles);
    const relatedHistoricalFiles = readEvidenceList(anomaly.evidence.relatedHistoricalFiles);
    const supplierName = formatEvidenceValue(anomaly.evidence.supplierName);
    const documentNumber = formatEvidenceValue(anomaly.evidence.documentNumber);
    const lines: string[] = [`Registro atual: ${currentFileName}`];

    if (supplierName && documentNumber) {
      lines.push(`Critério usado: ${supplierName} + ${documentNumber}`);
    }

    if (relatedCurrentFiles.length > 0) {
      lines.push(`Duplicado no mesmo lote: ${relatedCurrentFiles.join(", ")}`);
    }

    const selfInHistory = relatedHistoricalFiles.includes(currentFileName);
    const otherHistoricalFiles = relatedHistoricalFiles.filter((fileName) => fileName !== currentFileName);

    if (otherHistoricalFiles.length > 0) {
      lines.push(`Comparado com referência histórica: ${otherHistoricalFiles.join(", ")}`);
    }

    if (selfInHistory && otherHistoricalFiles.length === 0) {
      lines.push("Registro atual já constava na referência histórica.");
    } else if (selfInHistory) {
      lines.push("O mesmo arquivo também já constava na referência histórica.");
    }

    return lines;
  }

  if (anomaly.type === "VALUE_OUTLIER") {
    const amount = formatEvidenceValue(anomaly.evidence.grossAmount);
    const median = formatEvidenceValue(anomaly.evidence.historicalMedian);
    const upperBound = formatEvidenceValue(anomaly.evidence.upperBound);
    const lowerBound = formatEvidenceValue(anomaly.evidence.lowerBound);
    const historicalSize = formatEvidenceValue(anomaly.evidence.historicalSize);
    const lines: string[] = [];

    if (amount) lines.push(`Valor atual: R$ ${amount}`);
    if (median && historicalSize) {
      lines.push(`Faixa histórica: mediana R$ ${median} em ${historicalSize} documentos`);
    }
    if (lowerBound && upperBound) {
      lines.push(`Intervalo esperado: R$ ${lowerBound} a R$ ${upperBound}`);
    }

    return lines;
  }

  if (anomaly.type === "INVOICE_AFTER_PAYMENT") {
    const issue = formatEvidenceValue(anomaly.evidence.invoiceIssueDateIso);
    const payment = formatEvidenceValue(anomaly.evidence.paymentDateIso);
    const lines: string[] = [];

    if (issue) lines.push(`Emissão da NF: ${issue}`);
    if (payment) lines.push(`Pagamento registrado: ${payment}`);
    lines.push("A emissão fiscal ocorreu depois do pagamento.");

    return lines;
  }

  if (anomaly.type === "STATUS_INCONSISTENT") {
    const status = formatEvidenceValue(anomaly.evidence.status);
    const payment = formatEvidenceValue(anomaly.evidence.paymentDateIso);
    const lines: string[] = [];

    if (status) lines.push(`Status atual: ${status}`);
    if (payment) lines.push(`Pagamento preenchido: ${payment}`);

    return lines;
  }

  const lines: string[] = [];
  const labelByKey: Record<string, string> = {
    approvedBy: "Aprovador",
    destinationBank: "Banco",
    grossAmount: "Valor",
    verificationHash: "Hash",
    supplierName: "Fornecedor",
    documentNumber: "Documento",
    status: "Status",
    observation: "Observação",
    canonicalCnpj: "CNPJ histórico",
    currentCnpj: "CNPJ atual",
  };

  for (const [key, rawValue] of Object.entries(anomaly.evidence)) {
    const label = labelByKey[key];
    if (!label) {
      continue;
    }

    const value = formatEvidenceValue(rawValue);
    if (!value) {
      continue;
    }

    lines.push(`${label}: ${value}`);
  }

  return lines;
}

function readEvidenceList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function formatEvidenceValue(value: unknown) {
  if (Array.isArray(value)) {
    const list = value
      .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
      .map(String);
    return list.length > 0 ? list.join(", ") : null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return null;
}
