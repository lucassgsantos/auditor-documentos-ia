import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AUDIT_COLUMN_LABELS,
  buildAuditRows,
  buildResultsWorkbookSheets,
} from "@/lib/documents/exports";
import { buildWorkbookBuffer } from "@/lib/documents/workbook";
import {
  loadLatestBaselineSeedSession,
  loadSessionAuditRows,
  loadSessionDocuments,
} from "@/lib/server/sessions";

loadScriptEnv();

async function main() {
  const session = await loadLatestBaselineSeedSession();
  if (!session) {
    throw new Error(
      "No finalized baseline_seed session found. Run `npm run seed:baseline` first.",
    );
  }

  const documents = await loadSessionDocuments(session.id);
  const auditRows = await loadSessionAuditRows(session.id);

  const resultsSheets = buildResultsWorkbookSheets(documents);
  const resultsBuffer = await buildWorkbookBuffer(resultsSheets);

  const auditBuffer = await buildWorkbookBuffer([
    { name: "audit", rows: auditRows, columnLabels: AUDIT_COLUMN_LABELS },
  ]);

  const auditRowObjects = buildAuditRows(documents);
  const outputDir = path.resolve(process.cwd(), "..", "docs", "power-bi");
  await mkdir(outputDir, { recursive: true });

  const resultsPath = path.join(outputDir, "results.xlsx");
  const auditPath = path.join(outputDir, "audit.xlsx");
  const metadataPath = path.join(outputDir, "session-metadata.json");

  await writeFile(resultsPath, resultsBuffer);
  await writeFile(auditPath, auditBuffer);
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        sessionId: session.id,
        label: session.label,
        totalFiles: session.totalFiles,
        processedFiles: session.processedFiles,
        anomalyCount: session.anomalyCount,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
        auditEntryCount: auditRowObjects.length,
        exportedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        sessionId: session.id,
        resultsPath,
        auditPath,
        metadataPath,
        rowCounts: {
          results: resultsSheets[0]?.rows.length ?? 0,
          anomalySummary: resultsSheets[1]?.rows.length ?? 0,
          audit: auditRows.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function loadScriptEnv() {
  const envFiles = [
    path.resolve(process.cwd(), ".env.vercel.local"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), ".env"),
  ];

  for (const envFile of envFiles) {
    if (!existsSync(envFile)) {
      continue;
    }

    const content = readFileSync(envFile, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 1) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, "");

      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}
