# Auditor de Documentos com IA

Aplicação web para ingestão, extração e auditoria de documentos financeiros com detecção automática de anomalias via IA.

---

## Sumário

- [Demo e entregáveis](#demo-e-entregáveis)
- [Arquitetura](#arquitetura)
- [Como rodar localmente](#como-rodar-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Pipeline de processamento](#pipeline-de-processamento)
- [Design do prompt de extração](#design-do-prompt-de-extração)
- [Regras de detecção de anomalias](#regras-de-detecção-de-anomalias)
- [Segurança](#segurança)
- [Rastreabilidade e auditoria](#rastreabilidade-e-auditoria)
- [Testes](#testes)

---

## Demo e entregáveis

| Entregável | Link |
|---|---|
| Aplicação pública | _adicionar URL após deploy_ |
| Repositório GitHub | https://github.com/lucassgsantos/auditor-documentos-ia |
| Dashboard Power BI | _adicionar link ou `.pbix` na entrega final_ |
| Relatório de anomalias | [`docs/relatorio-anomalias.md`](docs/relatorio-anomalias.md) |

---

## Arquitetura

```
┌──────────────────────────────────────────────────┐
│  Browser                                         │
│  UploadConsole  ──────────────────►  /api/sessions │
│  ResultsExplorer ◄────────────────  /api/sessions/[id]/* │
└──────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────┐
│  Next.js App Router (App Layer)                  │
│                                                  │
│  POST /api/sessions              → cria sessão   │
│  POST /api/sessions/[id]/documents → ingere doc  │
│  POST /api/sessions/[id]/finalize  → detecta     │
│  GET  /api/sessions/[id]/results.xlsx            │
│  GET  /api/sessions/[id]/audit.xlsx              │
└───────────────────┬──────────────────────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
┌────────────────┐   ┌──────────────────────┐
│  PostgreSQL     │   │  AI Provider         │
│  5 tabelas      │   │  Gemini 2.5 Flash-Lite│
│  sessions       │   │  ou OpenAI GPT-4.1-  │
│  documents      │   │  mini (configurável) │
│  anomalies      │   └──────────────────────┘
│  audit_entries  │
│  supplier_      │
│  baselines      │
└────────────────┘
```

**Stack:**
- **Frontend / App:** Next.js 16 (App Router), React 19, Tailwind CSS 4
- **Backend:** Next.js Route Handlers (server-side, Node.js)
- **Banco de dados:** PostgreSQL (via `postgres` client com connection pooling)
- **IA:** Google Gemini 2.5 Flash-Lite (padrão) ou OpenAI GPT-4.1-mini — configurável via `AI_PROVIDER`
- **Export:** ExcelJS (`.xlsx`)
- **Extração de .zip no cliente:** fflate (sem upload do .zip para o servidor)
- **Upload concorrente:** p-limit (máx. 4 simultâneos)
- **Testes:** Vitest (unitários) + Playwright (E2E)

---

## Como rodar localmente

### Pré-requisitos

- Node.js 20+
- PostgreSQL 15+ acessível
- Chave de API do Gemini **ou** OpenAI

### 1. Instalar dependências

```bash
cd web
npm install
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env.local
# edite .env.local com suas chaves e DATABASE_URL
```

### 3. Criar as tabelas no banco

Execute o script de schema:

```bash
# conecte ao seu banco e rode:
psql $DATABASE_URL -f src/lib/db/schema.sql
```

Ou crie as tabelas manualmente conforme `src/lib/db/schema.ts`.

> Observação: os endpoints também chamam `ensureDatabaseSchema()` na primeira operação,
> mas o `schema.sql` é recomendado para provisionamento explícito (CI, staging e produção).

### 4. Alimentar o corpus de baseline (opcional, recomendado)

O baseline é o histórico de referência usado para detecção de anomalias como CNPJ divergente, fornecedor sem histórico e valor fora da faixa. Rode o script apontando para a pasta com os 1.000 arquivos `.txt`:

```bash
DOCS_PATH=../  npm run seed:baseline
```

O script usa `SEED_CONCURRENCY` (padrão: 3) para ingestão paralela.

### 5. Iniciar o servidor de desenvolvimento

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000).

### 6. Usar a ferramenta

1. Arraste um `.zip` ou selecione vários `.txt` no **Upload Console**
2. A ferramenta aplica parser determinístico e aciona IA quando há campo ausente, encoding suspeito ou parsing parcial
3. Ao concluir, acesse os resultados na página da sessão
4. Baixe **results.xlsx** (dados extraídos + resumo de anomalias) e **audit.xlsx** (log rastreável)

---

## Variáveis de ambiente

| Variável | Obrigatória | Descrição | Padrão |
|---|---|---|---|
| `DATABASE_URL` | Sim | URL PostgreSQL com sslmode | — |
| `AI_PROVIDER` | Não | `gemini`, `openai` ou `auto` | `auto` |
| `GEMINI_API_KEY` | Se usar Gemini | Chave da Google AI | — |
| `GEMINI_MODEL` | Não | ID do modelo Gemini | `gemini-2.5-flash-lite` |
| `OPENAI_API_KEY` | Se usar OpenAI | Chave da OpenAI | — |
| `OPENAI_MODEL` | Não | ID do modelo OpenAI | `gpt-4.1-mini` |
| `MAX_UPLOAD_BYTES` | Não | Tamanho máximo por arquivo | `2000000` (2 MB) |
| `MAX_SESSION_FILES` | Não | Limite máximo de documentos por lote/sessão | `1200` |
| `FORCE_AI_EXTRACTION` | Não | Força chamada de IA para todos os arquivos, útil em demo técnica | `false` |
| `SEED_CONCURRENCY` | Não | Paralelismo do seed de baseline | `3` |

**As chaves de API nunca são expostas ao frontend.** Todas as chamadas à IA ocorrem exclusivamente em Route Handlers do lado do servidor.

---

## Pipeline de processamento

Cada arquivo `.txt` passa pelo seguinte fluxo:

```
Bytes recebidos (base64)
       │
       ▼
 Detecção de encoding
 (UTF-8 → fallback Latin-1)
       │
       ▼
 Parser determinístico
 - Extração de campos chave:valor
 - Normalização de datas (DD/MM/YYYY → ISO)
 - Normalização de valores (R$ 1.234,56 → 1234.56)
 - Normalização de CNPJ (somente dígitos)
 - Detecção de campos ausentes, linhas inválidas
 - Classificação: parsed / partial / unprocessable
       │
       ├─ Se status = "parsed" e campos completos ──► salva sem chamar IA
       ├─ Se FORCE_AI_EXTRACTION=true ───────────────► chama IA mesmo em documentos limpos
       │
       └─ Se partial / unprocessable / campos faltando
              │
              ▼
         Extração via IA (Gemini ou OpenAI)
         - Schema JSON estruturado com strict=true
         - Parser hints pré-preenchidos como contexto
         - Retry com backoff exponencial (até 4 tentativas)
         - Merge: campos da IA preenchem apenas os nulos do parser
              │
              ▼
         Resultado mesclado salvo no banco
         - DESCRICAO_SERVICO normalizada como serviceDescription
         - Campos ainda ausentes registrados em notExtractedFields
              │
              ▼
         Sessão finalizada → analyzeDocuments()
         - Constrói perfil de referência (baseline histórico)
         - Aplica 15 regras de anomalia
         - Gera audit_entries por arquivo e por anomalia
```

---

## Design do prompt de extração

**Versão atual:** `document-extractor-v2`

### Por que usar IA apenas quando necessário

O modo padrão é híbrido: o parser determinístico cobre a maioria dos arquivos sem custo de API, e a IA entra como extração/reparo estruturado. A IA é acionada quando:
- O arquivo tem status `partial` ou `unprocessable`
- Há campos ausentes, linhas inválidas ou warnings de encoding
- Qualquer campo crítico (fornecedor, CNPJ, valor, datas, aprovador) está nulo

Isso reduz latência, custo de API e risco de alucinação em arquivos bem-formados. Para uma demonstração em que o avaliador queira ver a IA sendo chamada em todos os documentos, configure `FORCE_AI_EXTRACTION=true`.

### Corpus de 1001 arquivos

O briefing fala em 1.000 arquivos oficiais. No corpus local há também `DOC_0633_v2.txt`, um arquivo versionado propositalmente suspeito. Por isso a baseline local pode aparecer como **1001 documentos**: 1.000 do lote oficial + 1 versionado.

### Estrutura do prompt

O prompt enviado à IA tem três partes fixas:

```
1. Instruções de extração
   "Extract the financial document into the schema."
   "Use null for values you cannot confirm from the text."
   "Do not invent values."
   "Dates must be ISO YYYY-MM-DD when present."
   "CNPJ must contain digits only."
   "Gross amount must be a number without currency symbols."

2. Parser hints (campos já extraídos pelo parser determinístico)
   — dados pré-normalizados servem como âncora e reduzem alucinação

3. Texto do documento (normalizado, sem BOM)
```

### Por que schema estruturado (JSON Schema strict)

- **Gemini:** `responseMimeType: "application/json"` + `responseJsonSchema` — garante JSON válido sem pós-processamento
- **OpenAI:** `json_schema` com `strict: true` — elimina campos inesperados e valores fora do tipo

O campo `notExtractedFields` é obrigatório no schema e lista explicitamente os campos que a IA não conseguiu extrair — em vez de retornar string vazia, a IA declara a ausência, o que é registrado no audit log.

### Retry e resiliência

- Até 4 tentativas com backoff exponencial (350–550 ms × 2^tentativa)
- Retrys em: HTTP 408/429/500/502/503/504, ETIMEDOUT, ECONNRESET
- Erros não recuperáveis propagam sem retry para não bloquear o pipeline

---

## Regras de detecção de anomalias

A detecção é feita em `src/lib/documents/anomalies.ts` após a sessão ser finalizada. O perfil de referência é construído a partir do corpus histórico (baseline) ou, na ausência deste, do próprio lote atual.

| # | Regra | Tipo | Severidade | Confiança |
|---|---|---|---|---|
| 1 | `FILE_UNPROCESSABLE` | Arquivo com falha no parsing | Médio | ALTA |
| 2 | `DUPLICATE_DOCUMENT` | Mesmo número de NF + mesmo fornecedor | Alto | ALTA |
| 3 | `SUPPLIER_WITHOUT_HISTORY` | Fornecedor nunca visto no baseline | Alto | ALTA |
| 4 | `CNPJ_DIVERGENT` | CNPJ difere do canônico do fornecedor | Alto | ALTA |
| 5 | `CNPJ_CHECKSUM_INVALID` | CNPJ sem 14 dígitos válidos ou com dígitos verificadores inválidos | Alto | ALTA |
| 6 | `INVOICE_AFTER_PAYMENT` | DATA_EMISSAO_NF > DATA_PAGAMENTO | Alto | ALTA |
| 7 | `APPROVER_UNRECOGNIZED` | Aprovador fora da lista conhecida | Médio | ALTA |
| 8 | `STATUS_INCONSISTENT` | CANCELADO com DATA_PAGAMENTO preenchida | Médio | ALTA |
| 9 | `VALUE_OUTLIER` | Valor fora do IQR ×1.5 OU z-score ≥ 2 (≥4 amostras) | Médio | ALTA / MÉDIA / BAIXA |
| 10 | `STATUS_MALFORMED` | STATUS fora do domínio conhecido | Baixo | ALTA |
| 11 | `HASH_MALFORMED` | Hash de verificação não bate com padrão NLC* | Baixo | ALTA |
| 12 | `FILENAME_VERSIONED` | Nome do arquivo contém `_v{N}` (reprocessamento) | Baixo | ALTA |
| 13 | `OBSERVATION_SUSPICIOUS` | Campo OBSERVACAO contém padrão suspeito | Baixo | MÉDIA |
| 14 | `BANK_ATYPICAL` | Banco atípico para o fornecedor, apenas quando já existe outra divergência no documento | Baixo | BAIXA |
| 15 | `DOCUMENT_NUMBER_PREFIX_MISMATCH` | Prefixo do número não condiz com tipo documental | Baixo | ALTA |

Cada anomalia registra: `ruleId`, `severity`, `confidence`, `message` e `evidence` (campos específicos que dispararam a regra).

### Como o perfil de referência é construído

- **Com baseline histórico:** o perfil usa os documentos do corpus de referência (seed). Os documentos do lote atual são comparados contra esse perfil.
- **Sem baseline:** o perfil é construído a partir do próprio lote, com `minimumApproverOccurrences = 2` para evitar que aprovadores únicos sejam imediatamente marcados como desconhecidos.
- **CNPJ canônico:** o CNPJ mais frequente por fornecedor vence (maioria simples), resistente a erros pontuais.
- **Detecção de outlier de valor:** combina duas heurísticas estatísticas — IQR (intervalo interquartil × 1,5) e z-score (|z| ≥ 2). Dispara quando pelo menos uma das regras marca outlier. Confiança ALTA quando ambas confirmam; MÉDIA para IQR sozinho; BAIXA para z-score sozinho. Ativado somente com ≥ 4 amostras históricas para evitar falsos positivos.

---

## Segurança

| Controle | Implementação |
|---|---|
| Chaves de API nunca no frontend | Apenas Route Handlers do servidor acessam as APIs de IA |
| Validação de tipo de arquivo | Apenas `.txt` aceitos; recusa com HTTP 400 |
| Validação de tamanho | Limite configurável via `MAX_UPLOAD_BYTES` (padrão 2 MB); recusa com HTTP 413 |
| Limite de lote | `MAX_SESSION_FILES` evita gasto acidental de API em lotes acima do esperado |
| Validação de nome | Recusa nomes com pasta, `..`, caracteres de controle ou extensão diferente de `.txt` |
| Sem stack traces expostos | `toApiErrorResponse` retorna mensagens genéricas para erros 500 |
| Headers de segurança | CSP, X-Frame-Options: DENY, X-Content-Type-Options, Permissions-Policy, Referrer-Policy |
| CSP restrita | `connect-src` limita conexões externas a `api.openai.com` e `generativelanguage.googleapis.com` |
| Sem armazenamento de dados da IA | OpenAI chamado com `store: false` |
| Health check operacional | `GET /api/health` retorna estado de banco + configuração de IA |
| Correlação de requisições | APIs retornam e propagam `x-request-id` em sucesso e erro |
| Métricas operacionais | `GET /api/metrics` expõe contadores e latência por rota (in-memory) |

---

## Rastreabilidade e auditoria

Cada documento processado gera no mínimo uma linha no audit log do tipo `PROCESSING_RESULT`. Cada anomalia detectada gera uma linha adicional do tipo `ANOMALY_RULE`.

**Campos do audit log:**

| Campo | Descrição |
|---|---|
| `eventType` | `PROCESSING_RESULT` ou `ANOMALY_RULE` |
| `fileName` | Nome do arquivo original |
| `processedAt` | Timestamp ISO do processamento |
| `outcome` | Resultado do parsing (ex: `parsed`, `partial`, `anomaly-flagged`) |
| `ruleId` | ID da regra que disparou (apenas em `ANOMALY_RULE`) |
| `anomalyType` | Tipo da anomalia detectada |
| `confidence` | `HIGH` / `MEDIUM` / `LOW` |
| `severity` | `high` / `medium` / `low` |
| `evidenceJson` | JSON com os campos específicos que evidenciaram a anomalia |
| `promptVersion` | Versão do prompt utilizado (`document-extractor-v2`) |
| `extractionMethod` | `parser` ou `gemini`/`openai` |
| `modelId` | Modelo efetivamente utilizado, como `parser`, `gemini-2.5-flash-lite` ou `gpt-4.1-mini` |

Se a IA não conseguiu extrair um campo, ele é registrado explicitamente em `notExtractedFields` — valor vazio nunca é assumido como correto.

O audit log é exportável separadamente via **audit.xlsx** na página de resultados.

Logs estruturados JSON são emitidos para ingestão, finalização, export e erros de API com `requestId`, rota, método e status.

O endpoint `GET /api/health` também publica o check `api` com resumo de requisições, erros 5xx e latência agregada.

---

## Testes

```bash
# Lint
npm run lint

# Unitários (Vitest)
npm run test

# Build de produção
npm run build

# Unitários em modo watch
npm run test:watch

# E2E (Playwright)
npm run test:e2e

# Smoke principal usado na revisão
npx playwright test tests/e2e/home.spec.ts tests/e2e/intake-flow.spec.ts
```

Cobertura de testes inclui: parser de documentos, extração AI, detecção de anomalias, builders de export, e componentes de UI.

Pipeline CI (GitHub Actions): `.github/workflows/web-ci.yml` executa lint, testes unitários, build e suíte E2E com Playwright (Chromium).
