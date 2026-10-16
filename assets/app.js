/* Night-time lights dashboard — static site, no server, no Earth Engine at viewing time.
 * Data: data/countries.json and data/<ISO3>/*.json|csv|geojson|png written by src/export.py. */
"use strict";

const S = { iso: null, d: {}, rendered: {}, map: null, mapB: null, mapMode: "choro" };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const PAGES = ["overview", "map", "time", "regions", "shocks", "inequality", "method", "data"];

/* ---------------------------------------------------------------- formatting (fr-FR) */
const nf = (d = 0) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const F = {
  pct: (v, d = 1) => (isNum(v) ? (v > 0 ? "+" : "") + nf(d).format(100 * v) + " %" : "–"),
  pct0: (v) => (isNum(v) ? nf(0).format(100 * v) + " %" : "–"),
  share: (v, d = 0) => (isNum(v) ? nf(d).format(100 * v) + " %" : "–"),
  num: (v, d = 0) => (isNum(v) ? nf(d).format(v) : "–"),
  num2: (v) => (isNum(v) ? nf(2).format(v) : "–"),
  people: (v) => (!isNum(v) ? "–" : v >= 1e6 ? nf(2).format(v / 1e6) + " M" : v >= 1e3 ? nf(0).format(v / 1e3) + " k" : nf(0).format(v)),
  usd: (v) => (!isNum(v) ? "–" : v >= 1e9 ? nf(1).format(v / 1e9) + " Md$" : nf(0).format(v / 1e6) + " M$"),
  date: (s) => (s ? new Date(s).toLocaleDateString("fr-FR", { month: "short", year: "numeric" }) : "–"),
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

/* ---------------------------------------------------------------- data loading */
async function getJSON(url) { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(url + " " + r.status); return r.json(); }
async function getCSV(url) { const r = await fetch(url, { cache: "no-cache" }); if (!r.ok) throw new Error(url + " " + r.status); return parseCSV(await r.text()); }

function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f.length || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.length === head.length).map((r) => {
    const o = {};
    head.forEach((h, j) => { const v = r[j]; o[h] = v === "" ? null : v === "True" ? true : v === "False" ? false : isNaN(+v) ? v : +v; });
    return o;
  });
}

async function loadCountry(iso) {
  const base = `data/${iso}/`;
  const want = {
    meta: getJSON(base + "meta.json"), summary: getJSON(base + "summary.json"),
    regions: getCSV(base + "regions.csv"), annual: getCSV(base + "annual_units.csv"),
    monthly: getCSV(base + "monthly_national.csv"), madm1: getCSV(base + "monthly_adm1.csv"),
    gdp: getJSON(base + "gdp.json"), shocks: getJSON(base + "shocks.json"), ineq: getJSON(base + "inequality.json"),
    growth: getJSON(base + "growth.json"),
    adm0: getJSON(base + "adm0.geojson"), adm1: getJSON(base + "adm1.geojson"), adm2: getJSON(base + "adm2.geojson"),
  };
  const keys = Object.keys(want);
  const res = await Promise.allSettled(Object.values(want));
  const d = {};
  res.forEach((r, i) => { d[keys[i]] = r.status === "fulfilled" ? r.value : null; });
  if (!d.meta || !d.summary) throw new Error("Données introuvables pour " + iso);
  S.iso = iso; S.d = d; S.rendered = {};
  d.names = Object.fromEntries((d.regions || []).map((r) => [r.unit_id, r.name]));
  return d;
}

/* ---------------------------------------------------------------- plotting helpers */
function layout(extra = {}) {
  const ink2 = css("--ink-2"), grid = css("--grid"), axis = css("--axis"), surf = css("--surface");
  const base = {
    paper_bgcolor: surf, plot_bgcolor: surf, separators: ", ",
    font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", size: 12, color: ink2 },
    margin: { l: 56, r: 16, t: 18, b: 44 }, hovermode: "closest",
    hoverlabel: { bgcolor: surf, bordercolor: axis, font: { color: css("--ink") } },
    legend: { orientation: "h", x: 0, y: 1.12, font: { size: 11 } },
    xaxis: { gridcolor: "rgba(0,0,0,0)", linecolor: axis, zeroline: false, automargin: true, tickcolor: axis },
    yaxis: { gridcolor: grid, linecolor: axis, zeroline: false, automargin: true },
  };
  for (const k of Object.keys(extra)) base[k] = typeof extra[k] === "object" && !Array.isArray(extra[k]) && base[k] ? { ...base[k], ...extra[k] } : extra[k];
  return base;
}
function plot(id, traces, lay = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!window.Plotly) { el.innerHTML = '<p class="help">Bibliothèque de graphiques indisponible.</p>'; return; }
  if (!traces || !traces.length) { el.innerHTML = '<p class="help">Donnée non disponible pour ce pays ou cette période.</p>'; el.style.height = "auto"; return; }
  Plotly.react(el, traces, layout(lay), { responsive: true, displayModeBar: false });
}
const C = () => ({ s: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => css(`--s${i}`)), grow: css("--grow"), flat: css("--flat"), decline: css("--decline"),
  ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), axis: css("--axis"), grid: css("--grid"), surface: css("--surface") });
const CLASS_COL = (c) => ({ Croissance: C().grow, Stagnation: C().flat, "Déclin": C().decline }[c] || C().grid);

/* ---------------------------------------------------------------- header / routing */
function renderHeader() {
  const m = S.d.meta;
  $("#country-title").textContent = `${m.name} · ${m.period[0]}–${m.period[1]}`;
  document.title = `${m.name} — lumières nocturnes et activité économique`;
  $("#synthetic-banner").hidden = !m.synthetic;
  $("#foot").innerHTML = `Mis à jour le ${new Date(m.generated_at).toLocaleString("fr-FR")} · Données VIIRS (NOAA/EOG, NASA), ` +
    `limites ${esc((m.boundaries && m.boundaries.ADM1) || "geoBoundaries")}, population ${esc(m.pop_source || "GHSL")}, ` +
    `Banque mondiale · Code et méthode : voir la page « Méthode & limites ».`;
}

