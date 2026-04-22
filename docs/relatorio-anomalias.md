# Relatório de Anomalias — Corpus Oficial

**Sessão analisada:** `8a5448f8-36f2-4e68-8118-80897a37d744` (baseline seed)  
**Arquivos processados:** 1001 (1000 oficiais + `DOC_0633_v2.txt`)  
**Arquivos com ao menos uma anomalia:** 184 (18,4%)  
**Total de anomalias:** 193  
**Provedor de IA:** Gemini 2.5 Flash-Lite  
**Data da execução:** 2026-04-17

---

## 1. Resumo executivo

| Severidade | Qtd | Participação |
|------------|-----|--------------|
| `high` | 14 | 7,3% |
| `medium` | 172 | 89,1% |
| `low` | 7 | 3,6% |

| Status de parsing | Qtd |
|-------------------|-----|
| `parsed` | 999 |
| `partial` | 2 |

Dois documentos falharam parcialmente no parsing estrutural, mas nenhum foi perdido. Ambos continuaram no lote com os campos disponíveis e receberam trilha de auditoria.

---

## 2. Breakdown por tipo

| Severidade | Confiança | Qtd | Tipo |
|------------|-----------|-----|------|
| high | HIGH | 8 | `DUPLICATE_DOCUMENT` |
| high | HIGH | 3 | `CNPJ_DIVERGENT` |
| high | HIGH | 2 | `INVOICE_AFTER_PAYMENT` |
| high | HIGH | 1 | `SUPPLIER_WITHOUT_HISTORY` |
| medium | HIGH | 150 | `STATUS_INCONSISTENT` |
| medium | LOW | 19 | `VALUE_OUTLIER` |
| medium | HIGH | 2 | `FILE_UNPROCESSABLE` |
| medium | HIGH | 1 | `APPROVER_UNRECOGNIZED` |
| low | MEDIUM | 4 | `OBSERVATION_SUSPICIOUS` |
| low | HIGH | 1 | `HASH_MALFORMED` |
| low | HIGH | 1 | `FILENAME_VERSIONED` |
| low | HIGH | 1 | `STATUS_MALFORMED` |

---

## 3. Achados críticos

### 3.1 Notas fiscais duplicadas

Critério: mesmo número de NF + mesmo fornecedor.

| Fornecedor | NF | Arquivos envolvidos |
|------------|----|---------------------|
| Marketing Digital Pro | NF-24322 | `DOC_0020.txt` ↔ `DOC_0855.txt` |
| Consultoria RH Parceiros | NF-67424 | `DOC_0083.txt` ↔ `DOC_0732.txt` |
| TechSoft Ltda | NF-55555 | `DOC_0150.txt` ↔ `DOC_0151.txt` |
| DataCenter Cloud SA | NF-37973 | `DOC_0276.txt` ↔ `DOC_0976.txt` |

### 3.2 CNPJ divergente

Fornecedor: Marketing Digital Pro.

| Arquivo | CNPJ encontrado | CNPJ canônico |
|---------|-----------------|---------------|
| `DOC_0300.txt` | `99.888.777/0001-00` | `45.678.901/0001-56` |
| `DOC_0301.txt` | `99.888.777/0001-00` | `45.678.901/0001-56` |
| `DOC_0302.txt` | `99.888.777/0001-00` | `45.678.901/0001-56` |

### 3.3 NF emitida após pagamento

| Arquivo | Emissão NF | Pagamento |
|---------|------------|-----------|
| `DOC_0750.txt` | 2024-01-02 | 2023-12-22 |
| `DOC_0751.txt` | 2023-12-28 | 2023-12-19 |

### 3.4 Fornecedor sem histórico

`DOC_0451.txt` contém `Consultoria Beta Ltda`, única ocorrência desse fornecedor no corpus analisado.

---

## 4. Achados de atenção

### 4.1 Status inconsistente

150 documentos têm `STATUS: CANCELADO` com `DATA_PAGAMENTO` preenchida. Exemplos: `DOC_0002.txt`, `DOC_0022.txt`, `DOC_0036.txt`.

### 4.2 Valor fora da faixa do fornecedor

19 documentos de `Consultoria RH Parceiros` têm valores em torno de R$ 19.500,00 contra mediana histórica próxima de R$ 8.500,00.

### 4.3 Arquivos com parsing parcial

| Arquivo | Motivo |
|---------|--------|
| `DOC_0089.txt` | Status truncado (`PAG`) + warning extra |
| `DOC_0487.txt` | Hash de verificação corrompido (`NLC048701...`) |

### 4.4 Aprovador não reconhecido

`DOC_0850.txt` contém o aprovador `João Ninguém`, fora da lista de aprovadores recorrentes.

---

## 5. Sinais auxiliares

| Tipo | Arquivo | Evidência |
|------|---------|-----------|
| Observação suspeita | `DOC_0151.txt` | `REPROCESSAMENTO` |
| Observação suspeita | `DOC_0450.txt` | Serviço avulso sem contrato formalizado |
| Observação suspeita | `DOC_0451.txt` | Serviço avulso sem contrato formalizado |
| Observação suspeita | `DOC_0633_v2.txt` | Contrato encerrado; pagamento não deveria ter sido efetuado |
| Hash malformado | `DOC_0487.txt` | Caracteres inválidos no hash |
| Nome versionado | `DOC_0633_v2.txt` | Sufixo `_v2` |
| Status malformado | `DOC_0089.txt` | `STATUS: PAG` |

---

## 6. Como reproduzir

```bash
cd web
npm run seed:baseline
```

Depois da sessão gerada, os exports ficam disponíveis em:

- `GET /api/sessions/<id>/results.xlsx`
- `GET /api/sessions/<id>/audit.xlsx`

Cada anomalia inclui `ruleId`, `severity`, `confidence`, `evidence` estruturada e `promptVersion`.
