import { notFound } from "next/navigation";

import { ResultsExplorer, type SessionDocumentView } from "@/components/results-explorer";
import { loadSession, loadSessionDocuments } from "@/lib/server/sessions";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await loadSession(id);

  if (!session) {
    notFound();
  }

  const documents = await loadSessionDocuments(id);
  const viewDocuments: SessionDocumentView[] = documents.map((record) => ({
    id: record.id,
    fileName: record.document.fileName,
    parseStatus: record.document.status,
    encoding: record.document.encoding,
    documentType: record.document.normalized.documentType ?? "",
    documentNumber: record.document.normalized.documentNumber ?? "",
    serviceDescription: record.document.normalized.serviceDescription ?? "",
    supplierName: record.document.normalized.supplierName ?? "",
    supplierCnpj: record.document.normalized.supplierCnpjNormalized ?? "",
    grossAmount: record.document.normalized.grossAmount,
    issueDateIso: record.document.normalized.issueDateIso,
    paymentDateIso: record.document.normalized.paymentDateIso,
    invoiceIssueDateIso: record.document.normalized.invoiceIssueDateIso,
    approvedBy: record.document.normalized.approvedBy,
    destinationBank: record.document.normalized.destinationBank,
    status: record.document.normalized.status,
    verificationHash: record.document.normalized.verificationHash,
    extractionMethod: record.extractionMethod,
    modelId: record.modelId,
    promptVersion: record.promptVersion,
    processedAt: record.processedAt,
    notExtractedFields: record.document.notExtractedFields,
    anomalies: record.anomalies,
  }));

  return (
    <main className="forensic-shell mx-auto min-h-screen w-full max-w-[1440px] px-4 pb-12 pt-8 sm:px-6 lg:px-8">
      <ResultsExplorer
        documents={viewDocuments}
        session={{
          id: session.id,
          status: session.status,
          processedFiles: session.processedFiles,
          totalFiles: session.totalFiles,
          anomalyCount: session.anomalyCount,
          startedAt: session.startedAt,
          finishedAt: session.finishedAt,
        }}
      />
    </main>
  );
}
