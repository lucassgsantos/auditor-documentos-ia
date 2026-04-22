const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const LATIN1_DECODER = new TextDecoder("latin1");

const REQUIRED_FIELDS = [
  "TIPO_DOCUMENTO",
  "NUMERO_DOCUMENTO",
  "DATA_EMISSAO",
  "FORNECEDOR",
  "CNPJ_FORNECEDOR",
  "DESCRICAO_SERVICO",
  "VALOR_BRUTO",
  "DATA_PAGAMENTO",
  "DATA_EMISSAO_NF",
  "APROVADO_POR",
  "BANCO_DESTINO",
  "STATUS",
  "HASH_VERIFICACAO",
] as const;

const KNOWN_STATUSES = new Set(["PAGO", "CANCELADO", "PENDENTE", "ESTORNADO"]);
const HASH_PATTERN = /^NLC[0-9A-Za-z-]+$/;

export type RequiredFieldName = (typeof REQUIRED_FIELDS)[number];

export type ParseWarningCode =
  | "ENCODING_FALLBACK"
  | "MISSING_REQUIRED_FIELDS"
  | "STATUS_UNRECOGNIZED"
  | "HASH_MALFORMED"
  | "INVALID_LINES_PRESENT";

export type ParsedDocumentStatus = "parsed" | "partial" | "unprocessable";

export interface ParsedUploadedDocument {
  fileName: string;
  encoding: "utf-8" | "latin1";
  rawText: string;
  normalizedText: string;
  fields: Record<string, string>;
  missingFields: RequiredFieldName[];
  notExtractedFields: RequiredFieldName[];
  invalidLines: string[];
  warningCodes: ParseWarningCode[];
  status: ParsedDocumentStatus;
  normalized: {
    documentType: string | null;
    documentNumber: string | null;
    serviceDescription: string | null;
    supplierName: string | null;
    supplierCnpjRaw: string | null;
    supplierCnpjNormalized: string | null;
    grossAmountRaw: string | null;
    grossAmount: number | null;
    issueDateIso: string | null;
    paymentDateIso: string | null;
    invoiceIssueDateIso: string | null;
    status: string | null;
    verificationHash: string | null;
    approvedBy: string | null;
    destinationBank: string | null;
    observation: string | null;
  };
}

export function parseUploadedDocument(
  fileName: string,
  bytes: Uint8Array,
): ParsedUploadedDocument {
  const utf8Attempt = tryDecodeUtf8(bytes);
  const encoding = utf8Attempt ? "utf-8" : "latin1";
  const rawText = utf8Attempt ?? LATIN1_DECODER.decode(bytes);
  const normalizedText = rawText.replace(/\r\n/g, "\n").trim();

  const lines = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const fields: Record<string, string> = {};
  const invalidLines: string[] = [];

  for (const line of lines) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      invalidLines.push(line);
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    fields[key] = value;
  }

  const missingFields = REQUIRED_FIELDS.filter((field) => !(field in fields));
  const warningCodes = new Set<ParseWarningCode>();

  if (encoding === "latin1") {
    warningCodes.add("ENCODING_FALLBACK");
  }

  if (missingFields.length > 0) {
    warningCodes.add("MISSING_REQUIRED_FIELDS");
  }

  if (invalidLines.length > 0) {
    warningCodes.add("INVALID_LINES_PRESENT");
  }

  if (fields.STATUS && !KNOWN_STATUSES.has(fields.STATUS)) {
    warningCodes.add("STATUS_UNRECOGNIZED");
  }

  if (fields.HASH_VERIFICACAO && !HASH_PATTERN.test(fields.HASH_VERIFICACAO)) {
    warningCodes.add("HASH_MALFORMED");
  }

  const normalized = {
    documentType: nullable(fields.TIPO_DOCUMENTO),
    documentNumber: nullable(fields.NUMERO_DOCUMENTO),
    serviceDescription: nullable(fields.DESCRICAO_SERVICO),
    supplierName: nullable(fields.FORNECEDOR),
    supplierCnpjRaw: nullable(fields.CNPJ_FORNECEDOR),
    supplierCnpjNormalized: normalizeCnpj(fields.CNPJ_FORNECEDOR),
    grossAmountRaw: nullable(fields.VALOR_BRUTO),
    grossAmount: parseBrazilianCurrency(fields.VALOR_BRUTO),
    issueDateIso: normalizeDate(fields.DATA_EMISSAO),
    paymentDateIso: normalizeDate(fields.DATA_PAGAMENTO),
    invoiceIssueDateIso: normalizeDate(fields.DATA_EMISSAO_NF),
    status: nullable(fields.STATUS),
    verificationHash: nullable(fields.HASH_VERIFICACAO),
    approvedBy: nullable(fields.APROVADO_POR),
    destinationBank: nullable(fields.BANCO_DESTINO),
    observation: nullable(fields.OBSERVACAO),
  };

  return {
    fileName,
    encoding,
    rawText,
    normalizedText,
    fields,
    notExtractedFields: deriveNotExtractedFields(normalized),
    invalidLines,
    missingFields,
    warningCodes: Array.from(warningCodes),
    status: deriveStatus(missingFields.length, invalidLines.length, warningCodes),
    normalized,
  };
}

export function deriveNotExtractedFields(
  normalized: ParsedUploadedDocument["normalized"],
): RequiredFieldName[] {
  const valuesByField: Record<RequiredFieldName, unknown> = {
    TIPO_DOCUMENTO: normalized.documentType,
    NUMERO_DOCUMENTO: normalized.documentNumber,
    DATA_EMISSAO: normalized.issueDateIso,
    FORNECEDOR: normalized.supplierName,
    CNPJ_FORNECEDOR: normalized.supplierCnpjNormalized,
    DESCRICAO_SERVICO: normalized.serviceDescription,
    VALOR_BRUTO: normalized.grossAmount,
    DATA_PAGAMENTO: normalized.paymentDateIso,
    DATA_EMISSAO_NF: normalized.invoiceIssueDateIso,
    APROVADO_POR: normalized.approvedBy,
    BANCO_DESTINO: normalized.destinationBank,
    STATUS: normalized.status,
    HASH_VERIFICACAO: normalized.verificationHash,
  };

  return REQUIRED_FIELDS.filter((field) => {
    const value = valuesByField[field];
    return value === null || value === undefined || value === "";
  });
}

function tryDecodeUtf8(bytes: Uint8Array) {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

function nullable(value?: string) {
  if (!value) {
    return null;
  }

  return value;
}

function normalizeCnpj(value?: string) {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}

function parseBrazilianCurrency(value?: string) {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace("R$", "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/\s+/g, "");
  const parsed = Number(normalized);

  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeDate(value?: string) {
  if (!value) {
    return null;
  }

  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) {
    return null;
  }

  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function deriveStatus(
  missingFieldCount: number,
  invalidLineCount: number,
  warningCodes: Set<ParseWarningCode>,
): ParsedDocumentStatus {
  if (missingFieldCount >= REQUIRED_FIELDS.length / 2 || invalidLineCount >= 3) {
    return "unprocessable";
  }

  if (warningCodes.size > 0) {
    return "partial";
  }

  return "parsed";
}