function route() {
  const page = (location.hash || "#overview").slice(1).split("?")[0];
  const p = PAGES.includes(page) ? page : "overview";
  PAGES.forEach((x) => { $("#page-" + x).hidden = x !== p; });
  $$(".tabs a").forEach((a) => { if (a.dataset.page === p) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (!S.rendered[p]) {
    try { RENDER[p](); } catch (e) { console.error(e); }
    S.rendered[p] = true;
  }
  if (p === "map" && S.map) setTimeout(() => S.map.resize(), 50);
  window.dispatchEvent(new Event("resize"));
}

/* ================================================================ PAGES */
const RENDER = {};

RENDER.overview = () => {
  const { meta, summary, monthly } = S.d;
  $("#lede").textContent = `Ce tableau de bord mesure l'activité économique de ${meta.name} à partir des lumières émises la nuit ` +
    `et observées par satellite. Plus une zone produit, échange et consomme d'électricité, plus elle brille : la lumière ` +
    `est un indicateur indirect, disponible partout, chaque mois, y compris là où les statistiques manquent.`;
  $("#kpis").innerHTML = summary.kpis.map((k) => {
    const v = k.fmt === "pct" ? F.pct(k.value) : k.fmt === "pct0" ? F.share(k.value) : k.fmt === "people" ? F.people(k.value) : F.num2(k.value);
    return `<div class="kpi"><div class="label">${esc(k.label)}</div><div class="value">${v}</div><div class="sub">${esc(k.sub)}</div></div>`;
  }).join("");
  $("#messages").innerHTML = summary.messages.map((m) =>
    `<li><span class="theme">${esc(m.theme)}</span> <span class="badge ${esc(m.confidence)}" title="${esc(m.why)}">confiance ${esc(m.confidence)}</span>` +
    `<div>${esc(m.text)}</div><div class="why">${esc(m.why)}</div></li>`).join("");
  const c = C();
  plot("ov-series", monthly ? [
    { x: monthly.map((r) => r.date), y: monthly.map((r) => r.obs), name: "Observée", mode: "lines", line: { color: c.axis, width: 1.4 }, hovertemplate: "%{x|%b %Y}<br>%{y:,.0f}<extra>Observée</extra>" },
    { x: monthly.map((r) => r.date), y: monthly.map((r) => r.sa), name: "Désaisonnalisée", mode: "lines", line: { color: c.s[0], width: 2.2 }, hovertemplate: "%{x|%b %Y}<br>%{y:,.0f}<extra>Désaisonnalisée</extra>" },
  ] : [], { yaxis: { title: { text: "Somme des radiances" } } });
};

/* ---------------------------------------------------------------- time */
RENDER.time = () => {
  const { monthly, shocks, madm1, gdp } = S.d; const c = C();
  if (monthly) {
    const shapes = [], ann = [];
    (shocks?.events || []).forEach((e) => {
      shapes.push({ type: "rect", xref: "x", yref: "paper", x0: e.start, x1: e.end, y0: 0, y1: 1, fillcolor: c.flat, opacity: 0.18, line: { width: 0 } });
      ann.push({ x: e.start, y: 1, xref: "x", yref: "paper", text: esc(e.label), showarrow: false, xanchor: "left", yanchor: "bottom", font: { size: 11, color: c.ink2 } });
    });
    (shocks?.breaks || []).forEach((b) => {
      shapes.push({ type: "line", xref: "x", yref: "paper", x0: b.date, x1: b.date, y0: 0, y1: 1, line: { color: c.s[6], width: 1.5, dash: "dash" } });
      ann.push({ x: b.date, y: 0.02, xref: "x", yref: "paper", text: `rupture ${F.pct(b.jump_pct / 100, 0)}`, showarrow: false, xanchor: "left", font: { size: 10, color: c.s[6] } });
    });
    const an = monthly.filter((r) => r.anomaly);
    plot("t-series", [
      { x: monthly.map((r) => r.date), y: monthly.map((r) => r.obs), name: "Observée", mode: "lines", line: { color: c.axis, width: 1.4 } },
      { x: monthly.map((r) => r.date), y: monthly.map((r) => r.sa), name: "Désaisonnalisée", mode: "lines", line: { color: c.s[0], width: 2.2 } },
      { x: monthly.map((r) => r.date), y: monthly.map((r) => r.trend), name: "Tendance", mode: "lines", line: { color: c.ink2, width: 1.4, dash: "dot" } },
      { x: an.map((r) => r.date), y: an.map((r) => r.obs), name: "Mois anormal", mode: "markers", marker: { color: c.s[1], size: 9, line: { color: c.surface, width: 2 } } },
    ], { shapes, annotations: ann, hovermode: "x unified", yaxis: { title: { text: "Somme des radiances (nW·cm⁻²·sr⁻¹)" } } });
    const byDate = new Map(monthly.map((r) => [r.date, r.obs]));
    const yoy = monthly.map((r) => { const d = new Date(r.date); d.setFullYear(d.getFullYear() - 1); const p = byDate.get(d.toISOString().slice(0, 10)); return p ? r.obs / p - 1 : null; });
    plot("t-yoy", [{ type: "bar", x: monthly.map((r) => r.date), y: yoy.map((v) => (v == null ? null : 100 * v)),
      marker: { color: yoy.map((v) => (v == null ? c.grid : v >= 0 ? c.grow : c.decline)) }, hovertemplate: "%{x|%b %Y}<br>%{y:.1f} %<extra></extra>", showlegend: false }],
    { yaxis: { title: { text: "Variation sur 12 mois (%)" }, zeroline: true, zerolinecolor: c.axis }, bargap: 0.15 });
  }
  if (madm1 && madm1.length) {
    const by = {}; madm1.forEach((r) => { (by[r.unit_id] = by[r.unit_id] || []).push(r); });
    const size = Object.entries(by).map(([k, v]) => [k, v[v.length - 1].sa]).sort((a, b) => b[1] - a[1]);
    const top = size.slice(0, 6).map((x) => x[0]);
    const traces = top.map((uid, i) => {
      const v = by[uid]; const base = v.slice(0, 12).reduce((s, r) => s + r.sa, 0) / Math.min(12, v.length);
      return { x: v.map((r) => r.date), y: v.map((r) => (100 * r.sa) / base), name: S.d.names[uid] || uid, mode: "lines", line: { color: c.s[i], width: 1.8 },
        hovertemplate: "%{x|%b %Y}<br>%{y:.0f}<extra>%{fullData.name}</extra>" };
    });
    plot("t-regions", traces, { yaxis: { title: { text: "Indice (100 = 1ʳᵉ année)" } }, legend: { y: 1.22 } });
  } else plot("t-regions", []);
  renderGDP();
};

function renderGDP() {
  const g = S.d.gdp; const c = C();
  if (!g || !g.available || !g.levels) { plot("g-scatter", []); plot("g-track", []); $("#g-table").innerHTML = '<p class="help">PIB officiel indisponible : la relation ne peut pas être estimée.</p>'; return; }
  const L = g.levels, pts = L.points;
  const xs = pts.map((p) => p.lx), lo = Math.min(...xs), hi = Math.max(...xs);
  const a = pts.reduce((s, p) => s + p.fitted - L.beta * p.lx, 0) / pts.length;
  plot("g-scatter", [
    { x: xs, y: pts.map((p) => p.ly), text: pts.map((p) => String(p.year)), mode: "markers+text", textposition: "top center", textfont: { size: 10, color: c.muted },
      marker: { color: c.s[0], size: 10, line: { color: c.surface, width: 2 } }, name: "Années", hovertemplate: "%{text}<br>log PIB %{x:.3f}<br>log lumière %{y:.3f}<extra></extra>" },
    { x: [lo, hi], y: [a + L.beta * lo, a + L.beta * hi], mode: "lines", line: { color: c.s[0], width: 2 }, name: `β = ${F.num2(L.beta)}`, hoverinfo: "skip" },
  ], { xaxis: { title: { text: "log PIB réel (USD constants 2015)" } }, yaxis: { title: { text: "log somme des lumières" } } });
  const row = (lab, e) => !e ? "" : `<tr><td>${lab}</td><td>${F.num2(e.beta)}</td><td>[${F.num2(e.ci[0])} ; ${F.num2(e.ci[1])}]</td><td>${F.num2(e.r2)}</td><td>${e.n}</td>` +
    `<td>${F.num2(e.diagnostics?.durbin_watson)}</td><td><span class="badge ${esc(e.confidence)}">${esc(e.confidence)}</span></td></tr>`;
  $("#g-table").innerHTML = `<div class="table-wrap"><table class="data"><thead><tr><th>Spécification</th><th>β</th><th>IC 95 %</th><th>R²</th><th>n</th><th>DW</th><th>Confiance</th></tr></thead><tbody>` +
    row("Niveaux (VIIRS)", g.levels) + row("Taux de croissance", g.growth) + row("Série longue harmonisée", g.long) + `</tbody></table></div>` +
    `<p class="help">DW : statistique de Durbin–Watson (proche de 2 = pas d'autocorrélation des résidus). Une élasticité estimée sur une dizaine d'années reste fragile.</p>`;
  const tr = g.tracking || [];
  const traces = [
    { x: tr.map((r) => r.year), y: tr.map((r) => 100 * r.dl_gdp), name: "Officielle (Banque mondiale)", mode: "lines+markers", line: { color: c.ink2, width: 2 }, marker: { size: 7 } },
    { x: tr.map((r) => r.year), y: tr.map((r) => (r.dl_gdp_loo == null ? null : 100 * r.dl_gdp_loo)), name: "Estimée par les lumières (hors échantillon)", mode: "lines+markers", line: { color: c.s[0], width: 2, dash: "dot" }, marker: { size: 7 } },
  ];
  const nc = g.nowcast?.estimates || [];
  if (nc.length) {
    const prev = (yr) => (g.table.find((t) => t.year === yr - 1) || {}).gdp_const_usd;
    traces.push({ x: nc.map((r) => r.year), y: nc.map((r) => 100 * r.growth_est), name: "Estimation (année non publiée)", mode: "markers",
      marker: { color: c.s[1], size: 11, symbol: "diamond", line: { color: c.surface, width: 2 } },
      error_y: { type: "data", symmetric: false, color: c.s[1],
        array: nc.map((r, i) => 100 * ((r.hi80 / (i ? nc[i - 1].gdp_est : prev(r.year) || r.gdp_est / (1 + r.growth_est))) - 1) - 100 * r.growth_est),
        arrayminus: nc.map((r, i) => 100 * r.growth_est - 100 * ((r.lo80 / (i ? nc[i - 1].gdp_est : prev(r.year) || r.gdp_est / (1 + r.growth_est))) - 1)) } });
  }
  plot("g-track", traces, { yaxis: { title: { text: "Croissance du PIB réel (%)" }, zeroline: true, zerolinecolor: c.axis }, xaxis: { dtick: 1 } });
}

/* ---------------------------------------------------------------- regions */
RENDER.regions = () => {
  const levels = S.d.meta.levels || ["ADM1"];
  const seg = $("#reg-level");
  seg.innerHTML = levels.map((lv, i) => `<button type="button" data-lv="${lv}" class="${i === levels.length - 1 ? "on" : ""}">${lv === "ADM1" ? "Régions (ADM1)" : "Districts (ADM2)"}</button>`).join("");
  S.regLevel = levels[levels.length - 1];
  seg.onclick = (e) => { const b = e.target.closest("button"); if (!b) return; $$("button", seg).forEach((x) => x.classList.toggle("on", x === b)); S.regLevel = b.dataset.lv; drawRegions(); };
  $("#reg-search").oninput = () => drawTable();
  drawRegions();
};

function drawRegions() {
  const c = C(); const lv = S.regLevel;
  let rows = (S.d.regions || []).filter((r) => r.level === lv && isNum(r.growth));
  rows.sort((a, b) => a.growth - b.growth);
  if (rows.length > 30) rows = [...rows.slice(0, 15), ...rows.slice(-15)];
  const classes = ["Déclin", "Stagnation", "Croissance"];
  plot("r-rank", classes.map((cl) => {
    const v = rows.filter((r) => r.class === cl);
    return { type: "bar", orientation: "h", name: cl, y: v.map((r) => r.name), x: v.map((r) => 100 * r.growth), marker: { color: CLASS_COL(cl) },
      error_x: { type: "data", symmetric: false, array: v.map((r) => 100 * (r.growth_hi - r.growth)), arrayminus: v.map((r) => 100 * (r.growth - r.growth_lo)), color: c.axis, thickness: 1 },
      hovertemplate: "%{y}<br>%{x:.1f} %/an<extra>%{fullData.name}</extra>" };
  }).filter((t) => t.y.length), { yaxis: { categoryorder: "array", categoryarray: rows.map((r) => r.name), gridcolor: "rgba(0,0,0,0)", automargin: true },
    xaxis: { title: { text: "Croissance annuelle de la lumière (%/an)" }, zeroline: true, zerolinecolor: c.axis }, barmode: "overlay", margin: { l: 10 } });
  const gr = S.d.growth;
  const conc = gr?.concentration?.[lv] || [];
  plot("r-conc", conc.length ? [
    { x: conc.map((r) => r.year), y: conc.map((r) => 100 * r.top1_share), name: "1ʳᵉ unité", mode: "lines+markers", line: { color: c.s[0], width: 2 } },
    { x: conc.map((r) => r.year), y: conc.map((r) => 100 * r.top10pct_share), name: "10 % d'unités les plus lumineuses", mode: "lines+markers", line: { color: c.s[1], width: 2 } },
  ] : [], { yaxis: { title: { text: "Part de la lumière nationale (%)" }, rangemode: "tozero" }, xaxis: { dtick: 1 } });
  const b = gr?.beta, bd = gr?.beta_data || [];
  if (bd.length && b && b.level === lv) {
    const xs = bd.map((r) => Math.log(r.init)); const lo = Math.min(...xs), hi = Math.max(...xs);
    const my = bd.reduce((s, r) => s + r.g, 0) / bd.length, mx = xs.reduce((s, x) => s + x, 0) / xs.length;
    plot("r-beta", [
      { x: xs, y: bd.map((r) => 100 * r.g), text: bd.map((r) => S.d.names[r.unit_id] || r.unit_id), mode: "markers", name: "Unités",
        marker: { color: c.s[0], size: 8, opacity: 0.8, line: { color: c.surface, width: 1 } }, hovertemplate: "%{text}<br>%{y:.1f} %/an<extra></extra>" },
      { x: [lo, hi], y: [100 * (my + b.beta * (lo - mx)), 100 * (my + b.beta * (hi - mx))], mode: "lines", name: `β = ${F.num(b.beta, 3)}`, line: { color: c.s[1], width: 2 } },
    ], { xaxis: { title: { text: `log lumière par habitant initiale (${b.first_year})` } }, yaxis: { title: { text: "Croissance de la lumière/hab. (%/an)" } } });
  } else plot("r-beta", []);
  drawTable();
}

const TABLE_COLS = [
  { k: "name", t: "Unité", f: (v) => esc(v) },
  { k: "sol", t: "Somme des lumières", f: (v) => F.num(v) },
  { k: "share_last", t: "Part nationale", f: (v) => F.share(v, 1) },
  { k: "growth", t: "Croissance %/an", f: (v) => F.pct(v) },
  { k: "class", t: "Classe", f: (v) => (v ? `<span class="pill" style="background:${CLASS_COL(v)}">${esc(v)}</span>` : "") },
  { k: "sol_pc", t: "Lumière/hab.", f: (v) => F.num(v, 3) },
  { k: "dark_share", t: "Pop. dans le noir", f: (v) => F.share(v) },
  { k: "gdp_pc_est", t: "PIB/hab. estimé (USD)", f: (v) => F.num(v), lv: "ADM1" },
];
function drawTable() {
  const lv = S.regLevel, q = ($("#reg-search").value || "").toLowerCase();
  const cols = TABLE_COLS.filter((c) => !c.lv || c.lv === lv);
  const parents = Object.fromEntries((S.d.adm2?.features || []).map((f) => [f.properties.unit_id, f.properties.parent_name]));
  let rows = (S.d.regions || []).filter((r) => r.level === lv).map((r) => ({ ...r, parent_name: parents[r.unit_id] }))
    .filter((r) => !q || String(r.name).toLowerCase().includes(q));
  const sk = S.sortKey || "sol", dir = S.sortDir || -1;
  rows.sort((a, b) => { const x = a[sk], y = b[sk]; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * dir; });
  const t = $("#r-table");
  t.innerHTML = `<caption class="sr">Indicateurs par unité ${lv}</caption><thead><tr>${cols.map((c) =>
    `<th scope="col" data-k="${c.k}" ${c.k === sk ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""}>${c.t}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${c.f(r[c.k])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  t.querySelector("thead").onclick = (e) => { const th = e.target.closest("th"); if (!th) return; const k = th.dataset.k;
    S.sortDir = S.sortKey === k ? -(S.sortDir || -1) : -1; S.sortKey = k; drawTable(); };
}

/* ---------------------------------------------------------------- shocks */
RENDER.shocks = () => {
  const s = S.d.shocks || {}; const c = C();
  const imp = (s.impacts || []).filter((r) => r.computable);
  $("#s-table").innerHTML = imp.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Événement</th><th>Période</th><th>Creux</th><th>Date du creux</th>` +
    `<th>Écart à la tendance</th><th>Récupération</th><th>Distinct du bruit</th></tr></thead><tbody>` + imp.map((r) =>
    `<tr><td>${esc(r.label)}</td><td>${F.date(r.start)} – ${F.date(r.end)}</td><td>${F.pct(r.trough_pct / 100)}</td><td>${F.date(r.trough_date)}</td>` +
    `<td>${F.pct(r.gap_vs_trend_pct / 100)}</td><td>${r.recovered ? r.months_to_recovery + " mois" : "non rétabli"}</td><td>${r.distinguishable_from_noise ? "oui" : "non"}</td></tr>`).join("") +
    `</tbody></table></div>` : '<p class="help">Aucun événement de la liste ne recoupe la période observée. Ajoutez vos événements dans <code>custom_events</code>.</p>';
  const wins = Object.keys(s.daily || {});
  const ws = $("#s-window"); ws.innerHTML = wins.map((w) => `<option value="${esc(w)}">${esc(((s.events || []).find((e) => e.id === w) || {}).label || w)}</option>`).join("");
  const drawDaily = () => {
    const d = (s.daily || {})[ws.value] || [];
    plot("s-daily", d.length ? [
      { x: d.map((r) => r.date), y: d.map((r) => r.index), mode: "markers", name: "Indice journalier", marker: { color: c.axis, size: 4 } },
      { x: d.map((r) => r.date), y: d.map((r) => r.index_smooth), mode: "lines", name: "Médiane mobile 7 jours", line: { color: c.s[0], width: 2.2 } },
    ] : [], { yaxis: { title: { text: "Indice (100 = médiane des 60 premiers jours)" } },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 100, y1: 100, line: { color: c.muted, width: 1, dash: "dot" } }] });
  };
  ws.onchange = drawDaily; drawDaily();
  const evs = [...new Set((s.regional || []).map((r) => r.event))];
  const es = $("#s-event"); es.innerHTML = evs.map((e) => `<option value="${esc(e)}">${esc(((s.events || []).find((x) => x.id === e) || {}).label || e)}</option>`).join("");
  const drawReg = () => {
    const v = (s.regional || []).filter((r) => r.event === es.value).sort((a, b) => b.trough_pct - a.trough_pct);
    plot("s-regional", v.length ? [{ type: "bar", orientation: "h", y: v.map((r) => S.d.names[r.unit_id] || r.unit_id), x: v.map((r) => r.trough_pct),
      marker: { color: v.map((r) => (r.trough_pct < 0 ? c.decline : c.grow)) }, customdata: v.map((r) => (r.recovered ? r.months_to_recovery + " mois" : "non rétabli")),
      hovertemplate: "%{y}<br>creux %{x:.1f} %<br>récupération : %{customdata}<extra></extra>", showlegend: false }] : [],
    { xaxis: { title: { text: "Creux par rapport au niveau d'avant-choc (%)" }, zeroline: true, zerolinecolor: c.axis }, yaxis: { automargin: true, gridcolor: "rgba(0,0,0,0)" }, margin: { l: 10 } });
  };
  es.onchange = drawReg; drawReg();
  const un = new Set((s.unexplained_breaks || []).map((b) => b.date));
  $("#s-breaks").innerHTML = (s.breaks || []).length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Saut de niveau</th>` +
    `<th>Pente avant</th><th>Pente après</th><th>Événement connu à ±6 mois</th></tr></thead><tbody>` + s.breaks.map((b) =>
    `<tr><td>${F.date(b.date)}</td><td>${F.pct(b.jump_pct / 100)}</td><td>${F.pct(b.slope_before_pct_yr / 100)}/an</td><td>${F.pct(b.slope_after_pct_yr / 100)}/an</td>` +
    `<td>${un.has(b.date) ? "<strong>non — à documenter</strong>" : "oui"}</td></tr>`).join("") + "</tbody></table></div>"
    : '<p class="help">Aucune rupture significative détectée.</p>';
};

/* ---------------------------------------------------------------- inequality */
RENDER.inequality = () => {
  const q = S.d.ineq; const c = C();
  if (!q) return;
  const years = Object.keys(q.lorenz);
  plot("i-lorenz", [{ x: [0, 1], y: [0, 1], mode: "lines", name: "Égalité parfaite", line: { color: c.axis, dash: "dash", width: 1 } },
    ...years.map((y, i) => ({ x: q.lorenz[y].q, y: q.lorenz[y].l, mode: "lines", name: `${y} (Gini ${F.num2(q.gini_years[y])})`, line: { color: c.s[i], width: 2.2 },
      hovertemplate: "%{x:.0%} de la population<br>%{y:.0%} de la lumière<extra></extra>" }))],
  { xaxis: { tickformat: ".0%", range: [0, 1], title: { text: "Part cumulée de la population" } }, yaxis: { tickformat: ".0%", range: [0, 1], title: { text: "Part cumulée de la lumière" } } });
  const s = q.series;
  plot("i-gini", [{ x: s.map((r) => r.year), y: s.map((r) => r.gini), mode: "lines+markers", name: "Gini", line: { color: c.s[0], width: 2 }, showlegend: false }],
    { yaxis: { title: { text: "Gini de la lumière par habitant" } }, xaxis: { dtick: 1 } });
  const hasDec = s.some((r) => isNum(r.theil_between));
  plot("i-theil", hasDec ? [
    { type: "bar", x: s.map((r) => r.year), y: s.map((r) => r.theil_between), name: "Entre régions", marker: { color: c.s[0] } },
    { type: "bar", x: s.map((r) => r.year), y: s.map((r) => r.theil_within), name: "Dans les régions", marker: { color: c.s[2] } },
  ] : [{ type: "bar", x: s.map((r) => r.year), y: s.map((r) => r.theil), name: "Theil T", marker: { color: c.s[0] } }],
  { barmode: "stack", bargap: 0.25, yaxis: { title: { text: "Theil T" } }, xaxis: { dtick: 1 } });
  // access: NTL-based vs World Bank, band = sensitivity to the radiance threshold
  const sens = q.dark_sensitivity || [];
  const yrs = [...new Set(sens.map((r) => r.year))].sort();
  const acc = (r) => 100 * (1 - r.dark_share);
  const band = yrs.map((y) => { const v = sens.filter((r) => r.year === y).map(acc).filter(isNum); return [Math.min(...v), Math.max(...v)]; });
  const nat = q.national || [];
  const tr = [];
  if (yrs.length) tr.push({ x: [...yrs, ...yrs.slice().reverse()], y: [...band.map((b) => b[1]), ...band.map((b) => b[0]).reverse()], fill: "toself", fillcolor: "rgba(235,104,52,.15)",
    line: { width: 0 }, name: "Plage selon le seuil", hoverinfo: "skip" });
  tr.push({ x: nat.map((r) => r.year), y: nat.map((r) => 100 * r.lit_pop_share), mode: "lines+markers", name: "Population habitée en zone éclairée (lumières)", line: { color: c.s[1], width: 2 } });
  const ac = q.access_comparison || [];
  if (ac.length) tr.push({ x: ac.map((r) => r.year), y: ac.map((r) => r.elec_access_pct), mode: "lines+markers", name: "Accès à l'électricité (Banque mondiale)", line: { color: c.ink2, width: 2, dash: "dot" } });
  plot("i-dark", tr, { yaxis: { title: { text: "% de la population" }, range: [0, 100] }, xaxis: { dtick: 1 }, legend: { y: 1.25 } });
  const lv = q.level; const u = (S.d.regions || []).filter((r) => r.level === lv && isNum(r.pop_dark)).sort((a, b) => b.pop_dark - a.pop_dark).slice(0, 15).reverse();
  plot("i-dark-units", u.length ? [{ type: "bar", orientation: "h", y: u.map((r) => r.name), x: u.map((r) => r.pop_dark), marker: { color: c.s[1] },
    customdata: u.map((r) => 100 * r.dark_share), hovertemplate: "%{y}<br>%{x:,.0f} personnes<br>%{customdata:.0f} % de la pop. habitée<extra></extra>", showlegend: false }] : [],
  { xaxis: { title: { text: "Personnes en zone habitée non éclairée" } }, yaxis: { automargin: true, gridcolor: "rgba(0,0,0,0)" }, margin: { l: 10 } });
  plot("i-urban", nat.some((r) => isNum(r.urban_rural_ratio)) ? [{ x: nat.map((r) => r.year), y: nat.map((r) => r.urban_rural_ratio), mode: "lines+markers",
    line: { color: c.s[0], width: 2 }, showlegend: false, hovertemplate: "%{x}<br>× %{y:.1f}<extra></extra>" }] : [],
  { yaxis: { title: { text: "Ratio urbain / rural" }, rangemode: "tozero" }, xaxis: { dtick: 1 } });
};

/* ---------------------------------------------------------------- method */
RENDER.method = () => {
  const m = S.d.meta, s = S.d.summary, p = m.config || {};
  const ds = (m.availability || []).map((r) => `<tr><td><code>${esc(r.id)}</code></td><td>${esc(r.status)}</td><td>${esc(r.first || "")} → ${esc(r.last || "")}</td></tr>`).join("");
  const ver = Object.entries(m.versions || {}).map(([k, v]) => `<code>${esc(k)} ${esc(v)}</code>`).join(" · ");
  $("#method").innerHTML = `
  <h2>Pourquoi les lumières nocturnes mesurent l'économie</h2>
  <p>L'éclairage nocturne suit la production, la consommation d'énergie et la densité des activités. Henderson, Storeygard et Weil (2012)
  ont montré que la croissance des lumières suit celle du PIB, surtout là où les comptes nationaux sont fragiles. La lumière n'est
  pas le PIB : c'est un <em>indicateur indirect</em>, utile pour la granularité spatiale et la rapidité.</p>
  <h2>Chaîne de traitement</h2>
  <ol>
    <li><strong>Couverture nuageuse</strong> : pixels mensuels avec moins de ${esc(p.cf_cvg_min)} observations sans nuage exclus ; unité-mois
      conservée si au moins ${F.share(p.min_valid_frac)} des pixels sont observés, puis remise à l'échelle.</li>
    <li><strong>Valeurs négatives et aberrantes</strong> : négatifs mis à 0 ; plafond à ${F.num(p.radiance_cap)} nW ; pics mensuels supérieurs à
      ${esc(p.spike_factor)} × la médiane annuelle remplacés par cette médiane.</li>
    <li><strong>Fond</strong> : pixels non éclairés dans le composite annuel VNL V2 (fond et lumières éphémères masqués par l'EOG) mis à 0.</li>
    <li><strong>Torchères</strong> : mode « ${esc(p.flare_mode)} » — pixels ≥ ${esc(p.flare_rad_min)} nW, moins de ${esc(p.flare_pop_max)} habitants, non bâtis,
      union sur les années, halo de ${F.num(p.flare_buffer_m)} m retiré.</li>
    <li><strong>Désaisonnalisation</strong> : STL robuste (période 12) sur log(somme des lumières) ; anomalies : |z robuste| ≥ ${F.num(p.anomaly_z, 1)} et écart ≥ ${F.share(p.anomaly_min_effect)} ;
      ruptures : segmentation binaire à coût linéaire par morceaux, pénalité de type BIC.</li>
    <li><strong>Croissance régionale</strong> : pente de Theil–Sen sur log(lumière), test de Mann–Kendall ; croissance / déclin si |pente| ≥
      ${F.share(p.growth_threshold)} par an et p < ${F.num(p.alpha, 2)}.</li>
    <li><strong>PIB</strong> : log(lumière) ~ log(PIB réel) en niveaux et en taux de croissance, MCO, écarts-types HAC (Newey–West),
      diagnostics Durbin–Watson, Breusch–Pagan, Jarque–Bera.</li>
    <li><strong>Accès à l'électricité</strong> : population (${esc(m.pop_source || p.pop_source)}) des pixels de plus de ${esc(p.pop_min)} habitants dont la radiance est
      inférieure à ${F.num(p.noise_floor, 2)} nW (sensibilité : ${(p.dark_thresholds || []).map((t) => F.num(t, 2)).join(" / ")}).</li>
  </ol>
  <h2>Niveaux de confiance</h2>
  <p><span class="badge élevée">élevée</span> résultat significatif, échantillon suffisant, peu sensible aux choix ;
  <span class="badge moyenne">moyenne</span> significatif mais échantillon court ou sensible aux seuils ;
  <span class="badge faible">faible</span> non significatif, extrapolation ou forte dépendance aux hypothèses.</p>
  <h2>Limites et biais</h2>
  <ul>${(s.limits || []).map((l) => `<li><strong>${esc(l.title)}</strong> — ${esc(l.text)}</li>`).join("")}</ul>
  <h2>Recommandations</h2>
  <ul>${(s.recommendations || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
  <h2>Jeux de données et disponibilité vérifiée</h2>
  <div class="table-wrap"><table><thead><tr><th>Identifiant</th><th>Statut</th><th>Couverture</th></tr></thead><tbody>${ds}</tbody></table></div>
  <p>Limites administratives : ${esc(Object.entries(m.boundaries || {}).map(([k, v]) => `${k} ${v}`).join(", "))}.</p>
  <h2>Reproductibilité</h2>
  <p>Exécution du ${new Date(m.generated_at).toLocaleString("fr-FR")}. Versions : ${ver}.</p>
  <h2>Références</h2>
  <ul>${(m.references || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>`;
};

/* ---------------------------------------------------------------- data */
const FILE_DESC = {
  "regions.csv": "Indicateurs par unité administrative (dernière année)", "annual_units.csv": "Séries annuelles par unité",
  "monthly_national.csv": "Série mensuelle nationale observée, désaisonnalisée, tendance", "monthly_adm1.csv": "Séries mensuelles désaisonnalisées par région",
  "adm1.geojson": "Limites ADM1 simplifiées + indicateurs", "adm2.geojson": "Limites ADM2 simplifiées + indicateurs", "adm0.geojson": "Contour national simplifié",
  "gdp.json": "Élasticités, diagnostics, estimations de PIB", "shocks.json": "Événements, impacts, ruptures, séries quotidiennes",
  "inequality.json": "Gini, Theil, Lorenz, populations dans le noir", "growth.json": "Concentration et convergence", "summary.json": "Indicateurs clés et messages",
  "meta.json": "Métadonnées, paramètres, versions",
};
RENDER.data = () => {
  const m = S.d.meta;
  $("#downloads").innerHTML = (m.files || []).map((f) => `<li><a href="data/${S.iso}/${esc(f)}" download>${esc(f)}</a><span>${esc(FILE_DESC[f] || "")}</span></li>`).join("") +
    Object.values((m.rasters && m.rasters.ntl) || {}).map((f) => `<li><a href="data/${S.iso}/rasters/${esc(f)}" download>${esc(f)}</a><span>Image PNG (Web Mercator), emprise : ${esc((m.rasters.bounds || []).map((b) => b.toFixed(2)).join(", "))}</span></li>`).join("");
};

/* ================================================================ MAP */
const INDICATORS = [
  { k: "growth", t: "Croissance de la lumière (%/an)", kind: "div", fmt: (v) => F.pct(v), help: "Pente robuste de la somme des lumières. Bleu : croissance ; rouge : déclin." },
  { k: "class", t: "Classe de dynamique", kind: "cat", help: "Croissance / stagnation / déclin, avec test de significativité." },
  { k: "sol_pc", t: "Lumière par habitant", kind: "seq", fmt: (v) => F.num(v, 3), help: "Somme des radiances divisée par la population : intensité de l'activité par personne." },
  { k: "share_last", t: "Part de la lumière nationale", kind: "seq", fmt: (v) => F.share(v, 1), help: "Où se concentre l'activité lumineuse du pays." },
  { k: "dark_share", t: "Part de la population dans le noir", kind: "seqo", fmt: (v) => F.share(v), help: "Population vivant dans des pixels habités sans lumière détectable (proxy du non-accès)." },
  { k: "pop_dark", t: "Population dans le noir", kind: "seqo", fmt: (v) => F.people(v), help: "Nombre de personnes en zone habitée non éclairée." },
  { k: "gdp_pc_est", t: "PIB par habitant estimé (USD, expérimental)", kind: "seq", fmt: (v) => F.num(v), lvl: "ADM1", help: "PIB national réparti au prorata de la lumière (statistique expérimentale)." },
];
const SEQ_B = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const SEQ_O = ["#fde3d6", "#f9bfa4", "#f39a72", "#eb6834", "#c94f20", "#9f3c17", "#73290e"];
const DIV = ["#e34948", "#ef8f8a", "#f6c6c2", "#d9d8d2", "#b7d3f6", "#6da7ec", "#2a78d6"];

// Basemap: OpenFreeMap vector styles (free, no API key). If unreachable, a plain background is used.
const BASEMAP = { light: "https://tiles.openfreemap.org/styles/positron", dark: "https://tiles.openfreemap.org/styles/dark" };
const effTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
async function baseStyle(theme) {
  try {
    const r = await fetch(BASEMAP[theme]); if (!r.ok) throw new Error(r.status);
    const st = await r.json();
    st.layers.forEach((l) => { l.metadata = { ...(l.metadata || {}), base: true }; });
    return st;
  } catch (e) {
    return { version: 8, sources: {}, layers: [{ id: "bg", type: "background", metadata: { base: true }, paint: { "background-color": css("--surface-2") } }] };
  }
}
// first label layer of the basemap: data layers go below it so place names stay readable
const labelsBefore = (mp) => (mp.getStyle().layers.find((l) => l.type === "symbol") || {}).id;
async function newMap(container) {
  return new maplibregl.Map({ container, attributionControl: { compact: true }, preserveDrawingBuffer: true,
    style: await baseStyle(effTheme()), bounds: bbox(S.d.adm0), fitBoundsOptions: { padding: 24 } });
}
function bbox(gj) {
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c) => { if (typeof c[0] === "number") { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); } else c.forEach(walk); };
  (gj?.features || []).forEach((f) => walk(f.geometry.coordinates));
  return [[w, s], [e, n]];
}
function quantiles(vals, k = 7) {
  const v = vals.filter(isNum).sort((a, b) => a - b); if (!v.length) return [];
  return Array.from({ length: k - 1 }, (_, i) => v[Math.floor(((i + 1) / k) * (v.length - 1))]);
}

RENDER.map = async () => {
  const m = S.d.meta;
  const lvSel = $("#map-level"), indSel = $("#map-indicator"), yr = $("#map-year");
  lvSel.innerHTML = (m.levels || ["ADM1"]).map((l) => `<option value="${l}">${l === "ADM1" ? "Régions (ADM1)" : "Districts (ADM2)"}</option>`).join("");
  const fillInd = () => { indSel.innerHTML = INDICATORS.filter((i) => !i.lvl || i.lvl === lvSel.value).map((i) => `<option value="${i.k}">${esc(i.t)}</option>`).join(""); };
  fillInd();
  const years = Object.keys((m.rasters && m.rasters.ntl) || {}).sort();
  yr.max = Math.max(0, years.length - 1); yr.value = yr.max;
  if (!window.maplibregl) { $("#map-fallback").hidden = false; return; }
  try { S.map = await newMap("map"); } catch (e) { console.error(e); $("#map-fallback").hidden = false; return; }
  S.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  S.map.on("load", () => {
    const before = labelsBefore(S.map);
    for (const lv of ["ADM1", "ADM2"]) {
      const gj = S.d[lv.toLowerCase()]; if (!gj) continue;
      S.map.addSource(lv, { type: "geojson", data: gj, promoteId: "unit_id" });
      S.map.addLayer({ id: lv + "-fill", type: "fill", source: lv, layout: { visibility: "none" }, paint: { "fill-opacity": 0.82, "fill-color": "#ccc" } }, before);
      S.map.addLayer({ id: lv + "-line", type: "line", source: lv, layout: { visibility: "none" },
        paint: { "line-color": ["case", ["boolean", ["feature-state", "hover"], false], css("--ink"), "rgba(255,255,255,0.75)"],
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, lv === "ADM1" ? 1 : 0.5] } }, before);
      let hov = null;
      S.map.on("mousemove", lv + "-fill", (e) => { if (hov) S.map.setFeatureState({ source: lv, id: hov }, { hover: false });
        hov = e.features[0].id; S.map.setFeatureState({ source: lv, id: hov }, { hover: true }); S.map.getCanvas().style.cursor = "pointer"; });
      S.map.on("mouseleave", lv + "-fill", () => { if (hov) S.map.setFeatureState({ source: lv, id: hov }, { hover: false }); hov = null; S.map.getCanvas().style.cursor = ""; });
      S.map.on("click", lv + "-fill", (e) => popup(e, lv));
    }
    const R = m.rasters;
    if (R && R.bounds) {
      const [w, s, e, n] = R.bounds; const coords = [[w, n], [e, n], [e, s], [w, s]];
      if (years.length) {
        S.map.addSource("ntl", { type: "image", url: `data/${S.iso}/rasters/${R.ntl[years[years.length - 1]]}`, coordinates: coords });
        S.map.addLayer({ id: "ntl", type: "raster", source: "ntl", layout: { visibility: "none" }, paint: { "raster-opacity": 0.95, "raster-fade-duration": 0 } }, "ADM1-fill");
      }
      const dk = Object.values(R.dark || {})[0];
      if (dk) {
        S.map.addSource("dark", { type: "image", url: `data/${S.iso}/rasters/${dk}`, coordinates: coords });
        S.map.addLayer({ id: "dark", type: "raster", source: "dark", layout: { visibility: "none" }, paint: { "raster-opacity": 0.9, "raster-resampling": "nearest" } }, "ADM1-fill");
      }
    }
    S.mapReady = true;
    S.map.resize();
    applyMapMode();
  });
  $("#map-mode").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; $$("#map-mode button").forEach((x) => x.classList.toggle("on", x === b)); S.mapMode = b.dataset.mode; applyMapMode(); };
  lvSel.onchange = () => { fillInd(); applyMapMode(); };
  indSel.onchange = applyMapMode;
  yr.oninput = () => applyMapMode();
  $("#swipe").oninput = () => clipCompare();
};

