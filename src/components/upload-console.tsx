"use client";

import { useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import pLimit from "p-limit";
import { unzipSync } from "fflate";
import {
  AlertTriangle,
  CheckCircle2,
  FileStack,
  LoaderCircle,
  Trash2,
  Upload,
} from "lucide-react";

import { StatusPill } from "@/components/status-pill";

type Stage =
  | "idle"
  | "extracting"
  | "creating-session"
  | "uploading"
  | "finalizing"
  | "done"
  | "error";

interface UploadableDocument {
  fileName: string;
  bytes: Uint8Array;
}

interface UploadConsoleProps {
  environmentReady: boolean;
  maxSessionFiles?: number;
  latestBaseline: {
    processedFiles: number;
    anomalyCount: number;
    finishedAt: string | null;
  } | null;
}

export function UploadConsole({
  environmentReady,
  maxSessionFiles = 1200,
  latestBaseline,
}: UploadConsoleProps) {
  const router = useRouter();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [statusMessage, setStatusMessage] = useState(
    "Selecione o lote para abrir a revisão rastreável.",
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [progress, setProgress] = useState({ total: 0, uploaded: 0, failed: 0 });

  const canSubmit =
    selectedFiles.length > 0 &&
    !["extracting", "creating-session", "uploading", "finalizing"].includes(stage);

  const stageItems = useMemo(
    () => [
      {
        key: "extracting",
        label: "Recebimento",
        helper: "Conferir o lote antes da ingestão.",
      },
      {
        key: "creating-session",
        label: "Abertura",
        helper: "Criar o lote e reservar a trilha da revisão.",
      },
      {
        key: "uploading",
        label: "Triagem",
        helper: "Ler campos, validar parsing e registrar alertas.",
      },
      {
        key: "finalizing",
        label: "Fechamento",
        helper: "Consolidar achados, auditoria e referência histórica.",
      },
    ],
    [],
  );

  const selectedFileNames = selectedFiles.map((file) => file.name);

  async function handleProcess() {
    try {
      setStage("extracting");
      setStatusMessage("Conferindo os arquivos do lote.");
      const documents = await expandFiles(selectedFiles);

      if (documents.length === 0) {
        throw new Error("Nenhum documento .txt foi encontrado no lote selecionado.");
      }

      if (documents.length > maxSessionFiles) {
        throw new Error(`O lote excede o limite de ${maxSessionFiles} arquivo${maxSessionFiles === 1 ? "" : "s"} por lote.`);
      }

      setProgress({ total: documents.length, uploaded: 0, failed: 0 });
      setStage("creating-session");
      setStatusMessage("Abrindo a revisão para receber as evidências.");

      const sessionResponse = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceType: "upload" }),
      });

      const sessionPayload = await sessionResponse.json();
      if (!sessionResponse.ok) {
        throw new Error(sessionPayload.error ?? "Não foi possível abrir o lote.");
      }

      const nextSessionId = sessionPayload.session.id as string;
      setSessionId(nextSessionId);
      setStage("uploading");
      setStatusMessage("Lendo os documentos e registrando os primeiros achados.");

      const limit = pLimit(4);
      await Promise.allSettled(
        documents.map((document) =>
          limit(async () => {
            const response = await fetch(`/api/sessions/${nextSessionId}/documents`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                fileName: document.fileName,
                fileBytesBase64: bytesToBase64(document.bytes),
              }),
            });

            const payload = await response.json();
            if (!response.ok) {
              throw new Error(payload.error ?? `Falha ao processar ${document.fileName}.`);
            }

            setProgress((current) => ({
              ...current,
              uploaded: current.uploaded + 1,
            }));
          }).catch((error) => {
            setProgress((current) => ({
              ...current,
              failed: current.failed + 1,
            }));
            throw error;
          }),
        ),
      );

      setStage("finalizing");
      setStatusMessage("Fechando o lote e consolidando as evidências.");

      const finalizeResponse = await fetch(`/api/sessions/${nextSessionId}/finalize`, {
        method: "POST",
      });
      const finalizePayload = await finalizeResponse.json();
      if (!finalizeResponse.ok) {
        throw new Error(finalizePayload.error ?? "Não foi possível encerrar a revisão.");
      }

      setStage("done");
      setStatusMessage("Lote consolidado. Abrindo a área de revisão.");
      router.push(`/sessions/${nextSessionId}`);
    } catch (error) {
      setStage("error");
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "A revisão foi interrompida antes do fechamento do lote.",
      );
    }
  }

  function handleFileSelection(fileList: FileList | File[] | null) {
    if (!fileList) {
      return;
    }

    setSelectedFiles(Array.from(fileList));
    setStatusMessage("Lote carregado. Revise os arquivos e inicie o processamento.");
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragActive(false);
    handleFileSelection(event.dataTransfer.files);
  }

  function clearSelection() {
    setSelectedFiles([]);
    setStatusMessage("Selecione o lote para abrir a revisão rastreável.");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  const isProcessing =
    stage === "extracting" ||
    stage === "creating-session" ||
    stage === "uploading" ||
    stage === "finalizing";

  return (
    <section className="surface-panel overflow-hidden rounded-[10px]">
      <div className="surface-command-soft border-b border-[var(--border)] px-6 py-6">
        <div className="flex items-start justify-between gap-4">
          <p className="folio-mark">Dock · Ingestão</p>
          <p className="folio-mark">F-01</p>
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="section-kicker">Receber lote</p>
            <h2 className="display-title mt-2 text-[1.9rem] leading-[1.02] sm:text-[2.1rem]">
              Receber lote.
            </h2>
            <p
              className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]"
              style={{ fontFamily: "var(--font-fraunces)", fontStyle: "italic" }}
            >
              Selecione arquivos, abra a revisão e deixe a trilha de evidências pronta
              para inspeção e exportação.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StatusPill tone={stageTone(stage)}>{labelForStage(stage)}</StatusPill>
            <StatusPill tone="neutral">
              Baseline {latestBaseline ? latestBaseline.processedFiles : 0}
            </StatusPill>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-4">
          <SnapshotCard label="Arquivos" value={selectedFiles.length} />
          <SnapshotCard label="Enviados" value={progress.uploaded} />
          <SnapshotCard label="Falhas" value={progress.failed} />
          <SnapshotCard
            label="Referência"
            value={latestBaseline ? latestBaseline.processedFiles : 0}
          />
        </div>
      </div>

      <div className="px-5 py-5">
        <input
          ref={inputRef}
          aria-label="Selecionar arquivos do lote"
          className="sr-only"
          id={inputId}
          type="file"
          name="documentBatch"
          accept=".zip,.txt"
          multiple
          onChange={(event) => handleFileSelection(event.target.files)}
        />

        <div
          className="upload-dock rounded-[10px] px-6 py-6"
          data-active={isDragActive}
          data-testid="upload-dock"
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragActive(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            if (event.currentTarget === event.target) {
              setIsDragActive(false);
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragActive(true);
          }}
          onDrop={handleDrop}
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-1 gap-4">
              <div className="dock-icon">
                <FileStack className="size-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="section-kicker">Dock de ingestão</p>
                <p
                  className="mt-2 text-[1.5rem] leading-tight text-[var(--text)]"
                  style={{
                    fontFamily: "var(--font-fraunces)",
                    fontWeight: 600,
                    fontVariationSettings: "'opsz' 48",
                    letterSpacing: "-0.025em",
                  }}
                >
                  Selecione um <em className="editorial-accent">.zip</em> ou os{" "}
                  <em className="editorial-accent">.txt</em> do lote.
                </p>
                <p
                  className="mt-3 max-w-2xl text-sm leading-6 italic text-[var(--text-muted)]"
                  style={{ fontFamily: "var(--font-fraunces)" }}
                >
                  O arquivo compactado é aberto localmente antes do envio, preservando a
                  trilha de recebimento.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    className="action-primary rounded-[6px] px-4 py-2.5 text-sm font-semibold"
                    onClick={() => inputRef.current?.click()}
                    type="button"
                  >
                    <Upload className="size-4" />
                    Selecionar arquivos
                  </button>
                  {selectedFiles.length > 0 ? (
                    <button
                      className="action-secondary rounded-[6px] px-4 py-2.5 text-sm font-semibold"
                      onClick={clearSelection}
                      type="button"
                    >
                      <Trash2 className="size-4" />
                      Limpar lote
                    </button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="dock-meta-grid lg:max-w-[290px]">
              <div className="surface-subtle rounded-[6px] px-4 py-3">
                <p className="subsection-label">Saídas prontas</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="meta-chip">Resultados .xlsx</span>
                  <span className="meta-chip">Auditoria .xlsx</span>
                  <span className="meta-chip">Base para BI</span>
                </div>
              </div>
              <div className="surface-subtle rounded-[6px] px-4 py-3">
                <p className="subsection-label">Recebimento</p>
                <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">
                  ZIP e TXT, lote único, ordenação por arquivo e revisão contínua.
                </p>
              </div>
            </div>
          </div>
        </div>

        {selectedFiles.length > 0 ? (
          <div className="surface-subtle mt-3 rounded-[8px] px-4 py-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="section-kicker">Lote selecionado</p>
                <p className="mt-2 text-sm font-semibold text-[var(--text)]">
                  {selectedFiles.length === 1
                    ? "1 arquivo selecionado"
                    : `${selectedFiles.length} arquivos selecionados`}
                </p>
              </div>
              <span className="meta-chip">
                {selectedFiles.some((file) => file.name.toLowerCase().endsWith(".zip"))
                  ? "Inclui .zip"
                  : "Arquivos .txt"}
              </span>
            </div>
            <div className="mt-3 grid gap-2">
              {selectedFileNames.slice(0, 6).map((fileName, index) => (
                <div
                  key={fileName}
                  className="snapshot-card flex items-center gap-3 rounded-[4px] px-3 py-2 text-sm"
                >
                  <span className="font-mono text-[10px] tabular-nums text-[var(--text-faint)]">
                    {String(index + 1).padStart(3, "0")}
                  </span>
                  <span className="truncate">{fileName}</span>
                </div>
              ))}
              {selectedFileNames.length > 6 ? (
                <p className="text-xs italic text-[var(--text-muted)]" style={{ fontFamily: "var(--font-fraunces)" }}>
                  +{selectedFileNames.length - 6} arquivos adicionais no lote.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="surface-subtle mt-4 rounded-[8px] px-4 py-4">
          <div className="flex items-baseline justify-between gap-3">
            <p className="subsection-label">Andamento</p>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-faint)]">
              {stageItems.findIndex((e) => e.key === stage) >= 0
                ? `Estágio ${stageItems.findIndex((e) => e.key === stage) + 1}/4`
                : stage === "done"
                  ? "Encerrado"
                  : "Aguardando"}
            </p>
          </div>

          <div className="strip-chart mt-3" role="presentation" aria-hidden>
            {stageItems.map((item) => {
              const currentIndex = stageItems.findIndex((entry) => entry.key === stage);
              const itemIndex = stageItems.findIndex((entry) => entry.key === item.key);
              const isCurrent = stage === item.key;
              const isDone =
                stage === "done" || (currentIndex > itemIndex && stage !== "error");

              return (
                <span
                  key={item.key}
                  className="strip-chart-bar"
                  data-current={isCurrent}
                  data-done={isDone}
                />
              );
            })}
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {stageItems.map((item, index) => {
              const currentIndex = stageItems.findIndex((entry) => entry.key === stage);
              const itemIndex = stageItems.findIndex((entry) => entry.key === item.key);
              const isCurrent = stage === item.key;
              const isDone =
                stage === "done" || (currentIndex > itemIndex && stage !== "error");

              return (
                <div
                  key={item.key}
                  className="status-track rounded-[6px] border border-transparent px-2 py-2"
                  data-current={isCurrent}
                  data-done={isDone}
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-[9px] font-medium uppercase tracking-[0.2em] text-[var(--text-faint)]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text)]">
                      {item.label}
                    </p>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">
                    {item.helper}
                  </p>
                </div>
              );
            })}
          </div>

          {isProcessing ? (
            <div className="ticker mt-3" aria-hidden>
              <div className="ticker-track">
                <span className="ticker-item">Extraindo campos normalizados</span>
                <span className="ticker-item">Comparando com baseline histórica</span>
                <span className="ticker-item">Avaliando hash de verificação</span>
                <span className="ticker-item">Registrando evidências na trilha</span>
                <span className="ticker-item">Validando CNPJ e aprovador</span>
                <span className="ticker-item">Detectando valores fora da faixa</span>
              </div>
            </div>
          ) : null}
        </div>

        {progress.total > 0 && stage !== "done" && stage !== "error" ? (
          <div
            aria-live="polite"
            className="surface-subtle mt-4 rounded-[8px] px-4 py-3"
            role="status"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="subsection-label">Progresso do lote</p>
              <p className="ledger-number text-[12px] text-[var(--text-muted)]">
                {progress.uploaded}/{progress.total}
              </p>
            </div>
            <div
              aria-label="Progresso do processamento"
              aria-valuemax={progress.total}
              aria-valuemin={0}
              aria-valuenow={progress.uploaded}
              className="progress-track mt-2"
              role="progressbar"
            >
              <div
                className="progress-bar"
                style={{
                  width: `${Math.min(100, (progress.uploaded / progress.total) * 100)}%`,
                }}
              />
            </div>
            {progress.failed > 0 ? (
              <p
                className="mt-2 text-xs italic text-[var(--danger)]"
                style={{ fontFamily: "var(--font-fraunces)" }}
              >
                {progress.failed} {progress.failed === 1 ? "arquivo falhou" : "arquivos falharam"}{" "}
                e a revisão continua com o restante.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="surface-command-soft mt-4 rounded-[10px] px-5 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-2">
              <p className="section-kicker">Acompanhamento</p>
              <p
                className="text-[15px] leading-6 text-[var(--text)]"
                style={{ fontFamily: "var(--font-fraunces)", fontStyle: "italic" }}
              >
                {statusMessage}
              </p>
              {sessionId ? (
                <p className="folio-mark">Lote {sessionId.slice(0, 8)}</p>
              ) : null}
            </div>

            <button
              className="action-primary w-full rounded-[6px] px-4 py-3 text-sm font-semibold lg:w-auto"
              disabled={!canSubmit}
              onClick={handleProcess}
              type="button"
            >
              {isProcessing ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Processar lote
            </button>
          </div>
        </div>

        {stage === "error" ? (
          <div
            aria-live="assertive"
            className="mt-4 flex items-start gap-3 rounded-[8px] border border-[color-mix(in_srgb,var(--danger)_40%,transparent)] bg-[var(--danger-soft)] px-4 py-4"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[var(--danger)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="section-kicker" style={{ color: "var(--danger)" }}>
                Revisão interrompida
              </p>
              <p
                className="mt-2 break-words text-[15px] leading-6 text-[var(--text-muted)]"
                style={{ fontFamily: "var(--font-fraunces)", fontStyle: "italic" }}
              >
                {statusMessage}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="action-secondary rounded-[4px] px-3 py-1.5 text-xs font-semibold"
                  onClick={() => {
                    setStage("idle");
                    setStatusMessage("Selecione o lote para abrir a revisão rastreável.");
                    setProgress({ total: 0, uploaded: 0, failed: 0 });
                  }}
                  type="button"
                >
                  Recomeçar
                </button>
                {selectedFiles.length > 0 ? (
                  <button
                    className="action-primary rounded-[4px] px-3 py-1.5 text-xs font-semibold"
                    onClick={handleProcess}
                    type="button"
                  >
                    Tentar novamente
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {!environmentReady ? (
          <div className="mt-4 rounded-[8px] border border-[rgba(208,92,84,0.28)] bg-[var(--danger-soft)] px-4 py-4">
            <p className="section-kicker" style={{ color: "var(--danger)" }}>
              Integrações pendentes
            </p>
            <p
              className="mt-2 text-[15px] leading-6 text-[var(--text-muted)]"
              style={{ fontFamily: "var(--font-fraunces)", fontStyle: "italic" }}
            >
              Verifique o <code className="font-mono text-[12px] text-[var(--text)]">DATABASE_URL</code>{" "}
              e a chave do provedor antes de abrir uma revisão completa.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function SnapshotCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="snapshot-card rounded-[6px] px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--text-faint)]">
        {label}
      </p>
      <p
        className="mt-2 text-[1.9rem] leading-none text-[var(--text)]"
        style={{
          fontFamily: "var(--font-fraunces)",
          fontWeight: 600,
          fontVariationSettings: "'opsz' 48",
          fontVariantNumeric: "tabular-nums lining-nums",
          letterSpacing: "-0.025em",
        }}
      >
        {value}
      </p>
    </div>
  );
}

function labelForStage(stage: Stage) {
  if (stage === "creating-session") {
    return "Abrindo revisão";
  }

  if (stage === "uploading") {
    return "Em triagem";
  }

  if (stage === "finalizing") {
    return "Fechando lote";
  }

  if (stage === "done") {
    return "Revisão pronta";
  }

  if (stage === "error") {
    return "Erro";
  }

  return "Pronto";
}

function stageTone(stage: Stage) {
  if (stage === "done") {
    return "success" as const;
  }

  if (stage === "error") {
    return "danger" as const;
  }

  if (
    stage === "extracting" ||
    stage === "creating-session" ||
    stage === "uploading" ||
    stage === "finalizing"
  ) {
    return "warning" as const;
  }

  return "neutral" as const;
}

async function expandFiles(files: File[]) {
  const documents: UploadableDocument[] = [];

  for (const file of files) {
    if (file.name.toLowerCase().endsWith(".zip")) {
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
      for (const [entryName, bytes] of Object.entries(archive)) {
        if (entryName.endsWith("/") || !entryName.toLowerCase().endsWith(".txt")) {
          continue;
        }

        documents.push({
          fileName: entryName.split("/").at(-1) ?? entryName,
          bytes,
        });
      }
      continue;
    }

    documents.push({
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }

  return documents.sort((left, right) => left.fileName.localeCompare(right.fileName));
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary);
}
