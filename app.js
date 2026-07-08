/* ============================================================
   Torre de Controle Linehaul · CEVA × Shopee
   app.js — filtros, KPIs, mapa (calor/números) e gráficos
============================================================ */

const CONFIG = {
  // URL do Web App do Google Apps Script (termina em /exec).
  // Deixe vazio ("") para usar a cópia local em data.js.
  SHEETS_API_URL: "https://script.google.com/macros/s/AKfycbxPPZfO6RCcSbgrYxu9uMhzTPMbExG8P06vFC-mhgXNOueuAa44lqZFQDadRxum0ryf/exec",
};

/* ---------- KPIs disponíveis na planilha (metas do BSC 3.0) ---------- */
const KPIS = [
  { id: "etaOrigem",  nome: "ETA Origem",       target: 99, minimo: 97,
    desc: "Pacotes de veículos apresentados on-time na origem ÷ pacotes analisados." },
  { id: "cptOrigem",  nome: "CPT Origem (ETD)", target: 99, minimo: 97,
    desc: "Pacotes de veículos embarcados on-time ÷ pacotes analisados." },
  { id: "noShow",     nome: "No Show",          target: 99, minimo: 97,
    desc: "1 − (no shows ÷ (viagens fechadas + no shows))." },
  { id: "etaDestino", nome: "ETA Destino",      target: 95, minimo: 93,
    desc: "Pacotes de veículos apresentados on-time no destino ÷ pacotes analisados." },
];

/* ---------- Coordenadas das localidades ---------- */
// Chave: "uf|cidade" normalizada (sem acento, minúsculas). Adicione novas cidades aqui.
const COORDS = {
  "sp|franco da rocha":          [-23.3229, -46.7264],
  "sp|sao bernardo do campo":    [-23.6914, -46.5646],
  "sp|piracicaba":               [-22.7253, -47.6492],
  "sp|osasco":                   [-23.5329, -46.7920],
  "sp|osasco 02":                [-23.5329, -46.7920],
  "sp|artur alvim":              [-23.5407, -46.4842],
  "sp|campinas":                 [-22.9099, -47.0626],
  "sp|campinas sao martinho":    [-22.9099, -47.0626],
  "sp|guarulhos":                [-23.4543, -46.5337],
  "sp|cumbica guarulhos":        [-23.4356, -46.4731],
  "sp|jardim adriana":           [-23.4720, -46.4390],
  "sp|sao jose do rio p":        [-20.8113, -49.3758],
  "sp|sao jose do rio preto":    [-20.8113, -49.3758],
  "sp|votuporanga":              [-20.4237, -49.9781],
  "sp|bauru":                    [-22.3145, -49.0587],
  "sp|cravinhos":                [-21.3400, -47.7300],
  "sp|santana":                  [-23.5015, -46.6250],
  "sp|sao paulo mooca":          [-23.5580, -46.5997],
  "sp|jurubatuba":               [-23.6820, -46.6960],
  "sp|vilaguilherme":            [-23.5060, -46.6040],
  "sp|vila guilherme":           [-23.5060, -46.6040],
  "mg|betim":                    [-19.9668, -44.1983],
  "mg|contagem":                 [-19.9317, -44.0536],
  "mg|uberlandia":               [-18.9186, -48.2772],
  "mg|guaxupe":                  [-21.3050, -46.7128],
  "mg|guaxupe 02":               [-21.3050, -46.7128],
  "pe|jaboatao dos guararapes":  [-8.1120,  -35.0150],
  "pr|curitiba":                 [-25.4284, -49.2733],
  "rj|duque de caxias":          [-22.7856, -43.3117],
  "rj|rio de janeiro":           [-22.9068, -43.1729],
  "rj|valenca":                  [-22.2455, -43.7007],
  "rj|valenca-rj":               [-22.2455, -43.7007],
  "rj|valenca-rj 02":            [-22.2455, -43.7007],
  "rs|caxias do sul":            [-29.1678, -51.1794],
  "es|viana":                    [-20.3900, -40.4930],
};