function setVis(id, on) { if (S.map.getLayer(id)) S.map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); }

function applyMapMode() {
  if (!S.map || !S.mapReady) return;
  const mode = S.mapMode, m = S.d.meta, lv = $("#map-level").value;
  if (S.popup) { S.popup.remove(); S.popup = null; }
  const years = Object.keys((m.rasters && m.rasters.ntl) || {}).sort();
  $$(".map-toolbar .ctl").forEach((el) => { el.hidden = !(el.dataset.for === mode || (el.dataset.for === "choro" && mode === "choro")); });
  ["ADM1", "ADM2"].forEach((l) => { setVis(l + "-fill", mode === "choro" && l === lv); setVis(l + "-line", (mode === "choro" && l === lv) || (mode !== "choro" && l === "ADM1")); });
  setVis("ntl", mode === "ntl" || mode === "compare"); setVis("dark", mode === "dark");
  $("#map-b").hidden = mode !== "compare"; $("#swipe").hidden = mode !== "compare";
  const legend = $("#map-legend"), help = $("#map-help"), src = $("#map-source");
  src.textContent = "Sources : VIIRS VNL V2 (NOAA/EOG) via Google Earth Engine ; limites " + ((m.boundaries || {}).ADM1 || "geoBoundaries") + " ; fond de carte OpenFreeMap, © OpenMapTiles, données © contributeurs OpenStreetMap.";
  if (mode === "choro") {
    const ind = INDICATORS.find((i) => i.k === $("#map-indicator").value) || INDICATORS[0];
    const feats = (S.d[lv.toLowerCase()] || {}).features || [];
    let expr, leg;
    if (ind.kind === "cat") {
      const cols = { Croissance: css("--grow"), Stagnation: css("--flat"), "Déclin": css("--decline") };
      expr = ["match", ["coalesce", ["get", "class"], ""], ...Object.entries(cols).flat(), css("--grid")];
      leg = Object.entries(cols).map(([k, v]) => `<div><span class="sw" style="background:${v}"></span>${k}</div>`).join("");
    } else {
      const vals = feats.map((f) => f.properties[ind.k]);
      let breaks, ramp, lo = Math.min(...vals.filter(isNum)), hi = Math.max(...vals.filter(isNum));
      if (ind.kind === "div") {
        const mx = Math.max(...vals.filter(isNum).map(Math.abs), 0.01); const st = mx / 3.5;
        breaks = [-2.5 * st, -1.5 * st, -0.5 * st, 0.5 * st, 1.5 * st, 2.5 * st]; ramp = DIV; lo = -mx; hi = mx;
      } else { breaks = quantiles(vals); ramp = ind.kind === "seqo" ? SEQ_O : SEQ_B; }
      const uniq = breaks.filter((b, i) => i === 0 || b > breaks[i - 1]);
      expr = ["case", ["!=", ["typeof", ["get", ind.k]], "number"], css("--grid"), ["step", ["get", ind.k], ramp[0], ...uniq.flatMap((b, i) => [b, ramp[Math.min(i + 1, ramp.length - 1)]])]];
      leg = `<div class="ramp" style="background:linear-gradient(90deg,${ramp.join(",")})"></div><div class="ticks"><span>${ind.fmt(lo)}</span>${ind.kind === "div" ? "<span>0</span>" : ""}<span>${ind.fmt(hi)}</span></div>`;
    }
    S.map.setPaintProperty(lv + "-fill", "fill-color", expr);
    legend.innerHTML = `<strong>${esc(ind.t)}</strong>${leg}<div class="ticks"><span><span class="sw" style="background:${css("--grid")}"></span>non disponible</span></div>`;
    help.textContent = ind.help + " Cliquez sur une unité pour le détail.";
  } else if (mode === "ntl" || mode === "compare") {
    const y = mode === "compare" ? years[years.length - 1] : years[+$("#map-year").value];
    $("#year-label").textContent = y || "";
    if (S.map.getSource("ntl") && y) S.map.getSource("ntl").updateImage({ url: `data/${S.iso}/rasters/${m.rasters.ntl[y]}` });
    legend.innerHTML = `<strong>Radiance (échelle log.)</strong><div class="ramp" style="background:linear-gradient(90deg,#000004,#3b0f70,#8c2981,#de4968,#fe9f6d,#fcfdbf)"></div><div class="ticks"><span>0,1</span><span>1</span><span>10</span><span>100 nW</span></div>`;
    help.textContent = mode === "compare" ? `Faites glisser le curseur : à gauche ${years[0]}, à droite ${years[years.length - 1]}. Les zones apparues traduisent l'électrification, l'urbanisation ou de nouvelles infrastructures.`
      : "Composite annuel VNL V2 (torchères masquées). Déplacez le curseur pour parcourir les années.";
    if (mode === "compare") setupCompare(years[0]); else teardownCompare();
  } else if (mode === "dark") {
    legend.innerHTML = `<strong>Zones habitées (${(m.rasters && Object.keys(m.rasters.dark || {})[0]) || ""})</strong><div><span class="sw" style="background:#f5c242"></span>éclairées</div><div><span class="sw" style="background:#d7263d"></span>non éclairées (« dans le noir »)</div>`;
    help.textContent = "Pixels comptant au moins " + ((m.config || {}).pop_min || 5) + " habitants : en rouge ceux dont la radiance reste sous le seuil de détection. Proxy de l'absence d'accès à l'électricité — un foyer raccordé mais peu éclairé y apparaît aussi.";
    teardownCompare();
  }
  if (mode !== "compare") teardownCompare();
}

