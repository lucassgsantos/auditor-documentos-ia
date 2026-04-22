export function validateUploadDocumentInput(input: {
  fileName: string;
  fileSize: number;
  maxUploadBytes: number;
}) {
  const fileName = input.fileName.trim();

  if (!isSafeFlatTxtName(fileName)) {
    throw new Error("Nome de arquivo inválido. Envie apenas arquivos .txt sem pastas no nome.");
  }

  if (!/\.txt$/i.test(fileName)) {
    throw new Error("Somente arquivos .txt são aceitos na ingestão de documentos.");
  }

  if (input.fileSize === 0) {
    throw new Error("Arquivo vazio. Envie um documento .txt com conteúdo.");
  }

  if (input.fileSize > input.maxUploadBytes) {
    throw new Error(`Arquivo acima do limite de ${input.maxUploadBytes} bytes.`);
  }
}

export function assertSessionFileLimit(input: {
  currentFiles: number;
  incomingFiles: number;
  maxSessionFiles: number;
}) {
  if (input.currentFiles + input.incomingFiles > input.maxSessionFiles) {
    throw new Error(`O lote excede o limite de ${input.maxSessionFiles} arquivos por lote.`);
  }
}

function isSafeFlatTxtName(fileName: string) {
  if (fileName.length === 0 || fileName.length > 255) {
    return false;
  }

  if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..")) {
    return false;
  }

  return !/[\u0000-\u001f\u007f]/.test(fileName);
}