const norm = (s) => String(s ?? "")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/["']+/g, "").replace(/[_]+/g, " ").replace(/\s+/g, " ")
  .trim().toLowerCase();

/**
 * "SoC_SP_Franco da Rocha"          -> { tipo:"SoC", uf:"SP", cidade:"Franco da Rocha" }
 * "LM Hub_SP_Campinas_São Martinho" -> { tipo:"LM Hub", uf:"SP", cidade:"Campinas São Martinho" }
 */
function parseLocal(raw) {
  if (!raw) return null;
  const limpo = String(raw).replace(/^["']+|["']+$/g, "").trim();
  const partes = limpo.split("_");
  if (partes.length < 3) return { tipo: "", uf: "", cidade: limpo, raw: limpo, coords: null };
  const tipo = partes[0].trim();
  const uf = partes[1].trim().toUpperCase();
  const cidade = partes.slice(2).join(" ").trim();

  // procura a chave completa e depois versões com menos palavras no final
  const ufk = uf.toLowerCase();
  const tokens = norm(cidade).split(" ");
  let coords = null;
  for (let n = tokens.length; n >= 1 && !coords; n--) {
    coords = COORDS[`${ufk}|${tokens.slice(0, n).join(" ")}`] || null;
  }
  return { tipo, uf, cidade, raw: limpo, coords };
}

/* ---------- Normalização das linhas ---------- */
const MESES_LABEL = ["","Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

// Classifica a TSP: nomes contendo "TAC" (G-TAC, G-TAC MENSAL…) são frota TAC; demais são TERCEIRO.
function classificarTsp(tsp) {
  if (!tsp || tsp === "EM ABERTO") return null;
  return norm(tsp).includes("tac") ? "TAC" : "TERCEIRO";
}

// Canoniza o tipo de veículo ("MEDIO" e "MÉDIO" viram um só)
const VEICULO_CANON = { "medio": "MÉDIO" };
function canonVeiculo(v) {
  if (!v) return null;
  return VEICULO_CANON[norm(v)] || String(v).trim().toUpperCase();
}

function normalizarLinha(r) {
  const dataStr = (r["DATA"] || "").slice(0, 10);
  const ano = dataStr ? Number(dataStr.slice(0, 4)) : null;
  const mesNum = dataStr ? Number(dataStr.slice(5, 7)) : null;
  return {
    data: dataStr || null,
    ano,
    mes: mesNum,
    semana: r["SEMANA"] || null,
    semanaAno: (ano && r["SEMANA"]) ? `${ano} ${r["SEMANA"]}` : null,
    diaSemana: r["DIA"] || null,
    tsp: r["TSP"] || null,
    tspClasse: classificarTsp(r["TSP"]),
    rota: r["ROTA SHOPEE"] || null,
    origem: parseLocal(r["ORIGEM"]),
    destino: parseLocal(r["DESTINO"]),
    analiseEtaOrigem: r["ANÁLISE ETA ORIGEM"] || null,
    analiseCpt: r["ANÁLISE CPT"] || null,
    analiseEtaDestino: r["ANÁLISE ETA DESTINO"] || null,
    statusReal: r["STATUS REAL"] || null,
    km: Number(r["KM ROTA"]) || 0,
    pacotes: r["PACOTES"] != null && r["PACOTES"] !== "" ? Number(r["PACOTES"]) : null,
    veiculo: canonVeiculo(r["VEÍCULO"]),
  };
}

/* ---------- Cálculo dos KPIs ---------- */
function pctPorPacote(rows, campo) {
  let ok = 0, total = 0;
  for (const r of rows) {
    const v = r[campo];
    if (!r.pacotes || (v !== "NO PRAZO" && v !== "FORA DO PRAZO")) continue;
    total += r.pacotes;
    if (v === "NO PRAZO") ok += r.pacotes;
  }
  return total > 0 ? (ok / total) * 100 : null;
}

function calcularKpis(rows) {
  const noShows = rows.filter(r => r.statusReal === "NO SHOW").length;
  const fechadas = rows.filter(r => r.statusReal && r.statusReal !== "NO SHOW" && r.statusReal !== "CANCELADO").length;
  const noShowPct = (noShows + fechadas) > 0 ? (1 - noShows / (noShows + fechadas)) * 100 : null;
  return {
    etaOrigem:  pctPorPacote(rows, "analiseEtaOrigem"),
    cptOrigem:  pctPorPacote(rows, "analiseCpt"),
    etaDestino: pctPorPacote(rows, "analiseEtaDestino"),
    noShow: noShowPct,
    _extra: { noShows, fechadas },
  };
}

/* ---------- Estado ---------- */
let DADOS = [];
let filtro = { ano: "", mes: "", semana: "", dia: "", tsp: "" };
let mapaVista = "calor";      // calor | numeros
let heatModo = "ambos";       // ambos | origem | destino
let heatPeso = "viagens";     // viagens | pacotes
let mapa, camadaHeat, camadaRotas, camadaNumeros;

/* ---------- Filtros ---------- */
const casaFiltro = (r, ignorar) =>
  (ignorar === "ano"    || !filtro.ano    || String(r.ano) === filtro.ano) &&
  (ignorar === "mes"    || !filtro.mes    || String(r.mes) === filtro.mes) &&
  (ignorar === "semana" || !filtro.semana || r.semana === filtro.semana) &&
  (ignorar === "dia"    || !filtro.dia    || r.data === filtro.dia) &&
  (ignorar === "tsp"    || !filtro.tsp    || r.tspClasse === filtro.tsp);

const linhasFiltradas = () => DADOS.filter(r => casaFiltro(r, null));

function opcoes(select, valores, formatar, atual) {
  select.innerHTML = "";
  const opTodos = document.createElement("option");
  opTodos.value = ""; opTodos.textContent = "Todos";
  select.appendChild(opTodos);
  for (const v of valores) {
    const op = document.createElement("option");
    op.value = String(v);
    op.textContent = formatar ? formatar(v) : String(v);
    select.appendChild(op);
  }
  select.value = valores.map(String).includes(atual) ? atual : "";
}

function montarFiltros() {
  const uniq = (rows, fn) => [...new Set(rows.map(fn).filter(v => v != null))]
    .sort((a, b) => (typeof a === "number" && typeof b === "number") ? a - b : String(a).localeCompare(String(b)));

  opcoes(document.getElementById("f-ano"),    uniq(DADOS.filter(r => casaFiltro(r, "ano")), r => r.ano), null, filtro.ano);
  opcoes(document.getElementById("f-mes"),    uniq(DADOS.filter(r => casaFiltro(r, "mes")), r => r.mes), m => MESES_LABEL[m] || m, filtro.mes);
  opcoes(document.getElementById("f-semana"), uniq(DADOS.filter(r => casaFiltro(r, "semana")), r => r.semana), null, filtro.semana);
  opcoes(document.getElementById("f-dia"),    uniq(DADOS.filter(r => casaFiltro(r, "dia")), r => r.data),
    d => { const [a, m, dd] = d.split("-"); return `${dd}/${m}/${a}`; }, filtro.dia);

  filtro.ano    = document.getElementById("f-ano").value;
  filtro.mes    = document.getElementById("f-mes").value;
  filtro.semana = document.getElementById("f-semana").value;
  filtro.dia    = document.getElementById("f-dia").value;
  // TSP tem opções fixas (Todas / TAC / TERCEIRO), sem cascata
}

/* ---------- Renderização ---------- */
const fmt = (n, dec = 0) => n == null ? "—" :
  n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtCompacto = (n) => n >= 1000 ? (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "k" : fmt(n);

function classeStatus(valor, target, minimo) {
  if (valor == null) return "is-na";
  if (valor >= target) return "is-ok";
  if (valor >= minimo) return "is-warn";
  return "is-bad";
}

function renderResumo(rows) {
  const el = document.getElementById("strip-resumo");
  const canceladas = rows.filter(r => r.statusReal === "CANCELADO").length;
  const noShows = rows.filter(r => r.statusReal === "NO SHOW").length;
  const finalizadas = rows.filter(r => r.statusReal === "VIAGEM FINALIZADA").length;
  const pacotes = rows.reduce((s, r) => s + (r.pacotes || 0), 0);
  const km = rows.reduce((s, r) => s + (r.statusReal !== "CANCELADO" && r.statusReal !== "NO SHOW" ? r.km : 0), 0);
  const itens = [
    ["Viagens", fmt(rows.length)],
    ["Finalizadas", fmt(finalizadas)],
    ["Canceladas", fmt(canceladas)],
    ["No shows", fmt(noShows)],
    ["Pacotes", fmt(pacotes)],
    ["KM planejado", fmt(km)],
  ];
  el.innerHTML = itens.map(([l, v]) =>
    `<div class="strip-item"><div class="v">${v}<span class="spin" aria-hidden="true"></span></div><div class="l">${l}</div></div>`).join("");
}

function renderKpis(rows) {
  const grid = document.getElementById("kpi-grid");
  const kpis = calcularKpis(rows);
  grid.innerHTML = KPIS.map(def => {
    const valor = kpis[def.id];
    const cls = classeStatus(valor, def.target, def.minimo);
    const barW = valor == null ? 0 : Math.max(0, Math.min(100, (valor - 85) / 15 * 100)); // zoom 85→100%
    const tick = (p) => Math.max(0, Math.min(100, (p - 85) / 15 * 100));
    return `
    <article class="kpi ${cls}">
      <div class="kpi-top">
        <div class="kpi-name">${def.nome}</div>
      </div>
      <div class="kpi-value">${valor == null ? "—" : fmt(valor, 1)}<small>${valor == null ? "" : "%"}</small><span class="spin" aria-hidden="true"></span></div>
      <div class="kpi-bar">
        <span style="width:${barW}%"></span>
        <i class="tick" style="left:${tick(def.minimo)}%" title="Mínimo ${def.minimo}%"></i>
        <i class="tick" style="left:${tick(def.target)}%" title="Target ${def.target}%"></i>
      </div>
      <div class="kpi-meta">
        <span>Target <b>${fmt(def.target, 1)}%</b></span>
        <span>Mínimo <b>${fmt(def.minimo, 1)}%</b></span>
        ${def.id === "noShow" ? `<span>No shows <b>${kpis._extra.noShows}</b> · fechadas <b>${fmt(kpis._extra.fechadas)}</b></span>` : ""}
      </div>
      <div class="kpi-desc">${def.desc}</div>
    </article>`;
  }).join("");
}

/* ---------- Mapa ---------- */
function initMapa() {
  mapa = L.map("map", { zoomControl: true, attributionControl: true });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd", maxZoom: 19,
  }).addTo(mapa);
  mapa.setView([-21.5, -46.5], 5);
}

function agregarLocais(rows) {
  const pesoDe = (r) => heatPeso === "pacotes" ? (r.pacotes || 0) : 1;
  const pontos = new Map();
  const fluxos = new Map();
  const semCoords = new Set();

  for (const r of rows) {
    for (const [papel, loc] of [["origem", r.origem], ["destino", r.destino]]) {
      if (!loc) continue;
      if (!loc.coords) { if (loc.cidade) semCoords.add(loc.raw); continue; }
      const k = loc.coords.join(",");
      const p = pontos.get(k) || {
        coords: loc.coords, nome: `${loc.cidade} · ${loc.uf}`, tipo: loc.tipo,
        origemPeso: 0, destinoPeso: 0, origemViagens: 0, destinoViagens: 0,
      };
      p[papel + "Peso"] += pesoDe(r);
      p[papel + "Viagens"] += 1;
      pontos.set(k, p);
    }
    if (r.origem?.coords && r.destino?.coords && r.origem.raw !== r.destino.raw) {
      const k = r.origem.raw + "|" + r.destino.raw;
      const f = fluxos.get(k) || { o: r.origem, d: r.destino, viagens: 0, pacotes: 0 };
      f.viagens += 1; f.pacotes += r.pacotes || 0;
      fluxos.set(k, f);
    }
  }
  return { pontos, fluxos, semCoords };
}

function renderMapa(rows) {
  for (const c of [camadaHeat, camadaRotas, camadaNumeros]) if (c) mapa.removeLayer(c);
  camadaHeat = camadaRotas = camadaNumeros = null;

  const { pontos, fluxos, semCoords } = agregarLocais(rows);

  // linhas de fluxo (nas duas vistas)
  camadaRotas = L.layerGroup().addTo(mapa);
  const maxViagens = Math.max(1, ...[...fluxos.values()].map(f => f.viagens));
  for (const f of fluxos.values()) {
    L.polyline([f.o.coords, f.d.coords], {
      color: "#ee4d2d", weight: 1 + (f.viagens / maxViagens) * 5, opacity: mapaVista === "calor" ? .45 : .3,
    }).bindPopup(`<b>${f.o.cidade} → ${f.d.cidade}</b><br>${fmt(f.viagens)} viagens · ${fmt(f.pacotes)} pacotes`)
      .addTo(camadaRotas);
  }

  const valorDoPonto = (p, campo) =>
    heatModo === "origem" ? p["origem" + campo] :
    heatModo === "destino" ? p["destino" + campo] :
    p["origem" + campo] + p["destino" + campo];

  const todasCoords = [];

  if (mapaVista === "calor") {
    const heatPts = [];
    let maxPeso = 0;
    for (const p of pontos.values()) {
      const peso = valorDoPonto(p, "Peso");
      if (peso > 0) { heatPts.push([...p.coords, peso]); maxPeso = Math.max(maxPeso, peso); todasCoords.push(p.coords); }
    }
    if (heatPts.length) {
      camadaHeat = L.heatLayer(heatPts.map(([lat, lng, w]) => [lat, lng, w / maxPeso]), {
        radius: 38, blur: 26, minOpacity: .35,
        gradient: { 0.2: "#2ab3a6", 0.5: "#f5a623", 0.8: "#ee4d2d", 1: "#ff7a5c" },
      }).addTo(mapa);
    }
    for (const p of pontos.values()) {
      if (valorDoPonto(p, "Peso") <= 0) continue;
      L.circleMarker(p.coords, { radius: 5, color: "#fff", weight: 1, fillColor: "#ee4d2d", fillOpacity: .95 })
        .bindPopup(popupPonto(p))
        .addTo(camadaRotas);
    }
    document.getElementById("map-sub").textContent =
      `Intensidade por ${heatPeso} (${heatModo === "ambos" ? "origem + destino" : heatModo}) no período filtrado`;
  } else {
    // vista de números: bolha com o total de viagens por localidade
    camadaNumeros = L.layerGroup().addTo(mapa);
    const maxV = Math.max(1, ...[...pontos.values()].map(p => valorDoPonto(p, "Viagens")));
    for (const p of pontos.values()) {
      const v = valorDoPonto(p, "Viagens");
      if (v <= 0) continue;
      todasCoords.push(p.coords);
      const escala = 30 + Math.sqrt(v / maxV) * 34; // 30–64 px
      const icone = L.divIcon({
        className: "num-bubble-wrap",
        html: `<div class="num-bubble" style="width:${escala}px;height:${escala}px">${fmtCompacto(v)}</div>`,
        iconSize: [escala, escala], iconAnchor: [escala / 2, escala / 2],
      });
      L.marker(p.coords, { icon: icone }).bindPopup(popupPonto(p)).addTo(camadaNumeros);
    }
    document.getElementById("map-sub").textContent =
      `Nº de viagens por localidade (${heatModo === "ambos" ? "saídas + chegadas" : heatModo === "origem" ? "saídas" : "chegadas"})`;
  }

  document.getElementById("seg-peso").style.display = mapaVista === "calor" ? "" : "none";

  if (todasCoords.length) mapa.fitBounds(L.latLngBounds(todasCoords).pad(0.25));

  document.getElementById("map-note").textContent = semCoords.size
    ? `Sem coordenadas mapeadas: ${[...semCoords].join(" · ")} (adicione em COORDS no app.js)`
    : "Todas as localidades do período possuem coordenadas mapeadas.";
}

function popupPonto(p) {
  return `<b>${p.nome}</b><br>${p.tipo || ""}<br>
    Saídas: ${fmt(p.origemViagens)} viagens<br>
    Chegadas: ${fmt(p.destinoViagens)} viagens`;
}

/* ---------- Tabela de rotas ---------- */
function renderRotas(rows) {
  const mapaOD = new Map();
  for (const r of rows) {
    if (!r.origem || !r.destino) continue;
    const k = r.origem.raw + "|" + r.destino.raw;
    const f = mapaOD.get(k) || { o: r.origem, d: r.destino, viagens: 0, pacotes: 0, otdOk: 0, otdTotal: 0 };
    f.viagens += 1;
    f.pacotes += r.pacotes || 0;
    if (r.pacotes && (r.analiseEtaDestino === "NO PRAZO" || r.analiseEtaDestino === "FORA DO PRAZO")) {
      f.otdTotal += r.pacotes;
      if (r.analiseEtaDestino === "NO PRAZO") f.otdOk += r.pacotes;
    }
    mapaOD.set(k, f);
  }
  const linhas = [...mapaOD.values()].sort((a, b) => b.viagens - a.viagens);
  const tbody = document.querySelector("#tbl-rotas tbody");
  tbody.innerHTML = linhas.map(f => {
    const otd = f.otdTotal > 0 ? (f.otdOk / f.otdTotal) * 100 : null;
    const cls = otd == null ? "na" : otd >= 95 ? "ok" : otd >= 93 ? "warn" : "bad";
    return `<tr>
      <td><div class="route-od"><span class="o">${f.o.cidade} · ${f.o.uf}</span><span class="d">${f.d.cidade} · ${f.d.uf}</span></div></td>
      <td class="num">${fmt(f.viagens)}</td>
      <td class="num">${fmt(f.pacotes)}</td>
      <td class="num"><span class="otd-pill ${cls}">${otd == null ? "—" : fmt(otd, 1) + "%"}</span></td>
    </tr>`;
  }).join("") || `<tr><td colspan="4" class="chart-empty">Nenhuma viagem no período selecionado.</td></tr>`;
}

/* ---------- Gráfico de evolução (SVG, com rótulos de dados) ---------- */
function renderChartTempo(rows) {
  const el = document.getElementById("chart-diario");
  const titulo = document.getElementById("chart-titulo");

  // granularidade adaptativa: dia → semana → mês
  const dias = new Set(rows.map(r => r.data).filter(Boolean));
  const semanas = new Set(rows.map(r => r.semanaAno).filter(Boolean));
  let chave, rotulo, unidade;
  if (dias.size <= 31) {
    unidade = "dia";
    chave = r => r.data;
    rotulo = d => { const [, m, dd] = d.split("-"); return `${dd}/${m}`; };
  } else if (semanas.size <= 45) {
    unidade = "semana";
    chave = r => r.semanaAno;
    rotulo = s => s.split(" ")[1];
  } else {
    unidade = "mês";
    chave = r => r.data ? r.data.slice(0, 7) : null;
    rotulo = m => MESES_LABEL[Number(m.slice(5, 7))] + "/" + m.slice(2, 4);
  }
  titulo.textContent = `Viagens por ${unidade}`;

  const grupos = new Map();
  for (const r of rows) {
    const k = chave(r);
    if (!k) continue;
    const g = grupos.get(k) || { viagens: 0, otdOk: 0, otdTotal: 0 };
    g.viagens += 1;
    if (r.pacotes && (r.analiseEtaDestino === "NO PRAZO" || r.analiseEtaDestino === "FORA DO PRAZO")) {
      g.otdTotal += r.pacotes;
      if (r.analiseEtaDestino === "NO PRAZO") g.otdOk += r.pacotes;
    }
    grupos.set(k, g);
  }
  const chaves = [...grupos.keys()].sort();
  if (!chaves.length) { el.innerHTML = `<p class="chart-empty">Nenhuma viagem no período selecionado.</p>`; return; }

  const W = 1000, H = 260, padL = 40, padR = 44, padT = 26, padB = 34;
  const cw = (W - padL - padR) / chaves.length;
  const maxV = Math.max(...chaves.map(k => grupos.get(k).viagens));
  const y = (v) => padT + (H - padT - padB) * (1 - v / maxV);
  const yPct = (p) => padT + (H - padT - padB) * (1 - p / 100);
  const mostrarRotulos = chaves.length <= 40;
  const mostrarEixoX = chaves.length <= 60;

  let barras = "", eixoX = "", labels = "", linha = "", pontosSvg = "", labelsLinha = "";
  const coords = [];
  chaves.forEach((k, i) => {
    const g = grupos.get(k);
    const x = padL + i * cw;
    const bw = Math.min(42, cw * 0.55);
    const bx = x + (cw - bw) / 2;
    barras += `<rect class="bar" x="${bx.toFixed(1)}" y="${y(g.viagens).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - padB - y(g.viagens)).toFixed(1)}" rx="3"><title>${k}: ${g.viagens} viagens</title></rect>`;
    if (mostrarRotulos)
      labels += `<text class="dlabel" x="${(x + cw / 2).toFixed(1)}" y="${(y(g.viagens) - 5).toFixed(1)}" text-anchor="middle">${g.viagens}</text>`;
    if (mostrarEixoX && (mostrarRotulos || i % Math.ceil(chaves.length / 20) === 0))
      eixoX += `<text class="axis" x="${(x + cw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle">${rotulo(k)}</text>`;
    if (g.otdTotal > 0) coords.push([x + cw / 2, yPct((g.otdOk / g.otdTotal) * 100), (g.otdOk / g.otdTotal) * 100, k]);
  });
  if (coords.length) {
    linha = `<polyline class="otd-line" points="${coords.map(c => c[0].toFixed(1) + "," + c[1].toFixed(1)).join(" ")}"/>`;
    pontosSvg = coords.map(c => `<circle class="otd-dot" cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="3"><title>${c[3]}: ${fmt(c[2], 1)}% no prazo</title></circle>`).join("");
    if (mostrarRotulos)
      labelsLinha = coords.map(c => `<text class="dlabel dlabel-teal" x="${c[0].toFixed(1)}" y="${(c[1] - 7).toFixed(1)}" text-anchor="middle">${fmt(c[2], 0)}%</text>`).join("");
  }
  const grid = [0, 50, 100].map(p =>
    `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${yPct(p).toFixed(1)}" y2="${yPct(p).toFixed(1)}"/>
     <text class="axis" x="${W - padR + 6}" y="${(yPct(p) + 3).toFixed(1)}">${p}%</text>`).join("");

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Viagens por ${unidade} e percentual no prazo">${grid}${barras}${linha}${pontosSvg}${labels}${labelsLinha}${eixoX}</svg>`;
}

/* ---------- Gráfico por tipo de veículo (barras horizontais com rótulos) ---------- */
function renderChartVeiculo(rows) {
  const el = document.getElementById("chart-veiculo");
  const grupos = new Map();
  for (const r of rows) {
    if (!r.veiculo) continue;
    const g = grupos.get(r.veiculo) || { viagens: 0, pacotes: 0 };
    g.viagens += 1;
    g.pacotes += r.pacotes || 0;
    grupos.set(r.veiculo, g);
  }
  const itens = [...grupos.entries()].sort((a, b) => b[1].viagens - a[1].viagens);
  if (!itens.length) { el.innerHTML = `<p class="chart-empty">Nenhuma viagem no período selecionado.</p>`; return; }

  const maxV = Math.max(...itens.map(([, g]) => g.viagens));
  el.innerHTML = itens.map(([nome, g]) => `
    <div class="vrow">
      <div class="vname">${nome}</div>
      <div class="vtrack">
        <div class="vbar" style="width:${(g.viagens / maxV * 100).toFixed(1)}%"></div>
        <span class="vvalue">${fmt(g.viagens)} viagens · ${fmt(g.pacotes)} pacotes</span>
      </div>
    </div>`).join("");
}

/* ---------- Ciclo de renderização ---------- */
function renderTudo() {
  montarFiltros();
  const rows = linhasFiltradas();
  renderResumo(rows);
  renderKpis(rows);
  renderMapa(rows);
  renderRotas(rows);
  renderChartTempo(rows);
  renderChartVeiculo(rows);

  const datas = rows.map(r => r.data).filter(Boolean).sort();
  document.getElementById("foot-periodo").textContent = datas.length
    ? `Período exibido: ${datas[0].split("-").reverse().join("/")} a ${datas.at(-1).split("-").reverse().join("/")} · ${fmt(rows.length)} viagens`
    : "Nenhum registro no filtro atual";
}

/* ---------- Carregamento dos dados ---------- */
async function carregarDados() {
  const fonte = document.getElementById("data-source");
  if (CONFIG.SHEETS_API_URL) {
    try {
      const resp = await fetch(CONFIG.SHEETS_API_URL, { redirect: "follow" });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const texto = await resp.text();
      let json;
      try { json = JSON.parse(texto); }
      catch { throw new Error("A resposta não é JSON (verifique se o Web App está implantado com acesso 'Qualquer pessoa')"); }
      if (json && json.error) throw new Error("Apps Script: " + json.error);
      const linhas = Array.isArray(json) ? json : json.rows;
      if (!Array.isArray(linhas)) throw new Error("Formato inesperado");
      fonte.textContent = `Google Sheets · ao vivo (${linhas.length} linhas)`;
      fonte.classList.add("is-live");
      return linhas;
    } catch (err) {
      console.warn("Falha ao buscar do Google Sheets, usando cópia local:", err);
      fonte.textContent = "planilha local (falha na API)";
      fonte.title = String(err.message || err);
      return window.EMBEDDED_DATA || [];
    }
  }
  fonte.textContent = "planilha local";
  return window.EMBEDDED_DATA || [];
}

/* ---------- Eventos ---------- */
function ligarEventos() {
  const liga = (id, chave) => document.getElementById(id).addEventListener("change", (e) => {
    filtro[chave] = e.target.value; // os demais selects são revalidados em montarFiltros()
    renderTudo();
  });
  liga("f-ano", "ano"); liga("f-mes", "mes"); liga("f-semana", "semana"); liga("f-dia", "dia"); liga("f-tsp", "tsp");

  document.getElementById("f-limpar").addEventListener("click", () => {
    filtro = { ano: "", mes: "", semana: "", dia: "", tsp: "" };
    document.getElementById("f-tsp").value = "";
    renderTudo();
  });

  const segToggle = (attr, cb) => document.querySelectorAll(`[data-${attr}]`).forEach(btn =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(`[data-${attr}]`).forEach(b => b.classList.toggle("is-active", b === btn));
      cb(btn.dataset[attr]);
      renderMapa(linhasFiltradas());
    }));
  segToggle("vista", v => mapaVista = v);
  segToggle("heat", v => heatModo = v);
  segToggle("peso", v => heatPeso = v);
}

/* ---------- Atualização manual e automática ---------- */
let atualizando = false;
let timerAuto = null;

async function atualizar() {
  if (atualizando) return;
  atualizando = true;
  document.body.classList.add("is-refreshing");           // mostra os spinners ao lado dos números
  document.getElementById("btn-atualizar").disabled = true;
  try {
    const brutas = await carregarDados();
    DADOS = brutas.map(normalizarLinha).filter(r => r.data || r.semana);
    renderTudo();
    const agora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const fonte = document.getElementById("data-source");
    fonte.textContent = fonte.textContent.replace(/ · atualizado.*$/, "") + ` · atualizado ${agora}`;
  } finally {
    document.body.classList.remove("is-refreshing");
    document.getElementById("btn-atualizar").disabled = false;
    atualizando = false;
  }
}

function reprogramarAuto() {
  if (timerAuto) { clearInterval(timerAuto); timerAuto = null; }
  const min = Number(document.getElementById("f-intervalo").value);
  if (min > 0) timerAuto = setInterval(atualizar, min * 60 * 1000);
}

function ligarEventosAtualizacao() {
  document.getElementById("btn-atualizar").addEventListener("click", atualizar);
  document.getElementById("f-intervalo").addEventListener("change", reprogramarAuto);
}

/* ---------- Boot ---------- */
(async function init() {
  initMapa();
  ligarEventos();
  ligarEventosAtualizacao();
  await atualizar();
})();
