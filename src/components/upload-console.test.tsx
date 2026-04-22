import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";

import { UploadConsole } from "@/components/upload-console";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

function renderConsole(options?: { maxSessionFiles?: number }) {
  const Console = UploadConsole as ComponentType<{
    environmentReady: boolean;
    latestBaseline: {
      processedFiles: number;
      anomalyCount: number;
      finishedAt: string | null;
    } | null;
    maxSessionFiles?: number;
  }>;

  return render(
    <Console
      environmentReady
      maxSessionFiles={options?.maxSessionFiles}
      latestBaseline={{
        processedFiles: 1001,
        anomalyCount: 1298,
        finishedAt: "2026-04-17T02:57:00.000Z",
      }}
    />,
  );
}

describe("UploadConsole", () => {
  it("renders the audit control room intake landmarks", () => {
    renderConsole();

    expect(
      screen.getByRole("heading", {
        name: /receber lote/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/dock de ingestão/i)).toBeInTheDocument();
    expect(screen.getByText(/saídas prontas/i)).toBeInTheDocument();
  });

  it("shows selected file names after choosing files", () => {
    renderConsole();

    const input = screen.getByLabelText(/selecionar arquivos do lote/i);
    fireEvent.change(input, {
      target: {
        files: [
          new File(["one"], "DOC_0001.txt", { type: "text/plain" }),
          new File(["two"], "DOC_0002.txt", { type: "text/plain" }),
        ],
      },
    });

    expect(screen.getByText(/2 arquivos selecionados/i)).toBeInTheDocument();
    expect(screen.getByText("DOC_0001.txt")).toBeInTheDocument();
    expect(screen.getByText("DOC_0002.txt")).toBeInTheDocument();
  });

  it("accepts dropped files into the lot area", () => {
    renderConsole();

    const dropzone = screen.getByTestId("upload-dock");
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [new File(["zip"], "arquivos_nf.zip", { type: "application/zip" })],
      },
    });

    expect(screen.getByText(/1 arquivo selecionado/i)).toBeInTheDocument();
    expect(screen.getByText("arquivos_nf.zip")).toBeInTheDocument();
  });

  it("blocks processing before API calls when the selected batch exceeds the session limit", async () => {
    renderConsole({ maxSessionFiles: 1 });

    const input = screen.getByLabelText(/selecionar arquivos do lote/i);
    fireEvent.change(input, {
      target: {
        files: [
          new File(["one"], "DOC_0001.txt", { type: "text/plain" }),
          new File(["two"], "DOC_0002.txt", { type: "text/plain" }),
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /processar lote/i }));

    expect(await screen.findAllByText(/limite de 1 arquivo por lote/i)).not.toHaveLength(0);
  });
});
