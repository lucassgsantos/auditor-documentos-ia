import type { ParsedUploadedDocument } from "@/lib/documents/parser";

export type AnomalyType =
  | "APPROVER_UNRECOGNIZED"
  | "BANK_ATYPICAL"
  | "CNPJ_CHECKSUM_INVALID"
  | "CNPJ_DIVERGENT"
  | "DOCUMENT_NUMBER_PREFIX_MISMATCH"
  | "DUPLICATE_DOCUMENT"
  | "FILE_UNPROCESSABLE"
  | "FILENAME_VERSIONED"
  | "HASH_MALFORMED"
  | "INVOICE_AFTER_PAYMENT"
  | "OBSERVATION_SUSPICIOUS"
  | "STATUS_INCONSISTENT"
  | "STATUS_MALFORMED"
  | "SUPPLIER_WITHOUT_HISTORY"
  | "VALUE_OUTLIER";

type EvidenceScalar = string | number | boolean | null;
export type EvidenceValue = EvidenceScalar | EvidenceScalar[];

export interface DocumentAnomaly {
  type: AnomalyType;
  ruleId: string;
  severity: "high" | "medium" | "low";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  message: string;
  evidence: Record<string, EvidenceValue>;
}

export interface SupplierReference {
  supplierName: string;
  canonicalCnpj: string | null;
  seenDocumentNumbers: Set<string>;
  knownBanks: Map<string, number>;
  historicalAmounts: number[];
  documentCount: number;
}

export interface ReferenceProfile {
  suppliers: Map<string, SupplierReference>;
  knownApprovers: Set<string>;
}

export interface DocumentAnalysis {
  fileName: string;
  anomalies: DocumentAnomaly[];
}

export interface AnalyzeDocumentsResult {
  profile: ReferenceProfile;
  documents: DocumentAnalysis[];
}

interface AnalyzeInput {
  historicalDocuments?: ParsedUploadedDocument[];
  currentDocuments: ParsedUploadedDocument[];
  referenceProfile?: ReferenceProfile;
}

const SUSPICIOUS_OBSERVATION_PATTERNS = [
  /reprocessamento/i,
  /revisado/i,
  /sem contrato/i,
  /na[oã]\s+deveria/i,
  /encerrado/i,
];

const DOCUMENT_PREFIX_BY_TYPE: Record<string, string> = {
  NOTA_FISCAL: "NF-",
  RECIBO: "RC-",
  FATURA: "FT-",
  BOLETO: "BL-",
  CONTRATO: "CT-",
};

export function buildReferenceProfile(
  documents: ParsedUploadedDocument[],
  options?: { minimumApproverOccurrences?: number },
): ReferenceProfile {
  const minimumApproverOccurrences = options?.minimumApproverOccurrences ?? 1;
  const supplierBuckets = new Map<
    string,
    {
      cnpjCounts: Map<string, number>;
      seenDocumentNumbers: Set<string>;
      bankCounts: Map<string, number>;
      historicalAmounts: number[];
      documentCount: number;
    }
  >();
  const approverCounts = new Map<string, number>();

  for (const document of documents) {
    const supplierName = document.normalized.supplierName;
    if (supplierName) {
      const bucket = supplierBuckets.get(supplierName) ?? {
        cnpjCounts: new Map<string, number>(),
        seenDocumentNumbers: new Set<string>(),
        bankCounts: new Map<string, number>(),
        historicalAmounts: [],
        documentCount: 0,
      };

      bucket.documentCount += 1;

      if (document.normalized.supplierCnpjNormalized) {
        incrementMap(bucket.cnpjCounts, document.normalized.supplierCnpjNormalized);
      }

      if (document.normalized.documentNumber) {
        bucket.seenDocumentNumbers.add(document.normalized.documentNumber);
      }

      if (document.normalized.destinationBank) {
        incrementMap(bucket.bankCounts, document.normalized.destinationBank);
      }

      if (typeof document.normalized.grossAmount === "number") {
        bucket.historicalAmounts.push(document.normalized.grossAmount);
      }

      supplierBuckets.set(supplierName, bucket);
    }

    if (document.normalized.approvedBy) {
      incrementMap(approverCounts, document.normalized.approvedBy);
    }
  }

  const suppliers = new Map<string, SupplierReference>();
  for (const [supplierName, bucket] of supplierBuckets) {
    suppliers.set(supplierName, {
      supplierName,
      canonicalCnpj: pickMostFrequentValue(bucket.cnpjCounts),
      seenDocumentNumbers: bucket.seenDocumentNumbers,
      knownBanks: bucket.bankCounts,
      historicalAmounts: bucket.historicalAmounts,
      documentCount: bucket.documentCount,
    });
  }

  const knownApprovers = new Set(
    Array.from(approverCounts.entries())
      .filter(([, count]) => count >= minimumApproverOccurrences)
      .map(([name]) => name),
  );

  return {
    suppliers,
    knownApprovers,
  };
}

