import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { zipSync, strToU8 } from "fflate";

/**
 * Builds a Power BI Template (.pbit) file.
 *
 * The .pbit format is an undocumented zip archive. The structure below is based on
 * reverse engineering of files produced by Power BI Desktop. Inside the archive,
 * most text files must be encoded as UTF-16 LE with a byte-order mark (0xFEFF),
 * while a couple of XML files remain UTF-8.
 *
 * This template wires two tables (Results and Audit) to local .xlsx files via a
 * Power BI parameter (SourceFolder), defines relationships between them, adds
 * DAX measures, and ships an empty report page so users can drag the fields
 * onto the canvas and publish the report.
 */

const TEMPLATE_VERSION = "3.0";

function utf16LeWithBom(value: string): Uint8Array {
  const buffer = new Uint8Array(2 + value.length * 2);
  buffer[0] = 0xff;
  buffer[1] = 0xfe;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    buffer[2 + index * 2] = codeUnit & 0xff;
    buffer[2 + index * 2 + 1] = (codeUnit >> 8) & 0xff;
  }
  return buffer;
}

function contentTypesXml(): Uint8Array {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="json" ContentType="" />` +
    `<Default Extension="xml" ContentType="application/xml" />` +
    `<Override PartName="/Version" ContentType="" />` +
    `<Override PartName="/DataModelSchema" ContentType="" />` +
    `<Override PartName="/DiagramLayout" ContentType="" />` +
    `<Override PartName="/Report/Layout" ContentType="" />` +
    `<Override PartName="/Settings" ContentType="" />` +
    `<Override PartName="/Metadata" ContentType="" />` +
    `</Types>`;
  return strToU8(xml);
}

function securityBindingsXml(): Uint8Array {
  const xml = `<?xml version="1.0" encoding="utf-8"?>\n<SecurityBindings />`;
  return strToU8(xml);
}

interface ColumnDef {
  name: string;
  dataType: "string" | "int64" | "double" | "dateTime" | "boolean";
  format?: string;
  sourceColumn?: string;
  isHidden?: boolean;
}

const resultsColumns: ColumnDef[] = [
  { name: "fileName", dataType: "string" },
  { name: "processingStatus", dataType: "string" },
  { name: "encoding", dataType: "string" },
  { name: "documentType", dataType: "string" },
  { name: "documentNumber", dataType: "string" },
  { name: "serviceDescription", dataType: "string" },
  { name: "supplierName", dataType: "string" },
  { name: "supplierCnpj", dataType: "string" },
  { name: "grossAmount", dataType: "double", format: "\\R\\$ #,0.00;-\\R\\$ #,0.00;\\R\\$ #,0.00" },
  { name: "issueDateIso", dataType: "dateTime", format: "yyyy-mm-dd" },
  { name: "paymentDateIso", dataType: "dateTime", format: "yyyy-mm-dd" },
  { name: "invoiceIssueDateIso", dataType: "dateTime", format: "yyyy-mm-dd" },
  { name: "approvedBy", dataType: "string" },
  { name: "destinationBank", dataType: "string" },
  { name: "status", dataType: "string" },
  { name: "verificationHash", dataType: "string" },
  { name: "anomalyCount", dataType: "int64", format: "0" },
  { name: "anomalyTypes", dataType: "string" },
  { name: "highestSeverity", dataType: "string" },
  { name: "notExtractedFields", dataType: "string" },
  { name: "promptVersion", dataType: "string" },
  { name: "extractionMethod", dataType: "string" },
  { name: "modelId", dataType: "string" },
  { name: "processedAt", dataType: "dateTime", format: "yyyy-mm-dd hh:mm:ss" },
];

const anomalySummaryColumns: ColumnDef[] = [
  { name: "anomalyType", dataType: "string" },
  { name: "count", dataType: "int64", format: "0" },
  { name: "highestSeverity", dataType: "string" },
  { name: "exampleFiles", dataType: "string" },
];

const auditColumns: ColumnDef[] = [
  { name: "eventType", dataType: "string" },
  { name: "fileName", dataType: "string" },
  { name: "processedAt", dataType: "dateTime", format: "yyyy-mm-dd hh:mm:ss" },
  { name: "outcome", dataType: "string" },
  { name: "ruleId", dataType: "string" },
  { name: "anomalyType", dataType: "string" },
  { name: "confidence", dataType: "string" },
  { name: "severity", dataType: "string" },
  { name: "evidenceJson", dataType: "string" },
  { name: "promptVersion", dataType: "string" },
  { name: "extractionMethod", dataType: "string" },
  { name: "modelId", dataType: "string" },
];

interface MeasureDef {
  name: string;
  expression: string;
  formatString?: string;
  description?: string;
}

const measures: MeasureDef[] = [
  {
    name: "Total Arquivos",
    expression: "DISTINCTCOUNT(Results[fileName])",
    formatString: "0",
    description: "Quantidade de arquivos únicos analisados.",
  },
  {
    name: "Total Anomalias",
    expression: "SUM(Results[anomalyCount])",
    formatString: "0",
    description: "Soma de anomalias detectadas em todos os documentos.",
  },
  {
    name: "Arquivos Parciais",
    expression:
      "CALCULATE(DISTINCTCOUNT(Results[fileName]), Results[processingStatus] <> \"parsed\")",
    formatString: "0",
    description: "Documentos que não foram integralmente extraídos.",
  },
  {
    name: "Arquivos Com Anomalia",
    expression:
      "CALCULATE(DISTINCTCOUNT(Results[fileName]), Results[anomalyCount] > 0)",
    formatString: "0",
    description: "Documentos que dispararam pelo menos uma regra.",
  },
  {
    name: "% Arquivos Com Anomalia",
    expression:
      "DIVIDE([Arquivos Com Anomalia], [Total Arquivos])",
    formatString: "0.00%",
  },
  {
    name: "Anomalias Alta Severidade",
    expression:
      "CALCULATE(COUNTROWS(Audit), Audit[eventType] = \"ANOMALY_RULE\", Audit[severity] = \"high\")",
    formatString: "0",
  },
  {
    name: "Anomalias Média Severidade",
    expression:
      "CALCULATE(COUNTROWS(Audit), Audit[eventType] = \"ANOMALY_RULE\", Audit[severity] = \"medium\")",
    formatString: "0",
  },
  {
    name: "Anomalias Baixa Severidade",
    expression:
      "CALCULATE(COUNTROWS(Audit), Audit[eventType] = \"ANOMALY_RULE\", Audit[severity] = \"low\")",
    formatString: "0",
  },
  {
    name: "Valor Total Analisado",
    expression: "SUM(Results[grossAmount])",
    formatString: "\\R\\$ #,0.00;-\\R\\$ #,0.00;\\R\\$ #,0.00",
  },
  {
    name: "Valor Médio por Documento",
    expression: "AVERAGE(Results[grossAmount])",
    formatString: "\\R\\$ #,0.00;-\\R\\$ #,0.00;\\R\\$ #,0.00",
  },
];

function buildResultsExpression(): string {
  return [
    "let",
    "    Source = Excel.Workbook(File.Contents(SourceFolder & \"\\results.xlsx\"), null, true),",
    "    ResultsSheet = Source{[Item=\"results\",Kind=\"Sheet\"]}[Data],",
    "    Promoted = Table.PromoteHeaders(ResultsSheet, [PromoteAllScalars=true]),",
    "    Typed = Table.TransformColumnTypes(Promoted, {",
    "        {\"Nome do Arquivo\", type text},",
    "        {\"Status de Processamento\", type text},",
    "        {\"Codificação\", type text},",
    "        {\"Tipo de Documento\", type text},",
    "        {\"Número do Documento\", type text},",
    "        {\"Descrição do Serviço\", type text},",
    "        {\"Fornecedor\", type text},",
    "        {\"CNPJ Fornecedor\", type text},",
    "        {\"Valor Bruto (R$)\", type number},",
    "        {\"Data de Emissão\", type date},",
    "        {\"Data de Pagamento\", type date},",
    "        {\"Data de Emissão NF\", type date},",
    "        {\"Aprovado Por\", type text},",
    "        {\"Banco de Destino\", type text},",
    "        {\"Status Documento\", type text},",
    "        {\"Hash de Verificação\", type text},",
    "        {\"Qtd. Anomalias\", Int64.Type},",
    "        {\"Tipos de Anomalia\", type text},",
    "        {\"Severidade Máxima\", type text},",
    "        {\"Campos Não Extraídos\", type text},",
    "        {\"Versão do Prompt\", type text},",
    "        {\"Método de Extração\", type text},",
    "        {\"Modelo de IA\", type text},",
    "        {\"Processado Em\", type datetime}",
    "    }),",
    "    Renamed = Table.RenameColumns(Typed, {",
    "        {\"Nome do Arquivo\", \"fileName\"},",
    "        {\"Status de Processamento\", \"processingStatus\"},",
    "        {\"Codificação\", \"encoding\"},",
    "        {\"Tipo de Documento\", \"documentType\"},",
    "        {\"Número do Documento\", \"documentNumber\"},",
    "        {\"Descrição do Serviço\", \"serviceDescription\"},",
    "        {\"Fornecedor\", \"supplierName\"},",
    "        {\"CNPJ Fornecedor\", \"supplierCnpj\"},",
    "        {\"Valor Bruto (R$)\", \"grossAmount\"},",
    "        {\"Data de Emissão\", \"issueDateIso\"},",
    "        {\"Data de Pagamento\", \"paymentDateIso\"},",
    "        {\"Data de Emissão NF\", \"invoiceIssueDateIso\"},",
    "        {\"Aprovado Por\", \"approvedBy\"},",
    "        {\"Banco de Destino\", \"destinationBank\"},",
    "        {\"Status Documento\", \"status\"},",
    "        {\"Hash de Verificação\", \"verificationHash\"},",
    "        {\"Qtd. Anomalias\", \"anomalyCount\"},",
    "        {\"Tipos de Anomalia\", \"anomalyTypes\"},",
    "        {\"Severidade Máxima\", \"highestSeverity\"},",
    "        {\"Campos Não Extraídos\", \"notExtractedFields\"},",
    "        {\"Versão do Prompt\", \"promptVersion\"},",
    "        {\"Método de Extração\", \"extractionMethod\"},",
    "        {\"Modelo de IA\", \"modelId\"},",
    "        {\"Processado Em\", \"processedAt\"}",
    "    })",
    "in",
    "    Renamed",
  ].join("\n");
}

function buildAnomalySummaryExpression(): string {
  return [
    "let",
    "    Source = Excel.Workbook(File.Contents(SourceFolder & \"\\results.xlsx\"), null, true),",
    "    Sheet = Source{[Item=\"anomaly_summary\",Kind=\"Sheet\"]}[Data],",
    "    Promoted = Table.PromoteHeaders(Sheet, [PromoteAllScalars=true]),",
    "    Typed = Table.TransformColumnTypes(Promoted, {",
    "        {\"Tipo de Anomalia\", type text},",
    "        {\"Quantidade\", Int64.Type},",
    "        {\"Severidade Máxima\", type text},",
    "        {\"Arquivos de Exemplo\", type text}",
    "    }),",
    "    Renamed = Table.RenameColumns(Typed, {",
    "        {\"Tipo de Anomalia\", \"anomalyType\"},",
    "        {\"Quantidade\", \"count\"},",
    "        {\"Severidade Máxima\", \"highestSeverity\"},",
    "        {\"Arquivos de Exemplo\", \"exampleFiles\"}",
    "    })",
    "in",
    "    Renamed",
  ].join("\n");
}

function buildAuditExpression(): string {
  return [
    "let",
    "    Source = Excel.Workbook(File.Contents(SourceFolder & \"\\audit.xlsx\"), null, true),",
    "    Sheet = Source{[Item=\"audit\",Kind=\"Sheet\"]}[Data],",
    "    Promoted = Table.PromoteHeaders(Sheet, [PromoteAllScalars=true]),",
    "    Typed = Table.TransformColumnTypes(Promoted, {",
    "        {\"Tipo de Evento\", type text},",
    "        {\"Nome do Arquivo\", type text},",
    "        {\"Processado Em\", type datetime},",
    "        {\"Resultado\", type text},",
    "        {\"ID da Regra\", type text},",
    "        {\"Tipo de Anomalia\", type text},",
    "        {\"Confiança\", type text},",
    "        {\"Severidade\", type text},",
    "        {\"Evidência (JSON)\", type text},",
    "        {\"Versão do Prompt\", type text},",
    "        {\"Método de Extração\", type text},",
    "        {\"Modelo de IA\", type text}",
    "    }),",
    "    Renamed = Table.RenameColumns(Typed, {",
    "        {\"Tipo de Evento\", \"eventType\"},",
    "        {\"Nome do Arquivo\", \"fileName\"},",
    "        {\"Processado Em\", \"processedAt\"},",
    "        {\"Resultado\", \"outcome\"},",
    "        {\"ID da Regra\", \"ruleId\"},",
    "        {\"Tipo de Anomalia\", \"anomalyType\"},",
    "        {\"Confiança\", \"confidence\"},",
    "        {\"Severidade\", \"severity\"},",
    "        {\"Evidência (JSON)\", \"evidenceJson\"},",
    "        {\"Versão do Prompt\", \"promptVersion\"},",
    "        {\"Método de Extração\", \"extractionMethod\"},",
    "        {\"Modelo de IA\", \"modelId\"}",
    "    })",
    "in",
    "    Renamed",
  ].join("\n");
}

function buildSourceFolderExpression(): string {
  return "\"C:\\\\power-bi-auditor\" meta [IsParameterQuery=true, Type=\"Text\", IsParameterQueryRequired=true]";
}

function columnToTmsl(column: ColumnDef) {
  const entry: Record<string, unknown> = {
    name: column.name,
    dataType: column.dataType,
    sourceColumn: column.sourceColumn ?? column.name,
    summarizeBy: column.dataType === "double" || column.dataType === "int64" ? "sum" : "none",
  };
  if (column.format) {
    entry.formatString = column.format;
  }
  if (column.isHidden) {
    entry.isHidden = true;
  }
  return entry;
}

function buildDataModelSchema(): string {
  const model = {
    name: "SemanticModel",
    compatibilityLevel: 1520,
    model: {
      culture: "pt-BR",
      dataAccessOptions: {
        legacyRedirects: true,
        returnErrorValuesAsNull: true,
      },
      defaultPowerBIDataSourceVersion: "powerBI_V3",
      sourceQueryCulture: "pt-BR",
      expressions: [
        {
          name: "SourceFolder",
          kind: "m",
          expression: buildSourceFolderExpression(),
          annotations: [
            { name: "PBI_ResultType", value: "Text" },
          ],
        },
      ],
      tables: [
        {
          name: "Results",
          columns: resultsColumns.map(columnToTmsl),
          partitions: [
            {
              name: "Results-Partition",
              mode: "import",
              source: {
                type: "m",
                expression: buildResultsExpression(),
              },
            },
          ],
          measures: measures.map((measure) => {
            const entry: Record<string, unknown> = {
              name: measure.name,
              expression: measure.expression,
            };
            if (measure.formatString) {
              entry.formatString = measure.formatString;
            }
            if (measure.description) {
              entry.description = measure.description;
            }
            return entry;
          }),
          annotations: [
            { name: "PBI_ResultType", value: "Table" },
          ],
        },
        {
          name: "AnomalySummary",
          columns: anomalySummaryColumns.map(columnToTmsl),
          partitions: [
            {
              name: "AnomalySummary-Partition",
              mode: "import",
              source: {
                type: "m",
                expression: buildAnomalySummaryExpression(),
              },
            },
          ],
          annotations: [
            { name: "PBI_ResultType", value: "Table" },
          ],
        },
        {
          name: "Audit",
          columns: auditColumns.map(columnToTmsl),
          partitions: [
            {
              name: "Audit-Partition",
              mode: "import",
              source: {
                type: "m",
                expression: buildAuditExpression(),
              },
            },
          ],
          annotations: [
            { name: "PBI_ResultType", value: "Table" },
          ],
        },
      ],
      relationships: [
        {
          name: "rel_audit_results",
          fromTable: "Audit",
          fromColumn: "fileName",
          toTable: "Results",
          toColumn: "fileName",
          crossFilteringBehavior: "automatic",
        },
      ],
      annotations: [
        {
          name: "PBI_QueryOrder",
          value: "[\"SourceFolder\",\"Results\",\"AnomalySummary\",\"Audit\"]",
        },
        { name: "__PBI_TimeIntelligenceEnabled", value: "1" },
      ],
    },
  };
  return JSON.stringify(model);
}

interface VisualContainer {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  config: Record<string, unknown>;
}

function section(visuals: VisualContainer[]) {
  return {
    name: "ReportSection1",
    displayName: "Visão Geral",
    filters: "[]",
    ordinal: 0,
    visualContainers: visuals.map((visual, index) => ({
      x: visual.x,
      y: visual.y,
      z: visual.z ?? index * 1000,
      width: visual.width,
      height: visual.height,
      config: JSON.stringify(visual.config),
      filters: "[]",
    })),
    width: 1280,
    height: 720,
    displayOption: 1,
    config: JSON.stringify({
      visibility: 0,
    }),
  };
}

function textVisual(
  name: string,
  title: string,
  body: string,
  x: number,
  y: number,
  width: number,
  height: number,
): VisualContainer {
  return {
    x,
    y,
    z: 0,
    width,
    height,
    config: {
      name,
      layouts: [{ id: 0, position: { x, y, z: 0, width, height } }],
      singleVisual: {
        visualType: "textbox",
        drillFilterOtherVisuals: true,
        objects: {
          general: [
            {
              properties: {
                paragraphs: [
                  {
                    textRuns: [
                      {
                        value: title + "\n",
                        textStyle: { fontSize: "20pt", fontWeight: "bold" },
                      },
                    ],
                  },
                  {
                    textRuns: [{ value: body, textStyle: { fontSize: "11pt" } }],
                  },
                ],
              },
            },
          ],
        },
      },
    },
  };
}

function cardVisual(
  name: string,
  measureName: string,
  x: number,
  y: number,
): VisualContainer {
  return {
    x,
    y,
    z: 0,
    width: 260,
    height: 140,
    config: {
      name,
      layouts: [{ id: 0, position: { x, y, z: 0, width: 260, height: 140 } }],
      singleVisual: {
        visualType: "card",
        projections: {
          Values: [
            {
              queryRef: `Results.${measureName}`,
              active: true,
            },
          ],
        },
        prototypeQuery: {
          Version: 2,
          From: [{ Name: "r", Entity: "Results", Type: 0 }],
          Select: [
            {
              Measure: {
                Expression: { SourceRef: { Source: "r" } },
                Property: measureName,
              },
              Name: `Results.${measureName}`,
            },
          ],
        },
        drillFilterOtherVisuals: true,
      },
    },
  };
}

function barByAnomalyTypeVisual(x: number, y: number): VisualContainer {
  return {
    x,
    y,
    z: 0,
    width: 560,
    height: 380,
    config: {
      name: "barByAnomalyType",
      layouts: [{ id: 0, position: { x, y, z: 0, width: 560, height: 380 } }],
      singleVisual: {
        visualType: "barChart",
        projections: {
          Category: [{ queryRef: "AnomalySummary.anomalyType", active: true }],
          Y: [{ queryRef: "AnomalySummary.count", active: true }],
        },
        prototypeQuery: {
          Version: 2,
          From: [{ Name: "a", Entity: "AnomalySummary", Type: 0 }],
          Select: [
            {
              Column: {
                Expression: { SourceRef: { Source: "a" } },
                Property: "anomalyType",
              },
              Name: "AnomalySummary.anomalyType",
            },
            {
              Aggregation: {
                Expression: {
                  Column: {
                    Expression: { SourceRef: { Source: "a" } },
                    Property: "count",
                  },
                },
                Function: 0,
              },
              Name: "Sum(AnomalySummary.count)",
            },
          ],
          OrderBy: [
            {
              Direction: 2,
              Expression: {
                Aggregation: {
                  Expression: {
                    Column: {
                      Expression: { SourceRef: { Source: "a" } },
                      Property: "count",
                    },
                  },
                  Function: 0,
                },
              },
            },
          ],
        },
        drillFilterOtherVisuals: true,
      },
    },
  };
}

function barBySupplierVisual(x: number, y: number): VisualContainer {
  return {
    x,
    y,
    z: 0,
    width: 560,
    height: 380,
    config: {
      name: "barBySupplier",
      layouts: [{ id: 0, position: { x, y, z: 0, width: 560, height: 380 } }],
      singleVisual: {
        visualType: "barChart",
        projections: {
          Category: [{ queryRef: "Results.supplierName", active: true }],
          Y: [{ queryRef: "Sum(Results.anomalyCount)", active: true }],
        },
        prototypeQuery: {
          Version: 2,
          From: [{ Name: "r", Entity: "Results", Type: 0 }],
          Select: [
            {
              Column: {
                Expression: { SourceRef: { Source: "r" } },
                Property: "supplierName",
              },
              Name: "Results.supplierName",
            },
            {
              Aggregation: {
                Expression: {
                  Column: {
                    Expression: { SourceRef: { Source: "r" } },
                    Property: "anomalyCount",
                  },
                },
                Function: 0,
              },
              Name: "Sum(Results.anomalyCount)",
            },
          ],
          OrderBy: [
            {
              Direction: 2,
              Expression: {
                Aggregation: {
                  Expression: {
                    Column: {
                      Expression: { SourceRef: { Source: "r" } },
                      Property: "anomalyCount",
                    },
                  },
                  Function: 0,
                },
              },
            },
          ],
          Top: 10,
        },
        drillFilterOtherVisuals: true,
      },
    },
  };
}

function tableDetailVisual(x: number, y: number): VisualContainer {
  const columns = [
    "fileName",
    "documentNumber",
    "supplierName",
    "processingStatus",
    "anomalyCount",
    "anomalyTypes",
    "highestSeverity",
  ];
  return {
    x,
    y,
    z: 0,
    width: 1200,
    height: 300,
    config: {
      name: "tableDetail",
      layouts: [{ id: 0, position: { x, y, z: 0, width: 1200, height: 300 } }],
      singleVisual: {
        visualType: "tableEx",
        projections: {
          Values: columns.map((column) => ({
            queryRef: `Results.${column}`,
            active: true,
          })),
        },
        prototypeQuery: {
          Version: 2,
          From: [{ Name: "r", Entity: "Results", Type: 0 }],
          Select: columns.map((column) => ({
            Column: {
              Expression: { SourceRef: { Source: "r" } },
              Property: column,
            },
            Name: `Results.${column}`,
          })),
          OrderBy: [
            {
              Direction: 2,
              Expression: {
                Column: {
                  Expression: { SourceRef: { Source: "r" } },
                  Property: "anomalyCount",
                },
              },
            },
          ],
        },
        drillFilterOtherVisuals: true,
      },
    },
  };
}

function buildReportLayout(): string {
  const page = section([
    textVisual(
      "header",
      "Auditor de Documentos — Baseline",
      "Resumo operacional das 13 regras de anomalia aplicadas ao corpus fictício de 1001 documentos.",
      20,
      20,
      1240,
      80,
    ),
    cardVisual("cardArquivos", "Total Arquivos", 20, 120),
    cardVisual("cardAnomalias", "Total Anomalias", 300, 120),
    cardVisual("cardParciais", "Arquivos Parciais", 580, 120),
    cardVisual("cardComAnomalia", "Arquivos Com Anomalia", 860, 120),
    barByAnomalyTypeVisual(20, 280),
    barBySupplierVisual(600, 280),
    tableDetailVisual(20, 680),
  ]);

  const layout = {
    id: 0,
    resourcePackages: [
      {
        resourcePackage: {
          disabled: false,
          items: [],
          name: "SharedResources",
          type: 2,
        },
      },
    ],
    sections: [page],
    config: JSON.stringify({
      version: "5.43",
      themeCollection: {
        baseTheme: {
          name: "CY24SU02",
          version: "5.43",
          type: 2,
        },
      },
      activeSectionIndex: 0,
      defaultDrillFilterOtherVisuals: true,
      settings: {
        useStylableVisualContainerHeader: true,
        exportDataMode: 1,
      },
    }),
    layoutOptimization: 0,
    publicCustomVisuals: [],
  };
  return JSON.stringify(layout);
}

function buildMetadata(): string {
  return JSON.stringify({
    version: "1.14",
    createdFromRelease: "December2024",
    createdFromProduct: "PowerBIDesktop",
    fileDescription:
      "Auditor de Documentos IA — Template operacional de anomalias do baseline",
  });
}

function buildSettings(): string {
  return JSON.stringify({
    version: "2.1",
    storedModelVersion: "3.0",
  });
}

function buildDiagramLayout(): string {
  return JSON.stringify({
    version: "1.1.0",
    diagrams: [
      {
        ordinal: 0,
        scrollPosition: { x: 0, y: 0 },
        nodes: [
          { location: { x: 40, y: 40 }, nodeIndex: "Results", size: { width: 240, height: 180 }, zIndex: 0 },
          { location: { x: 360, y: 40 }, nodeIndex: "Audit", size: { width: 240, height: 180 }, zIndex: 1 },
          { location: { x: 40, y: 260 }, nodeIndex: "AnomalySummary", size: { width: 240, height: 180 }, zIndex: 2 },
          { location: { x: 360, y: 260 }, nodeIndex: "SourceFolder", size: { width: 240, height: 180 }, zIndex: 3 },
        ],
        name: "Diagrama padrão",
        zoomValue: 100,
        pinKeyFieldsToTop: false,
        showExtraHeaderInfo: false,
        hideKeyFieldsWhenCollapsed: false,
        tablesLocked: false,
      },
    ],
    selectedDiagram: "Diagrama padrão",
    defaultDiagram: "Diagrama padrão",
  });
}

async function main() {
  const outputDir = path.resolve(process.cwd(), "..", "docs", "power-bi");
  await mkdir(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, "auditor-documentos.pbit");

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": contentTypesXml(),
    "Version": utf16LeWithBom(TEMPLATE_VERSION),
    "SecurityBindings": securityBindingsXml(),
    "DataModelSchema": utf16LeWithBom(buildDataModelSchema()),
    "DiagramLayout": utf16LeWithBom(buildDiagramLayout()),
    "Metadata": utf16LeWithBom(buildMetadata()),
    "Settings": utf16LeWithBom(buildSettings()),
    "Report/Layout": utf16LeWithBom(buildReportLayout()),
  };

  const zipBuffer = zipSync(files, { level: 6 });
  await writeFile(outputFile, zipBuffer);

  console.log(
    JSON.stringify(
      {
        file: outputFile,
        fileCount: Object.keys(files).length,
        bytes: zipBuffer.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