async function setupCompare(y0) {
  const m = S.d.meta;
  if (!S.mapB) {
    S.mapB = true;   // guard against double creation while the style loads
    S.mapB = await newMap("map-b");
    S.mapB.on("load", () => {
      const [w, s, e, n] = m.rasters.bounds;
      S.mapB.addSource("ntl", { type: "image", url: `data/${S.iso}/rasters/${m.rasters.ntl[y0]}`, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
      S.mapB.addLayer({ id: "ntl", type: "raster", source: "ntl", paint: { "raster-opacity": 0.95 } }, labelsBefore(S.mapB));
      S.mapB.addSource("ADM1", { type: "geojson", data: S.d.adm1 });
      S.mapB.addLayer({ id: "l", type: "line", source: "ADM1", paint: { "line-color": "rgba(255,255,255,0.75)", "line-width": 1 } }, labelsBefore(S.mapB));
      S.mapB.addControl(new maplibregl.AttributionControl({ compact: true }));
      sync();
    });
    S.syncFn = () => sync();
    S.map.on("move", S.syncFn);
  }
  $("#map-b").hidden = false; if (S.mapB.resize) S.mapB.resize(); sync(); clipCompare();
}
function sync() { if (S.mapB && S.mapB.jumpTo) S.mapB.jumpTo({ center: S.map.getCenter(), zoom: S.map.getZoom(), bearing: S.map.getBearing(), pitch: S.map.getPitch() }); }
function clipCompare() { const v = +$("#swipe").value; $("#map-b").style.clipPath = `inset(0 ${100 - v}% 0 0)`; }
function teardownCompare() { $("#map-b").hidden = true; $("#swipe").hidden = true; }

function popup(e, lv) {
  const p = e.features[0].properties;
  const rows = [["Somme des lumières", F.num(p.sol)], ["Part nationale", F.share(p.share_last, 1)], ["Croissance", F.pct(p.growth) + "/an"],
    ["Classe", p.class || "–"], ["Lumière/hab.", F.num(p.sol_pc, 3)], ["Pop. dans le noir", `${F.people(p.pop_dark)} (${F.share(p.dark_share)})`]];
  if (lv === "ADM1" && isNum(p.gdp_pc_est)) rows.push(["PIB/hab. estimé", F.num(p.gdp_pc_est) + " USD"]);
  if (S.popup) S.popup.remove();
  S.popup = new maplibregl.Popup({ maxWidth: "280px" }).setLngLat(e.lngLat).setHTML(`<strong>${esc(p.name)}</strong>${p.parent_name ? `<div class="why">${esc(p.parent_name)}</div>` : ""}` +
    `<table>${rows.map(([a, b]) => `<tr><td style="color:var(--ink-2);padding-right:8px">${a}</td><td>${b}</td></tr>`).join("")}</table>`).addTo(S.map);
}

/* ================================================================ theme & boot */
function toggleTheme() {
  const next = effTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next; store.set("ntl-theme", next); rethemed();
}
function rethemed() {
  const cur = (location.hash || "#overview").slice(1);
  S.rendered = { map: S.rendered.map }; route();   // the map is re-themed in place, never rebuilt
  for (const mp of [S.map, S.mapB]) {
    if (!mp || !mp.setStyle) continue;
    baseStyle(effTheme()).then((next) => mp.setStyle(next, { transformStyle: (prev, nxt) => {
      if (!prev) return nxt;
      const custom = prev.layers.filter((l) => !(l.metadata && l.metadata.base));
      const sources = { ...nxt.sources };
      for (const [k, v] of Object.entries(prev.sources)) if (!(k in sources) && custom.some((l) => l.source === k)) sources[k] = v;
      const layers = [...nxt.layers]; const i = layers.findIndex((l) => l.type === "symbol");
      layers.splice(i < 0 ? layers.length : i, 0, ...custom);
      return { ...nxt, sources, layers };
    } }));
  }
  if (cur === "map") applyMapMode();
}

async function boot() {
  $("#theme-toggle").onclick = toggleTheme;
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (!document.documentElement.dataset.theme) rethemed(); });
  let countries = [];
  try { countries = await getJSON("data/countries.json"); } catch (e) { /* handled below */ }
  if (!countries.length) { $("#country-title").textContent = "Aucune donnée publiée"; $("#lede").textContent = "Exécutez la section 11 du notebook pour exporter les données."; return; }
  const want = new URLSearchParams(location.search).get("pays") || store.get("ntl-country");
  const iso = (countries.find((c) => c.iso3 === want) || countries[0]).iso3;
  const sel = $("#country-select");
  if (countries.length > 1) {
    sel.hidden = false; sel.innerHTML = countries.map((c) => `<option value="${c.iso3}">${esc(c.name)}</option>`).join("");
    sel.value = iso;
    sel.onchange = async () => { store.set("ntl-country", sel.value); S.mapReady = false; if (S.map) { S.map.remove(); S.map = null; } if (S.mapB) { S.mapB.remove(); S.mapB = null; }
      await loadCountry(sel.value); renderHeader(); route(); };
  }
  try { await loadCountry(iso); } catch (e) { $("#country-title").textContent = "Erreur de chargement"; console.error(e); return; }
  renderHeader();
  window.addEventListener("hashchange", route);
  route();
}
boot();
