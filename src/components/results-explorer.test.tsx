import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ResultsExplorer,
  type SessionDocumentView,
} from "@/components/results-explorer";

const sampleSession = {
  id: "abc12345-session",
  status: "finalized",
  processedFiles: 2,
  totalFiles: 2,
  anomalyCount: 2,
  startedAt: "2026-04-17T08:00:00.000Z",
  finishedAt: "2026-04-17T08:10:00.000Z",
};

const sampleDocuments: SessionDocumentView[] = [
  {
    id: "doc-1",
    fileName: "DOC_0001.txt",
    parseStatus: "parsed",
    encoding: "utf-8",
    documentType: "NOTA_FISCAL",
    documentNumber: "NF-1001",
    serviceDescription: "Licença de Software ERP",
    supplierName: "TechSoft Ltda",
    supplierCnpj: "12345678000190",
    grossAmount: 8500,
    issueDateIso: "2025-01-29",
    paymentDateIso: "2025-02-07",
    invoiceIssueDateIso: "2025-01-28",
    approvedBy: "Maria Silva",
    destinationBank: "Banco do Brasil",
    status: "PAGO",
    verificationHash: "NLC123",
    extractionMethod: "parser-only",
    modelId: "parser",
    promptVersion: "document-extractor-v2",
    processedAt: "2026-04-17T08:05:00.000Z",
    notExtractedFields: [],
    anomalies: [
      {
        type: "STATUS_INCONSISTENT",
        severity: "medium",
        confidence: "MEDIUM",
        message: "Status do pagamento inconsistente com o documento.",
        evidence: {},
      },
    ],
  },
  {
    id: "doc-2",
    fileName: "DOC_0002.txt",
    parseStatus: "partial",
    encoding: "latin1",
    documentType: "RECIBO",
    documentNumber: "RC-2002",
    serviceDescription: "Manutenção predial",
    supplierName: "Office Prime",
    supplierCnpj: "00999888000155",
    grossAmount: 1240,
    issueDateIso: "2025-02-10",
    paymentDateIso: "2025-02-12",
    invoiceIssueDateIso: "2025-02-11",
    approvedBy: "Carlos Lima",
    destinationBank: "Caixa",
    status: "PAGO",
    verificationHash: "NLC456",
    extractionMethod: "gemini+parser",
    modelId: "gemini-2.5-flash-lite",
    promptVersion: "document-extractor-v2",
    processedAt: "2026-04-17T08:06:00.000Z",
    notExtractedFields: ["HASH_VERIFICACAO"],
    anomalies: [
      {
        type: "CNPJ_DIVERGENT",
        severity: "high",
        confidence: "HIGH",
        message: "CNPJ divergente em relação ao histórico.",
        evidence: {},
      },
    ],
  },
];

describe("ResultsExplorer", () => {
  it("renders the audit control room workspace landmarks", () => {
    render(<ResultsExplorer documents={sampleDocuments} session={sampleSession} />);

    expect(
      screen.getByRole("heading", {
        name: /abc12345/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/resumo do lote/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /resultados.*xlsx/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /auditoria.*xlsx/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/achados/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/documentos revisados/i)).toBeInTheDocument();
    expect(screen.getByText(/inspeção e evidências/i)).toBeInTheDocument();
  });

  it("filters by anomaly and updates the details panel when another row is selected", () => {
    render(<ResultsExplorer documents={sampleDocuments} session={sampleSession} />);

    fireEvent.click(screen.getByRole("button", { name: /cnpj divergente/i }));

    expect(screen.getAllByText("DOC_0002.txt")).toHaveLength(2);
    expect(screen.queryByText("DOC_0001.txt")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText("DOC_0002.txt")[0]!);

    expect(screen.getAllByText(/Office Prime/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/CNPJ divergente em relação ao histórico/i)).toBeInTheDocument();
    expect(screen.getByText(/gemini \+ parser/i)).toBeInTheDocument();
  });

  it("renders duplicate evidence with current record and reference record", () => {
    const duplicateDocuments: SessionDocumentView[] = [
      {
        ...sampleDocuments[0],
        anomalies: [
          {
            type: "DUPLICATE_DOCUMENT",
            severity: "high",
            confidence: "HIGH",
            message: "Número de documento duplicado para o mesmo fornecedor.",
            evidence: {
              supplierName: "TechSoft Ltda",
              documentNumber: "NF-1001",
              relatedHistoricalFiles: ["DOC_FRAUD_HISTORY.txt"],
              duplicateAgainstHistoricalReference: true,
            },
          },
        ],
      },
    ];

    render(<ResultsExplorer documents={duplicateDocuments} session={sampleSession} />);

    expect(screen.getByText(/registro atual: DOC_0001\.txt/i)).toBeInTheDocument();
    expect(
      screen.getByText(/referência histórica: DOC_FRAUD_HISTORY\.txt/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/critério usado: TechSoft Ltda \+ NF-1001/i)).toBeInTheDocument();
    expect(screen.getByText(/comparado com referência histórica: DOC_FRAUD_HISTORY\.txt/i)).toBeInTheDocument();
  });

  it("explains when the same record already existed in the historical reference", () => {
    const selfDuplicate: SessionDocumentView[] = [
      {
        ...sampleDocuments[0],
        anomalies: [
          {
            type: "DUPLICATE_DOCUMENT",
            severity: "high",
            confidence: "HIGH",
            message: "Número de documento duplicado para o mesmo fornecedor.",
            evidence: {
              supplierName: "TechSoft Ltda",
              documentNumber: "NF-1001",
              relatedHistoricalFiles: ["DOC_0001.txt"],
              duplicateAgainstHistoricalReference: true,
            },
          },
        ],
      },
    ];

    render(<ResultsExplorer documents={selfDuplicate} session={sampleSession} />);

    expect(
      screen.getByText(/registro atual já constava na referência histórica/i),
    ).toBeInTheDocument();
  });

  it("paginates the reviewed table for large document batches", () => {
    const manyDocuments: SessionDocumentView[] = Array.from({ length: 55 }, (_, index) => {
      const row = String(index + 1).padStart(4, "0");
      return {
        ...sampleDocuments[0],
        id: `doc-${row}`,
        fileName: `DOC_${row}.txt`,
        documentNumber: `NF-${1000 + index}`,
        anomalies: [],
      };
    });

    render(<ResultsExplorer documents={manyDocuments} session={sampleSession} />);

    const reviewTable = screen.getByRole("table", { name: /documentos revisados no lote/i });

    expect(within(reviewTable).getByText("DOC_0001.txt")).toBeInTheDocument();
    expect(within(reviewTable).queryByText("DOC_0055.txt")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /próxima página/i }));

    expect(within(reviewTable).getByText("DOC_0055.txt")).toBeInTheDocument();
    expect(within(reviewTable).queryByText("DOC_0001.txt")).not.toBeInTheDocument();
  });

  it("shows service description, model id, and fields not extracted in the inspection panel", () => {
    render(<ResultsExplorer documents={sampleDocuments} session={sampleSession} />);

    fireEvent.click(screen.getAllByText("DOC_0002.txt")[0]!);

    expect(screen.getByText(/manutenção predial/i)).toBeInTheDocument();
    expect(screen.getByText(/gemini-2\.5-flash-lite/i)).toBeInTheDocument();
    expect(screen.getByText(/HASH_VERIFICACAO/i)).toBeInTheDocument();
  });
});