export function analyzeDocuments({
  historicalDocuments = [],
  currentDocuments,
  referenceProfile,
}: AnalyzeInput): AnalyzeDocumentsResult {
  const profile =
    referenceProfile ??
    (historicalDocuments.length > 0
      ? buildReferenceProfile(historicalDocuments)
      : buildReferenceProfile(currentDocuments, { minimumApproverOccurrences: 2 }));

  const currentSupplierCounts = new Map<string, number>();
  const duplicateKeys = new Map<string, number>();
  const currentDuplicateFiles = new Map<string, string[]>();
  const historicalDuplicateFiles = new Map<
    string,
    Array<{ fileName: string; verificationHash: string | null }>
  >();

  for (const document of historicalDocuments) {
    const duplicateKey = buildDuplicateKey(document);
    if (!duplicateKey) {
      continue;
    }

    const entries = historicalDuplicateFiles.get(duplicateKey) ?? [];
    entries.push({
      fileName: document.fileName,
      verificationHash: document.normalized.verificationHash ?? null,
    });
    historicalDuplicateFiles.set(duplicateKey, entries);
  }

  for (const document of currentDocuments) {
    if (document.normalized.supplierName) {
      incrementMap(currentSupplierCounts, document.normalized.supplierName);
    }

    const duplicateKey = buildDuplicateKey(document);
    if (duplicateKey) {
      incrementMap(duplicateKeys, duplicateKey);
      const currentFiles = currentDuplicateFiles.get(duplicateKey) ?? [];
      currentFiles.push(document.fileName);
      currentDuplicateFiles.set(duplicateKey, currentFiles);
    }
  }

  const documents = currentDocuments.map((document) => {
    const anomalies: DocumentAnomaly[] = [];
    const supplierName = document.normalized.supplierName;
    const documentNumber = document.normalized.documentNumber;
    const supplierProfile = supplierName ? profile.suppliers.get(supplierName) : undefined;

    if (document.status !== "parsed") {
      anomalies.push({
        type: "FILE_UNPROCESSABLE",
        ruleId: "file-unprocessable",
        severity: "medium",
        confidence: "HIGH",
        message: "Arquivo com falha parcial ou estrutural no parsing.",
        evidence: {
          status: document.status,
          missingFieldCount: document.missingFields.length,
          warningCount: document.warningCodes.length,
        },
      });
    }

    if (supplierName && documentNumber) {
      const duplicateKey = `${supplierName}::${documentNumber}`;
      const currentVerificationHash = document.normalized.verificationHash ?? null;
      const relatedCurrentFiles =
        (currentDuplicateFiles.get(duplicateKey) ?? []).filter((fileName) => fileName !== document.fileName);
      const historicalEntries = historicalDuplicateFiles.get(duplicateKey) ?? [];
      const filteredHistoricalEntries = historicalEntries.filter(
        (entry) =>
          !(entry.fileName === document.fileName && entry.verificationHash === currentVerificationHash),
      );
      const relatedHistoricalFiles = filteredHistoricalEntries.map((entry) => entry.fileName);
      const hasCurrentDuplicate = relatedCurrentFiles.length > 0;
      const hasHistoricalDuplicate = relatedHistoricalFiles.length > 0;
      if (hasCurrentDuplicate || hasHistoricalDuplicate) {
        anomalies.push({
          type: "DUPLICATE_DOCUMENT",
          ruleId: "duplicate-document-number",
          severity: "high",
          confidence: "HIGH",
          message: "Número de documento duplicado para o mesmo fornecedor.",
          evidence: {
            supplierName,
            documentNumber,
            seenHistorically: hasHistoricalDuplicate,
            duplicateInCurrentSession: hasCurrentDuplicate,
            duplicateAgainstHistoricalReference: hasHistoricalDuplicate,
            relatedCurrentFiles,
            relatedHistoricalFiles,
            relatedCurrentCount: relatedCurrentFiles.length,
            relatedHistoricalCount: relatedHistoricalFiles.length,
          },
        });
      }
    }

    const expectedDocumentPrefix = getExpectedDocumentPrefix(
      document.normalized.documentType,
    );
    if (
      expectedDocumentPrefix &&
      document.normalized.documentNumber &&
      !document.normalized.documentNumber.startsWith(expectedDocumentPrefix)
    ) {
      anomalies.push({
        type: "DOCUMENT_NUMBER_PREFIX_MISMATCH",
        ruleId: "document-number-prefix-mismatch",
        severity: "low",
        confidence: "HIGH",
        message: "Prefixo do número do documento não corresponde ao tipo informado.",
        evidence: {
          documentType: document.normalized.documentType,
          documentNumber: document.normalized.documentNumber,
          expectedPrefix: expectedDocumentPrefix,
        },
      });
    }

    if (supplierName) {
      const supplierSeenOnlyHere = historicalDocuments.length === 0
        ? (currentSupplierCounts.get(supplierName) ?? 0) === 1
        : !profile.suppliers.has(supplierName);

      if (supplierSeenOnlyHere) {
        anomalies.push({
          type: "SUPPLIER_WITHOUT_HISTORY",
          ruleId: "supplier-without-history",
          severity: "high",
          confidence: "HIGH",
          message: "Fornecedor sem histórico conhecido.",
          evidence: {
            supplierName,
          },
        });
      }
    }

    if (
      document.normalized.supplierCnpjNormalized &&
      !isValidCnpj(document.normalized.supplierCnpjNormalized)
    ) {
      anomalies.push({
        type: "CNPJ_CHECKSUM_INVALID",
        ruleId: "supplier-cnpj-checksum-invalid",
        severity: "high",
        confidence: "HIGH",
        message: "CNPJ do fornecedor possui digitos verificadores invalidos.",
        evidence: {
          supplierName,
          supplierCnpj: document.normalized.supplierCnpjNormalized,
        },
      });
    }

    if (
      supplierProfile?.canonicalCnpj &&
      document.normalized.supplierCnpjNormalized &&
      document.normalized.supplierCnpjNormalized !== supplierProfile.canonicalCnpj
    ) {
      anomalies.push({
        type: "CNPJ_DIVERGENT",
        ruleId: "supplier-cnpj-divergent",
        severity: "high",
        confidence: "HIGH",
        message: "CNPJ do documento diverge do padrão histórico do fornecedor.",
        evidence: {
          supplierName,
          canonicalCnpj: supplierProfile.canonicalCnpj,
          currentCnpj: document.normalized.supplierCnpjNormalized,
        },
      });
    }

    if (
      document.normalized.invoiceIssueDateIso &&
      document.normalized.paymentDateIso &&
      document.normalized.invoiceIssueDateIso > document.normalized.paymentDateIso
    ) {
      anomalies.push({
        type: "INVOICE_AFTER_PAYMENT",
        ruleId: "invoice-issued-after-payment",
        severity: "high",
        confidence: "HIGH",
        message: "Data de emissão da NF é posterior ao pagamento.",
        evidence: {
          invoiceIssueDateIso: document.normalized.invoiceIssueDateIso,
          paymentDateIso: document.normalized.paymentDateIso,
        },
      });
    }

    if (
      document.normalized.approvedBy &&
      profile.knownApprovers.size > 0 &&
      !profile.knownApprovers.has(document.normalized.approvedBy)
    ) {
      anomalies.push({
        type: "APPROVER_UNRECOGNIZED",
        ruleId: "approver-unrecognized",
        severity: "medium",
        confidence: "HIGH",
        message: "Aprovador fora da lista conhecida.",
        evidence: {
          approvedBy: document.normalized.approvedBy,
        },
      });
    }

    if (
      document.normalized.status === "CANCELADO" &&
      document.normalized.paymentDateIso
    ) {
      anomalies.push({
        type: "STATUS_INCONSISTENT",
        ruleId: "status-inconsistent",
        severity: "medium",
        confidence: "HIGH",
        message: "Documento cancelado com pagamento preenchido.",
        evidence: {
          status: document.normalized.status,
          paymentDateIso: document.normalized.paymentDateIso,
        },
      });
    }

    if (document.warningCodes.includes("STATUS_UNRECOGNIZED")) {
      anomalies.push({
        type: "STATUS_MALFORMED",
        ruleId: "status-malformed",
        severity: "low",
        confidence: "HIGH",
        message: "Campo STATUS fora do domínio conhecido.",
        evidence: {
          status: document.normalized.status,
        },
      });
    }

    if (document.warningCodes.includes("HASH_MALFORMED")) {
      anomalies.push({
        type: "HASH_MALFORMED",
        ruleId: "hash-malformed",
        severity: "low",
        confidence: "HIGH",
        message: "Hash de verificação em formato inesperado.",
        evidence: {
          verificationHash: document.normalized.verificationHash,
        },
      });
    }

    if (/_v\d+/i.test(document.fileName)) {
      anomalies.push({
        type: "FILENAME_VERSIONED",
        ruleId: "filename-versioned",
        severity: "low",
        confidence: "HIGH",
        message: "Nome de arquivo sugere reprocessamento ou revisão.",
        evidence: {
          fileName: document.fileName,
        },
      });
    }

    if (
      document.normalized.observation &&
      SUSPICIOUS_OBSERVATION_PATTERNS.some((pattern) =>
        pattern.test(document.normalized.observation ?? ""),
      )
    ) {
      anomalies.push({
        type: "OBSERVATION_SUSPICIOUS",
        ruleId: "observation-suspicious",
        severity: "low",
        confidence: "MEDIUM",
        message: "Campo OBSERVACAO contém indícios de irregularidade ou reprocessamento.",
        evidence: {
          observation: document.normalized.observation,
        },
      });
    }

    if (
      supplierProfile &&
      typeof document.normalized.grossAmount === "number" &&
      supplierProfile.historicalAmounts.length >= 4
    ) {
      const outlierResult = detectValueOutlier(
        document.normalized.grossAmount,
        supplierProfile.historicalAmounts,
      );
      if (outlierResult) {
        anomalies.push({
          type: "VALUE_OUTLIER",
          ruleId: "supplier-value-outlier",
          severity: "medium",
          confidence: outlierResult.confidence,
          message: "Valor fora da faixa histórica do fornecedor.",
          evidence: {
            supplierName,
            grossAmount: document.normalized.grossAmount,
            method: outlierResult.method,
            lowerBound: outlierResult.lowerBound,
            upperBound: outlierResult.upperBound,
            zScore: outlierResult.zScore,
            historicalMedian: outlierResult.median,
            historicalSize: supplierProfile.historicalAmounts.length,
          },
        });
      }
    }

    if (
      supplierProfile &&
      document.normalized.destinationBank &&
      anomalies.length > 0 &&
      !supplierProfile.knownBanks.has(document.normalized.destinationBank)
    ) {
      anomalies.push({
        type: "BANK_ATYPICAL",
        ruleId: "bank-atypical-for-supplier",
        severity: "low",
        confidence: "LOW",
        message: "Banco de destino atípico para o fornecedor.",
        evidence: {
          supplierName,
          destinationBank: document.normalized.destinationBank,
        },
      });
    }

    return {
      fileName: document.fileName,
      anomalies,
    };
  });

  return {
    profile,
    documents,
  };
}

