import { expect, test } from "@playwright/test";
import { strToU8, zipSync } from "fflate";

test("processa lote txt e navega para sessão", async ({ page }) => {
  const uploadBodies: Array<{ fileName: string }> = [];

  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "test-session-flow",
        },
      }),
    });
  });

  await page.route("**/api/sessions/test-session-flow/documents", async (route) => {
    const payload = route.request().postDataJSON() as { fileName: string };
    uploadBodies.push({ fileName: payload.fileName });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        documentId: `doc-${uploadBodies.length}`,
        extractionMethod: "parser-only",
        modelId: "parser",
      }),
    });
  });

  await page.route("**/api/sessions/test-session-flow/finalize", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "test-session-flow",
          status: "finalized",
        },
        documents: [],
      }),
    });
  });

  await page.goto("/");

  const sampleText = [
    "TIPO_DOCUMENTO: NOTA_FISCAL",
    "NUMERO_DOCUMENTO: NF-E2E-001",
    "DATA_EMISSAO: 01/04/2026",
    "FORNECEDOR: Fornecedor E2E",
    "CNPJ_FORNECEDOR: 12.345.678/0001-90",
    "DESCRICAO_SERVICO: Teste de ingestao",
    "VALOR_BRUTO: R$ 120,00",
    "DATA_PAGAMENTO: 03/04/2026",
    "DATA_EMISSAO_NF: 01/04/2026",
    "APROVADO_POR: Maria",
    "BANCO_DESTINO: Banco E2E",
    "STATUS: PAGO",
    "HASH_VERIFICACAO: NLC123456",
  ].join("\n");

  await page.setInputFiles('input[type="file"]', {
    name: "DOC_E2E_001.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(sampleText, "utf-8"),
  });

  await page.getByRole("button", { name: /processar lote/i }).click();

  await expect.poll(() => uploadBodies.length).toBe(1);
  await expect(page).toHaveURL(/\/sessions\/test-session-flow$/i);

  expect(uploadBodies[0]?.fileName).toBe("DOC_E2E_001.txt");
});

test("expande zip no cliente e envia cada txt interno", async ({ page }) => {
  const uploadBodies: Array<{ fileName: string }> = [];

  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "test-session-zip",
        },
      }),
    });
  });

  await page.route("**/api/sessions/test-session-zip/documents", async (route) => {
    const payload = route.request().postDataJSON() as { fileName: string };
    uploadBodies.push({ fileName: payload.fileName });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        documentId: `doc-${uploadBodies.length}`,
        extractionMethod: "parser-only",
        modelId: "parser",
      }),
    });
  });

  await page.route("**/api/sessions/test-session-zip/finalize", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session: {
          id: "test-session-zip",
          status: "finalized",
        },
        documents: [],
      }),
    });
  });

  await page.goto("/");

  const zipBytes = zipSync({
    "nested/DOC_ZIP_002.txt": strToU8("conteudo 2"),
    "DOC_ZIP_001.txt": strToU8("conteudo 1"),
    "nested/IGNORAR.png": new Uint8Array([1, 2, 3]),
  });

  await page.setInputFiles('input[type="file"]', {
    name: "lote.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(zipBytes),
  });

  await page.getByRole("button", { name: /processar lote/i }).click();

  await expect.poll(() => uploadBodies.length).toBe(2);
  await expect(page).toHaveURL(/\/sessions\/test-session-zip$/i);

  expect(uploadBodies.map((item) => item.fileName)).toEqual([
    "DOC_ZIP_001.txt",
    "DOC_ZIP_002.txt",
  ]);
});
