# Power BI — Entrega

Pacote pronto para abrir no Power BI Desktop sem precisar reconstruir nada do zero.

## Conteúdo em `docs/power-bi/`

| Arquivo | O que é |
| --- | --- |
| `auditoria.pbix` | Arquivo final do relatório, pronto para abrir no Power BI Desktop e publicar no Service |
| `auditor-documentos.pbit` | Template do relatório (data model + Power Query M + 10 medidas DAX + 1 página com cards/barras/tabela) |
| `results.xlsx` | Base principal exportada do baseline no Neon (sheets `results` + `anomaly_summary`) |
| `audit.xlsx` | Trilha de auditoria da mesma sessão (sheet `audit`) |
| `session-metadata.json` | Metadados da sessão exportada (id, totais, timestamps) |

## Como abrir (5 min)

1. Abra `auditoria.pbix` no Power BI Desktop. Se quiser reconstruir a partir do template, abra `auditor-documentos.pbit`.
2. Se o Desktop pedir o parâmetro **SourceFolder**, aponte para a pasta `docs/power-bi` (o caminho absoluto local, ex.: `D:\processo-seletivo\web\docs\power-bi`). Clique em **Load**.
3. Quando perguntar sobre privacidade das fontes, selecione **Public** / **Organizational** e clique em **Save**.
4. O modelo carrega três tabelas (`Results`, `AnomalySummary`, `Audit`), o relacionamento `Audit[fileName] → Results[fileName]` e todas as medidas DAX já ficam disponíveis em `Results`.
5. A página `Visão Geral` já traz o layout base com:
   - cabeçalho (texto)
   - 4 cards: `Total Arquivos`, `Total Anomalias`, `Arquivos Parciais`, `Arquivos Com Anomalia`
   - barra horizontal por tipo de anomalia
   - barra horizontal por fornecedor (top 10 por anomalias)
   - tabela detalhada com `fileName`, `documentNumber`, `supplierName`, `processingStatus`, `anomalyCount`, `anomalyTypes`, `highestSeverity`

Se algum visual aparecer vazio ou com erro (o formato interno do Power BI é frágil entre versões), basta deletá-lo e recriar arrastando os campos — todas as colunas e medidas já estão no modelo.

## Publicar no Power BI Service (opcional)

1. Em **Home → Publish**, escolha o workspace.
2. No Service, abra o dataset publicado, **Schedule refresh** → aponte as credenciais do arquivo local ou, preferencialmente, hospede `results.xlsx` + `audit.xlsx` no OneDrive / SharePoint e reaponte o parâmetro `SourceFolder` para a URL.
3. Fixe os cards no dashboard que for entregar.

## Regerar os insumos

- Para puxar os xlsx atualizados direto do Neon:
  ```bash
  cd web
  npm run export:powerbi
  ```
  Usa a sessão `baseline_seed` mais recente e grava em `docs/power-bi/`.

- Para regerar o `.pbit` a partir do código fonte:
  ```bash
  cd web
  npm run build:pbit
  ```
  Saída: `docs/power-bi/auditor-documentos.pbit`.

## Medidas DAX incluídas

Já ficam disponíveis na tabela `Results`:

| Medida | Expressão |
| --- | --- |
| `Total Arquivos` | `DISTINCTCOUNT(Results[fileName])` |
| `Total Anomalias` | `SUM(Results[anomalyCount])` |
| `Arquivos Parciais` | `CALCULATE(DISTINCTCOUNT(Results[fileName]), Results[processingStatus] <> "parsed")` |
| `Arquivos Com Anomalia` | `CALCULATE(DISTINCTCOUNT(Results[fileName]), Results[anomalyCount] > 0)` |
| `% Arquivos Com Anomalia` | `DIVIDE([Arquivos Com Anomalia], [Total Arquivos])` |
| `Anomalias Alta Severidade` | `CALCULATE(COUNTROWS(Audit), Audit[eventType]="ANOMALY_RULE", Audit[severity]="high")` |
| `Anomalias Média Severidade` | idem com `"medium"` |
| `Anomalias Baixa Severidade` | idem com `"low"` |
| `Valor Total Analisado` | `SUM(Results[grossAmount])` |
| `Valor Médio por Documento` | `AVERAGE(Results[grossAmount])` |

## Estrutura das tabelas

### `Results` (1 linha por documento)

`fileName`, `processingStatus`, `encoding`, `documentType`, `documentNumber`, `serviceDescription`, `supplierName`, `supplierCnpj`, `grossAmount`, `issueDateIso`, `paymentDateIso`, `invoiceIssueDateIso`, `approvedBy`, `destinationBank`, `status`, `verificationHash`, `anomalyCount`, `anomalyTypes`, `highestSeverity`, `notExtractedFields`, `promptVersion`, `extractionMethod`, `modelId`, `processedAt`

### `AnomalySummary` (1 linha por tipo de anomalia)

`anomalyType`, `count`, `highestSeverity`, `exampleFiles`

### `Audit` (1 linha por evento — extração OU regra)

`eventType` (`PROCESSING_RESULT` / `ANOMALY_RULE`), `fileName`, `processedAt`, `outcome`, `ruleId`, `anomalyType`, `confidence`, `severity`, `evidenceJson`, `promptVersion`, `extractionMethod`, `modelId`

Relacionamento: `Audit[fileName] → Results[fileName]` (N:1, single direction).

## Snapshot do baseline exportado

Consulte `session-metadata.json` para o recorte exato (id da sessão, totais e timestamps). Números de referência do último export:

- 1001 documentos processados
- 193 anomalias
- 12 tipos de anomalia distintos
- 1194 entradas de auditoria (1001 eventos `PROCESSING_RESULT` + 193 `ANOMALY_RULE`)

## Observações técnicas

- `.pbit` é um zip com JSON/XML em UTF-16 LE com BOM. Se precisar editar à mão, mantenha a codificação — utilitários típicos de edição salvam como UTF-8 e corrompem o arquivo.
- O template não embute as credenciais/caminho — cada abertura pede o parâmetro `SourceFolder`.
- Se for versionar o `.pbit`, ele já está em `docs/power-bi/` e pode ir normalmente ao Git (os xlsx também, são exports determinísticos do Neon).