function incrementMap(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function pickMostFrequentValue(map: Map<string, number>) {
  let winner: string | null = null;
  let winnerCount = -1;

  for (const [value, count] of map.entries()) {
    if (count > winnerCount) {
      winner = value;
      winnerCount = count;
    }
  }

  return winner;
}

function buildDuplicateKey(document: ParsedUploadedDocument) {
  if (!document.normalized.supplierName || !document.normalized.documentNumber) {
    return null;
  }

  return `${document.normalized.supplierName}::${document.normalized.documentNumber}`;
}

function getExpectedDocumentPrefix(documentType: string | null) {
  if (!documentType) {
    return null;
  }

  return DOCUMENT_PREFIX_BY_TYPE[documentType.trim().toUpperCase()] ?? null;
}

interface ValueOutlierSignal {
  method: "iqr" | "zscore";
  confidence: "HIGH" | "MEDIUM" | "LOW";
  lowerBound: number;
  upperBound: number;
  zScore: number;
  median: number;
}

function detectValueOutlier(
  value: number,
  historicalAmounts: number[],
): ValueOutlierSignal | null {
  const sorted = [...historicalAmounts].sort((left, right) => left - right);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerBound = q1 - iqr * 1.5;
  const upperBound = q3 + iqr * 1.5;
  const mean = sorted.reduce((sum, item) => sum + item, 0) / sorted.length;
  const variance =
    sorted.reduce((sum, item) => sum + (item - mean) ** 2, 0) / sorted.length;
  const stdev = Math.sqrt(variance);
  const zScore = stdev > 0 ? (value - mean) / stdev : 0;
  const median = quantile(sorted, 0.5);

  const iqrHit = value < lowerBound || value > upperBound;
  const zScoreHit = Math.abs(zScore) >= 2;

  if (!iqrHit && !zScoreHit) {
    return null;
  }

  return {
    method: iqrHit ? "iqr" : "zscore",
    confidence: iqrHit && zScoreHit ? "HIGH" : iqrHit ? "MEDIUM" : "LOW",
    lowerBound,
    upperBound,
    zScore,
    median,
  };
}

function quantile(sortedValues: number[], percentile: number) {
  if (sortedValues.length === 1) {
    return sortedValues[0] ?? 0;
  }

  const position = (sortedValues.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lowerValue = sortedValues[lowerIndex] ?? 0;
  const upperValue = sortedValues[upperIndex] ?? 0;

  if (lowerIndex === upperIndex) {
    return lowerValue;
  }

  return lowerValue + (upperValue - lowerValue) * (position - lowerIndex);
}

function isValidCnpj(cnpj: string) {
  if (!/^\d{14}$/.test(cnpj)) {
    return false;
  }

  if (/^(\d)\1{13}$/.test(cnpj)) {
    return false;
  }

  const digits = cnpj.split("").map((digit) => Number(digit));

  const firstVerifier = calculateCnpjVerifier(digits.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondVerifier = calculateCnpjVerifier(
    [...digits.slice(0, 12), firstVerifier],
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2],
  );

  return firstVerifier === digits[12] && secondVerifier === digits[13];
}

function calculateCnpjVerifier(baseDigits: number[], weights: number[]) {
  const sum = baseDigits.reduce(
    (accumulator, digit, index) => accumulator + digit * (weights[index] ?? 0),
    0,
  );
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}
