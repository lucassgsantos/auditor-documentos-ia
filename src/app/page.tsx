import { StatusPill } from "@/components/status-pill";
import { UploadConsole } from "@/components/upload-console";
import { getAppConfig } from "@/lib/config";
import { loadLatestBaselineSeedSession } from "@/lib/server/sessions";

export const dynamic = "force-dynamic";

const outputItems = [
  {
    title: "Resultados do lote",
    helper: "Planilha principal com campos, achados, modelo e resumo por anomalia.",
  },
  {
    title: "Auditoria exportável",
    helper: "Log por arquivo, regra, evidência, confiança e processamento.",
  },
  {
    title: "Base para BI",
    helper: "Saída pronta para cards, filtros, detalhamento e trilha histórica.",
  },
] as const;

const flowItems = [
  {
    roman: "I",
    label: "Recebimento",
    helper: "Lote conferido antes da ingestão.",
  },
  {
    roman: "II",
    label: "Abertura",
    helper: "Revisão aberta, trilha iniciada.",
  },
  {
    roman: "III",
    label: "Triagem",
    helper: "Leitura, parsing e alertas.",
  },
  {
    roman: "IV",
    label: "Fechamento",
    helper: "Evidências consolidadas.",
  },
] as const;

export default async function Home() {
  const config = getAppConfig();
  const providerLabel = resolveProviderLabel(config);
  const aiModeLabel = config.forceAiExtraction ? "IA forçada" : "IA híbrida";
  const environmentReady = Boolean(
    config.databaseUrl &&
      ((config.aiProvider === "gemini" && config.geminiApiKey) ||
        (config.aiProvider === "openai" && config.openAiApiKey) ||
        (config.aiProvider === "auto" && (config.geminiApiKey || config.openAiApiKey))),
  );

  let latestBaseline = null;
  if (config.databaseUrl) {
    try {
      latestBaseline = await loadLatestBaselineSeedSession();
    } catch {
      latestBaseline = null;
    }
  }

  const seededCorpusLabel = latestBaseline
    ? `${latestBaseline.processedFiles} arquivos`
    : "Sem baseline";
  const seededCorpusOrigin =
    latestBaseline?.processedFiles === 1001
      ? "1000 do lote oficial + 1 arquivo versionado"
      : latestBaseline
        ? `${latestBaseline.processedFiles} documentos consolidados`
        : "Referência ainda não consolidada";

  const folioNumber = buildFolioNumber(latestBaseline);

  return (
    <main className="control-shell mx-auto min-h-screen w-full max-w-[1520px] px-4 pb-10 pt-5 sm:px-6 lg:px-8">
      <div className="stagger-group space-y-5">
        <header className="surface-command rounded-[10px] px-6 py-7 sm:px-8 sm:py-8">
          <div className="flex items-start justify-between gap-4">
            <p className="folio-mark">Dossiê aberto · PT-BR</p>
            <p className="folio-mark">{folioNumber}</p>
          </div>

          <div className="mt-6 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl space-y-4">
              <p className="section-kicker">Mesa de revisão documental</p>
              <h1 className="display-title text-[2.6rem] sm:text-[3.4rem] xl:text-[3.9rem]">
                Central de revisão
                <br />
                <span className="editorial-accent">&amp;</span>{" "}
                evidência auditável.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-[var(--command-muted)]">
                Lote, campos extraídos e divergências numa mesma mesa de trabalho —
                com exportação pronta para auditoria e BI.
              </p>
            </div>

            <div className="flex flex-col items-start gap-3 xl:items-end">
              <span
                aria-hidden
                className="rule-line w-20"
                style={{ color: "var(--accent-strong)", opacity: 0.7 }}
              />
              <div className="flex flex-wrap gap-2 xl:justify-end">
                <StatusPill surface="dark" tone={environmentReady ? "success" : "warning"}>
                  {environmentReady ? "Ambiente validado" : "Ambiente pendente"}
                </StatusPill>
                <StatusPill surface="dark" tone="neutral">
                  {providerLabel}
                </StatusPill>
                <StatusPill surface="dark" tone={config.forceAiExtraction ? "warning" : "neutral"}>
                  {aiModeLabel}
                </StatusPill>
                <StatusPill surface="dark" tone="neutral">
                  Baseline {seededCorpusLabel}
                </StatusPill>
                <StatusPill surface="dark" tone={latestBaseline ? "success" : "warning"}>
                  {latestBaseline ? "Referência ativa" : "Referência pendente"}
                </StatusPill>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
          <UploadConsole
            environmentReady={environmentReady}
            maxSessionFiles={config.maxSessionFiles}
            latestBaseline={latestBaseline}
          />

          <div className="space-y-5">
            <section className="dossier-surface rounded-[4px] px-6 py-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-kicker section-kicker-dossier">
                    Referência histórica
                  </p>
                  <p className="dossier-ink-muted mt-2 text-[14px] leading-6 italic" style={{ fontFamily: "var(--font-fraunces)" }}>
                    Base ativa para comparação de fornecedor, documento e histórico do lote.
                  </p>
                </div>
                <StatusPill surface="dossier" tone={latestBaseline ? "success" : "warning"}>
                  {latestBaseline ? "Ativa" : "Pendente"}
                </StatusPill>
              </div>

              <div className="mt-6 flex items-baseline gap-3">
                <span className="dossier-value-number text-[3.4rem] leading-none">
                  {latestBaseline ? latestBaseline.processedFiles : 0}
                </span>
                <span className="dossier-label">documentos</span>
              </div>
              <div className="mt-1 flex items-baseline gap-3">
                <span
                  className="dossier-value-number text-[1.5rem] leading-none"
                  style={{ color: "var(--stamp-red)" }}
                >
                  {latestBaseline ? latestBaseline.anomalyCount : 0}
                </span>
                <span className="dossier-label">achados registrados</span>
              </div>

              <div
                aria-hidden
                className="mt-6 h-px"
                style={{ background: "var(--dossier-rule)", opacity: 0.55 }}
              />

              <dl className="mt-5 space-y-3">
                <DossierRow label="Origem" value={seededCorpusOrigin} />
                <DossierRow
                  label="Limite"
                  value={`${config.maxSessionFiles} arquivos por lote`}
                />
                <DossierRow
                  label="Atualizada"
                  value={
                    latestBaseline?.finishedAt
                      ? formatTimestamp(latestBaseline.finishedAt)
                      : "Sem registro"
                  }
                />
              </dl>
            </section>

            <section className="surface-panel rounded-[10px] px-5 py-5">
              <p className="section-kicker">Saídas da revisão</p>
              <div className="mt-4 space-y-2">
                {outputItems.map((item) => (
                  <article
                    key={item.title}
                    className="surface-subtle rounded-[6px] px-4 py-3"
                  >
                    <p className="text-sm font-semibold text-[var(--text)]">
                      {item.title}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
                      {item.helper}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="surface-panel rounded-[10px] px-6 py-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="section-kicker">Fluxo do lote</p>
              <p
                className="mt-2 text-sm italic text-[var(--text-muted)]"
                style={{ fontFamily: "var(--font-fraunces)" }}
              >
                Quatro estágios, uma única trilha rastreável.
              </p>
            </div>
            <span className="folio-mark">Fluxo IV-STG</span>
          </div>

          <div
            className="flow-rail mt-6"
            style={{ ["--flow-count" as string]: flowItems.length }}
          >
            {flowItems.map((item) => (
              <div key={item.roman} className="flow-step">
                <span className="flow-step-marker">{item.roman}</span>
                <div className="space-y-1">
                  <p className="flow-step-label">{item.label}</p>
                  <p className="flow-step-helper">{item.helper}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function DossierRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-3">
      <dt className="dossier-label">{label}</dt>
      <dd className="dossier-value text-[13px] leading-5">{value}</dd>
    </div>
  );
}

function resolveProviderLabel(config: ReturnType<typeof getAppConfig>) {
  if (config.aiProvider === "gemini") {
    return "Gemini 2.5 Flash-Lite";
  }

  if (config.aiProvider === "openai") {
    return "OpenAI Responses";
  }

  if (config.geminiApiKey) {
    return "Gemini automático";
  }

  if (config.openAiApiKey) {
    return "OpenAI automático";
  }

  return "Sem provedor";
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function buildFolioNumber(
  baseline: Awaited<ReturnType<typeof loadLatestBaselineSeedSession>>,
) {
  const year = new Date().getFullYear();
  const seq = baseline?.processedFiles ?? 0;
  return `DOS-${year}/${String(seq).padStart(4, "0")}`;
}
