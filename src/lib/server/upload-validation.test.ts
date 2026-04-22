import { describe, expect, it } from "vitest";

describe("validateUploadDocumentInput", () => {
  it("accepts a normal txt document within the configured limits", async () => {
    const validationModule = (await import("@/lib/server/upload-validation")) as Record<string, unknown>;
    const validateUploadDocumentInput = validationModule.validateUploadDocumentInput as
      | ((input: { fileName: string; fileSize: number; maxUploadBytes: number }) => void)
      | undefined;

    expect(typeof validateUploadDocumentInput).toBe("function");
    expect(() =>
      validateUploadDocumentInput?.({
        fileName: "DOC_0001.txt",
        fileSize: 128,
        maxUploadBytes: 2_000_000,
      }),
    ).not.toThrow();
  });

  it("rejects unsafe names, non-txt files, empty files, and oversized files", async () => {
    const validationModule = (await import("@/lib/server/upload-validation")) as Record<string, unknown>;
    const validateUploadDocumentInput = validationModule.validateUploadDocumentInput as
      | ((input: { fileName: string; fileSize: number; maxUploadBytes: number }) => void)
      | undefined;

    expect(() =>
      validateUploadDocumentInput?.({
        fileName: "../DOC_0001.txt",
        fileSize: 128,
        maxUploadBytes: 2_000_000,
      }),
    ).toThrow(/nome de arquivo/i);
    expect(() =>
      validateUploadDocumentInput?.({
        fileName: "DOC_0001.pdf",
        fileSize: 128,
        maxUploadBytes: 2_000_000,
      }),
    ).toThrow(/\.txt/i);
    expect(() =>
      validateUploadDocumentInput?.({
        fileName: "DOC_0001.txt",
        fileSize: 0,
        maxUploadBytes: 2_000_000,
      }),
    ).toThrow(/vazio/i);
    expect(() =>
      validateUploadDocumentInput?.({
        fileName: "DOC_0001.txt",
        fileSize: 2_000_001,
        maxUploadBytes: 2_000_000,
      }),
    ).toThrow(/limite/i);
  });

  it("prevents sessions from ingesting more files than the configured cap", async () => {
    const validationModule = (await import("@/lib/server/upload-validation")) as Record<string, unknown>;
    const assertSessionFileLimit = validationModule.assertSessionFileLimit as
      | ((input: { currentFiles: number; incomingFiles: number; maxSessionFiles: number }) => void)
      | undefined;

    expect(typeof assertSessionFileLimit).toBe("function");
    expect(() =>
      assertSessionFileLimit?.({
        currentFiles: 2,
        incomingFiles: 1,
        maxSessionFiles: 2,
      }),
    ).toThrow(/limite de 2 arquivos por lote/i);
  });
});
