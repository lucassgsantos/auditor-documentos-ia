import { expect, test } from "@playwright/test";

test("homepage renders the audit control room intake", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/auditor de documentos com ia/i);
  await expect(
    page.getByRole("heading", {
      name: /central de revisão/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /receber lote/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /processar lote/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/selecione um \.zip ou os \.txt do lote/i),
  ).toBeVisible();
  await expect(page.getByText(/saídas da revisão/i)).toBeVisible();
  await expect(page.getByText(/referência histórica/i).first()).toBeVisible();
});
