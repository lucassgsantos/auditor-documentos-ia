import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import pLimit from "p-limit";

import { getAppConfig } from "@/lib/config";
import { finalizeSession, ingestDocumentForSession } from "@/lib/server/processing";
import { createProcessingSession } from "@/lib/server/sessions";

loadScriptEnv();

async function main() {
  const config = getAppConfig();
  const hasConfiguredProvider =
    (config.aiProvider === "gemini" && Boolean(config.geminiApiKey)) ||
    (config.aiProvider === "openai" && Boolean(config.openAiApiKey)) ||
    (config.aiProvider === "auto" && Boolean(config.geminiApiKey || config.openAiApiKey));

  if (!config.databaseUrl || !hasConfiguredProvider) {
    throw new Error(
      "DATABASE_URL and at least one configured AI provider must be set before seeding the baseline.",
    );
  }

  const corpusDirectory = path.resolve(process.cwd(), "..");
  const entries = await readdir(corpusDirectory);
  const fileNames = entries
    .filter((entry) => /^DOC_\d+(?:_v\d+)?\.txt$/i.test(entry))
    .sort((left, right) => left.localeCompare(right));

  if (fileNames.length === 0) {
    throw new Error(`No DOC_*.txt files were found in ${corpusDirectory}.`);
  }

  const sessionId = await createProcessingSession({
    sourceType: "baseline_seed",
    label: `baseline-seed-${new Date().toISOString()}`,
  });

  console.log(`Seeding baseline session ${sessionId} with ${fileNames.length} documents...`);

  const concurrency = Number(process.env.SEED_CONCURRENCY ?? "3");
  const limit = pLimit(concurrency);

  let uploaded = 0;
  let failed = 0;

  await Promise.allSettled(
    fileNames.map((fileName) =>
      limit(async () => {
        const filePath = path.join(corpusDirectory, fileName);
        const bytes = await readFile(filePath);

        await ingestDocumentForSession({
          sessionId,
          fileName,
          fileBytesBase64: bytes.toString("base64"),
        });

        uploaded += 1;
        if (uploaded % 25 === 0 || uploaded === fileNames.length) {
          console.log(`Uploaded ${uploaded}/${fileNames.length} documents...`);
        }
      }).catch((error) => {
        failed += 1;
        console.error(`Failed to ingest ${fileName}:`, error);
      }),
    ),
  );

  console.log(`Finalizing session ${sessionId}. Uploaded: ${uploaded}. Failed: ${failed}.`);
  const result = await finalizeSession(sessionId);

  console.log("Baseline session finalized.");
  console.log(
    JSON.stringify(
      {
        sessionId,
        sessionStatus: result.session?.status,
        processedFiles: result.session?.processedFiles,
        anomalyCount: result.session?.anomalyCount,
        failed,
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
