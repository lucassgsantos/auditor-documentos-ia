import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

async function readSheet(filePath: string, sheetName: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.getWorksheet(sheetName);
  if (!ws) throw new Error(`Sheet not found: ${sheetName} in ${filePath}`);
  const rows: Record<string, unknown>[] = [];
  let headers: string[] = [];
  ws.eachRow((row, idx) => {
    const values = row.values as unknown[];
    if (idx === 1) {
      headers = values.slice(1).map((v) => String(v ?? ""));
    } else {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        const v = values[i + 1];
        obj[h] = v instanceof Date ? v.toISOString() : (v ?? null);
      });
      rows.push(obj);
    }
  });
  return rows;
}

async function main() {
  const dir = path.resolve(process.cwd(), "..", "docs", "power-bi");
  const results = await readSheet(path.join(dir, "results.xlsx"), "results");
  const anomalySummary = await readSheet(path.join(dir, "results.xlsx"), "anomaly_summary");
  const audit = await readSheet(path.join(dir, "audit.xlsx"), "audit");
  const metadata = JSON.parse(await readFile(path.join(dir, "session-metadata.json"), "utf8"));

  const html = renderHtml({ results, anomalySummary, audit, metadata });
  const outPath = path.join(dir, "dashboard.html");
  await writeFile(outPath, html, "utf8");
  console.log(JSON.stringify({ outPath, counts: { results: results.length, anomalySummary: anomalySummary.length, audit: audit.length } }, null, 2));
}

