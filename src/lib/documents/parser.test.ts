import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseUploadedDocument } from "@/lib/documents/parser";

async function loadFixture(fileName: string) {
  const fixturePath = path.resolve(process.cwd(), "..", fileName);
  return readFile(fixturePath);
}

describe("parseUploadedDocument", () => {
  it("parses a well-formed UTF-8 document into normalized fields", async () => {
    const bytes = await loadFixture("DOC_0001.txt");

    const parsed = parseUploadedDocument("DOC_0001.txt", bytes);

    expect(parsed.encoding).toBe("utf-8");
    expect(parsed.status).toBe("parsed");
    expect(parsed.missingFields).toEqual([]);
    expect(parsed.normalized.documentNumber).toBe("NF-87397");
    expect(parsed.normalized.documentType).toBe("NOTA_FISCAL");
    expect(parsed.normalized.supplierName).toBe("TechSoft Ltda");
    expect((parsed.normalized as Record<string, unknown>).serviceDescription).toBe(
      "Suporte Técnico Mensal",
    );
    expect(parsed.normalized.supplierCnpjNormalized).toBe("12345678000190");
    expect(parsed.normalized.grossAmount).toBe(8500);
    expect(parsed.normalized.issueDateIso).toBe("2025-01-29");
    expect(parsed.normalized.paymentDateIso).toBe("2025-02-07");
    expect(parsed.warningCodes).toEqual([]);
    expect((parsed as unknown as { notExtractedFields: string[] }).notExtractedFields).toEqual([]);
  });

  it("marks truncated or malformed files explicitly instead of assuming blanks are valid", async () => {
    const bytes = await loadFixture("DOC_0089.txt");

    const parsed = parseUploadedDocument("DOC_0089.txt", bytes);

    expect(parsed.status).toBe("partial");
    expect(parsed.missingFields).toContain("HASH_VERIFICACAO");
    expect(parsed.normalized.status).toBe("PAG");
    expect(parsed.warningCodes).toContain("STATUS_UNRECOGNIZED");
    expect(parsed.warningCodes).toContain("MISSING_REQUIRED_FIELDS");
    expect(
      (parsed as unknown as { notExtractedFields: string[] }).notExtractedFields,
    ).toContain("HASH_VERIFICACAO");
  });

  it("falls back to latin1 when decoding a broken file and preserves that evidence", async () => {
    const bytes = await loadFixture("DOC_0487.txt");

    const parsed = parseUploadedDocument("DOC_0487.txt", bytes);

    expect(parsed.encoding).toBe("latin1");
    expect(parsed.warningCodes).toContain("ENCODING_FALLBACK");
    expect(parsed.warningCodes).toContain("HASH_MALFORMED");
    expect(parsed.normalized.supplierName).toBe("Serviços Gamma SA");
    expect(parsed.normalized.verificationHash).toContain("NLC048701");
  });
});