function renderHtml(data: {
  results: Record<string, unknown>[];
  anomalySummary: Record<string, unknown>[];
  audit: Record<string, unknown>[];
  metadata: Record<string, unknown>;
}) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Auditor de Documentos — Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
  :root { --bg:#0b1020; --panel:#141a33; --line:#1f2747; --fg:#e6ecff; --mut:#8a93b6; --acc:#7c9cff; --hi:#ff6b6b; --md:#ffa94d; --lo:#4dd4ac; }
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
  header{padding:24px 32px;border-bottom:1px solid var(--line)}
  h1{margin:0;font-size:22px}
  .sub{color:var(--mut);font-size:13px;margin-top:4px}
  .wrap{padding:24px 32px;max-width:1600px;margin:auto}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}
  .card .lbl{color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.5px}
  .card .val{font-size:28px;font-weight:600;margin-top:6px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
  @media(max-width:900px){.grid{grid-template-columns:1fr}}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px}
  .panel h2{margin:0 0 12px;font-size:14px;color:var(--mut);text-transform:uppercase;letter-spacing:.5px}
  canvas{max-height:360px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
  th{color:var(--mut);font-weight:500;position:sticky;top:0;background:var(--panel)}
  tr:hover td{background:rgba(124,156,255,.06)}
  .scroll{max-height:500px;overflow:auto}
  .sev-high{color:var(--hi);font-weight:600}
  .sev-medium{color:var(--md)}
  .sev-low{color:var(--lo)}
  .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;background:#1f2747;color:var(--mut)}
  input[type=search]{width:100%;padding:8px 12px;background:#0b1020;border:1px solid var(--line);border-radius:8px;color:var(--fg);margin-bottom:12px}
  footer{padding:16px 32px;color:var(--mut);font-size:12px;border-top:1px solid var(--line)}
</style>
</head>
<body>
<header>
  <h1>Auditor de Documentos IA — Dashboard</h1>
  <div class="sub" id="meta"></div>
</header>
<div class="wrap">
  <div class="cards" id="cards"></div>
  <div class="grid">
    <div class="panel"><h2>Anomalias por tipo</h2><canvas id="chTipo"></canvas></div>
    <div class="panel"><h2>Top 10 fornecedores por anomalias</h2><canvas id="chForn"></canvas></div>
  </div>
  <div class="grid">
    <div class="panel"><h2>Severidade</h2><canvas id="chSev"></canvas></div>
    <div class="panel"><h2>Status de processamento</h2><canvas id="chStatus"></canvas></div>
  </div>
  <div class="panel">
    <h2>Documentos (${data.results.length})</h2>
    <input type="search" id="q" placeholder="Filtrar por arquivo, fornecedor, CNPJ, tipo de anomalia…"/>
    <div class="scroll"><table id="tbl"><thead></thead><tbody></tbody></table></div>
  </div>
</div>
<footer>Gerado a partir de <code>results.xlsx</code> + <code>audit.xlsx</code>. Sessão baseline em <code>session-metadata.json</code>.</footer>
<script>
const DATA = ${json};
const R = DATA.results, A = DATA.audit, S = DATA.anomalySummary, M = DATA.metadata;

const col = {
  file:"Nome do Arquivo", status:"Status de Processamento", supplier:"Fornecedor",
  cnpj:"CNPJ Fornecedor", doc:"Número do Documento", gross:"Valor Bruto (R$)",
  anomCount:"Qtd. Anomalias", anomTypes:"Tipos de Anomalia", sev:"Severidade Máxima"
};
const colA = { sev:"Severidade", event:"Tipo de Evento" };
const colS = { type:"Tipo de Anomalia", count:"Quantidade", sev:"Severidade Máxima" };

document.getElementById("meta").textContent =
  "Sessão " + M.sessionId.slice(0,8) + " · " + M.totalFiles + " documentos · " + M.anomalyCount + " anomalias · exportada " + (M.exportedAt||"").slice(0,10);

const totalArq = R.length;
const totalAnom = R.reduce((s,r)=>s+(+r[col.anomCount]||0),0);
const comAnom = R.filter(r=>(+r[col.anomCount]||0)>0).length;
const parciais = R.filter(r=>r[col.status]!=="parsed").length;
const valorTotal = R.reduce((s,r)=>s+(+r[col.gross]||0),0);
const fmt = (n)=>new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(n);

const cards = [
  ["Total de arquivos", totalArq.toLocaleString("pt-BR")],
  ["Total de anomalias", totalAnom.toLocaleString("pt-BR")],
  ["Arquivos com anomalia", comAnom + " (" + ((comAnom/totalArq)*100).toFixed(1) + "%)"],
  ["Arquivos parciais", parciais.toString()],
  ["Valor total analisado", fmt(valorTotal)],
  ["Valor médio/doc", fmt(totalArq ? valorTotal/totalArq : 0)]
];
document.getElementById("cards").innerHTML = cards.map(([l,v])=>
  '<div class="card"><div class="lbl">'+l+'</div><div class="val">'+v+'</div></div>').join("");

Chart.defaults.color = "#8a93b6";
Chart.defaults.borderColor = "#1f2747";

const byType = {};
A.filter(a=>a[colA.event]==="ANOMALY_RULE").forEach(a=>{
  const t = a["Tipo de Anomalia"]||"desconhecido"; byType[t]=(byType[t]||0)+1;
});
const typeEntries = Object.entries(byType).sort((a,b)=>b[1]-a[1]);
new Chart(document.getElementById("chTipo"),{
  type:"bar",
  data:{labels:typeEntries.map(e=>e[0]),datasets:[{label:"Anomalias",data:typeEntries.map(e=>e[1]),backgroundColor:"#7c9cff"}]},
  options:{indexAxis:"y",plugins:{legend:{display:false}}}
});

const byForn = {};
R.forEach(r=>{ const c=+r[col.anomCount]||0; if(c>0){ const n=r[col.supplier]||"(sem fornecedor)"; byForn[n]=(byForn[n]||0)+c; } });
const fornTop = Object.entries(byForn).sort((a,b)=>b[1]-a[1]).slice(0,10);
new Chart(document.getElementById("chForn"),{
  type:"bar",
  data:{labels:fornTop.map(e=>e[0]),datasets:[{label:"Anomalias",data:fornTop.map(e=>e[1]),backgroundColor:"#ffa94d"}]},
  options:{indexAxis:"y",plugins:{legend:{display:false}}}
});

const sevCount = {high:0,medium:0,low:0};
A.filter(a=>a[colA.event]==="ANOMALY_RULE").forEach(a=>{ const s=a[colA.sev]; if(sevCount[s]!=null) sevCount[s]++; });
new Chart(document.getElementById("chSev"),{
  type:"doughnut",
  data:{labels:["Alta","Média","Baixa"],datasets:[{data:[sevCount.high,sevCount.medium,sevCount.low],backgroundColor:["#ff6b6b","#ffa94d","#4dd4ac"]}]}
});

const stCount = {};
R.forEach(r=>{ const s=r[col.status]||"?"; stCount[s]=(stCount[s]||0)+1; });
const stE = Object.entries(stCount);
new Chart(document.getElementById("chStatus"),{
  type:"doughnut",
  data:{labels:stE.map(e=>e[0]),datasets:[{data:stE.map(e=>e[1]),backgroundColor:["#4dd4ac","#ffa94d","#ff6b6b","#7c9cff"]}]}
});

const cols = [col.file, col.doc, col.supplier, col.cnpj, col.status, col.gross, col.anomCount, col.anomTypes, col.sev];
const thead = document.querySelector("#tbl thead");
thead.innerHTML = "<tr>" + cols.map(c=>"<th>"+c+"</th>").join("") + "</tr>";
const tbody = document.querySelector("#tbl tbody");
function render(rows){
  tbody.innerHTML = rows.map(r=>"<tr>"+cols.map(c=>{
    let v = r[c]; if(v==null) v="";
    if(c===col.gross && v!=="") v = fmt(+v||0);
    if(c===col.sev && v) return '<td class="sev-'+v+'">'+v+'</td>';
    return "<td>"+String(v)+"</td>";
  }).join("")+"</tr>").join("");
}
render(R.slice(0,500));
document.getElementById("q").addEventListener("input",(e)=>{
  const q = e.target.value.toLowerCase().trim();
  if(!q){ render(R.slice(0,500)); return; }
  const f = R.filter(r=>cols.some(c=>String(r[c]??"").toLowerCase().includes(q)));
  render(f.slice(0,500));
});
</script>
</body>
</html>`;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
