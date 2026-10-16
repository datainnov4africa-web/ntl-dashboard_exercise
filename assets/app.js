/* Night-time lights dashboard — static site, no server, no Earth Engine at viewing time.
 * Data: data/countries.json and data/<ISO3>/*.json|csv|geojson|png written by src/export.py. */
"use strict";

const S = { iso: null, d: {}, rendered: {}, map: null, mapB: null, mapMode: "choro" };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const PAGES = ["overview", "map", "time", "regions", "shocks", "inequality", "industry", "method", "data"];

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
    growth: getJSON(base + "growth.json"), ind: getJSON(base + "industrial.geojson"), indmeta: getJSON(base + "industrial.json"),
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
  const fl = $("#flag");
  if (fl) {   // local flag written at export, then flagcdn.com, else hidden
    const iso2 = (m.iso2 || "").toLowerCase();
    fl.onerror = () => { if (iso2 && !fl.dataset.cdn) { fl.dataset.cdn = 1; fl.src = `https://flagcdn.com/${iso2}.svg`; } else fl.hidden = true; };
    fl.onload = () => { fl.hidden = false; };
    fl.src = `data/${S.iso}/flag.svg`;
  }
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
  if (p === "map" && S.map) setTimeout(() => S.map.invalidateSize(), 50);
  if (p === "industry" && S.imap) setTimeout(() => S.imap.invalidateSize(), 50);
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
  "industrial.geojson": "Zones industrielles candidates (contours + indicateurs)", "industrial.json": "Zones industrielles : synthèse, paramètres, validation OSM",
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

// Map: Leaflet (no WebGL needed). Basemaps WITHOUT any API key: Esri grey canvas (default), NASA Black
// Marble (GIBS), OpenStreetMap; automatic fallback to the next one if tiles fail; PNG overlays in Web Mercator.
const BASES = {
  esri: { light: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          dark: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          attr: 'Tiles © <a href="https://www.esri.com">Esri</a> — Esri, HERE, Garmin, © OpenStreetMap contributors', maxNativeZoom: 16 },
  night: { url: "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png",
           attr: 'NASA Black Marble 2016 · <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>', maxNativeZoom: 8 },
  osm: { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attr: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxNativeZoom: 19 },
  none: null,
};
const BASE_ORDER = ["esri", "osm", "night", "none"];
const effTheme = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const rasterUrl = (f) => `data/${S.iso}/rasters/${f}`;
function quantiles(vals, k = 7) {
  const v = vals.filter(isNum).sort((a, b) => a - b); if (!v.length) return [];
  return Array.from({ length: k - 1 }, (_, i) => v[Math.floor(((i + 1) / k) * (v.length - 1))]);
}
function mapBounds() {
  const R = S.d.meta.rasters;
  try { const b = L.geoJSON(S.d.adm0 || S.d.adm1).getBounds(); if (b.isValid()) return b; } catch (e) { /* fall through */ }
  if (R && R.bounds) { const [w, s, e, n] = R.bounds; return L.latLngBounds([s, w], [n, e]); }
  return L.latLngBounds([-35, -20], [38, 52]);
}
function newMap(id) {
  const mp = L.map(id, { zoomSnap: 0.25, worldCopyJump: false });
  mp.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  setBase(mp); if (id === "map") addBaseControl(mp);
  mp.createPane("raster"); mp.getPane("raster").style.zIndex = 350;
  L.control.scale({ imperial: false }).addTo(mp);
  mp.fitBounds(mapBounds(), { padding: [16, 16] });
  return mp;
}
function overlay(f) {
  const R = S.d.meta.rasters || {}; if (!R.bounds || !f) return null;
  const [w, s, e, n] = R.bounds;
  return L.imageOverlay(rasterUrl(f), [[s, w], [n, e]], { pane: "raster", opacity: 0.95, interactive: false });
}
const outline = (gj) => L.geoJSON(gj, { interactive: false, style: { color: "rgba(255,255,255,0.8)", weight: 1, fill: false } });
function showLayer(mp, lyr, on) { if (!mp || !lyr) return; if (on && !mp.hasLayer(lyr)) lyr.addTo(mp); if (!on && mp.hasLayer(lyr)) mp.removeLayer(lyr); }
function mapFail(msg) { const fb = $("#map-fallback"); fb.textContent = msg || TXT.fail; fb.hidden = false; fb.style.display = "grid"; }

RENDER.map = async () => {
  const m = S.d.meta;
  const lvSel = $("#map-level"), indSel = $("#map-indicator"), yr = $("#map-year");
  lvSel.innerHTML = (m.levels || ["ADM1"]).map((l) => `<option value="${l}">${l === "ADM1" ? "Régions (ADM1)" : "Districts (ADM2)"}</option>`).join("");
  const fillInd = () => { indSel.innerHTML = INDICATORS.filter((i) => !i.lvl || i.lvl === lvSel.value).map((i) => `<option value="${i.k}">${esc(i.t)}</option>`).join(""); };
  fillInd();
  const years = Object.keys((m.rasters && m.rasters.ntl) || {}).sort();
  yr.max = Math.max(0, years.length - 1); yr.value = yr.max;
  const ca = $("#cmp-a"), cb = $("#cmp-b");
  if (ca && cb) { const o = years.map((y) => `<option>${y}</option>`).join(""); ca.innerHTML = cb.innerHTML = o; ca.value = years[0]; cb.value = years[years.length - 1]; }
  if (!window.L) { mapFail("La bibliothèque cartographique (Leaflet) n'a pas pu être chargée. Rechargez la page ; les tableaux des autres pages restent disponibles."); return; }
  try {
    S.map = newMap("map");
    S.lyr = {};
    for (const lv of ["ADM1", "ADM2"]) {
      const gj = S.d[lv.toLowerCase()]; if (!gj) continue;
      S.lyr[lv] = L.geoJSON(gj, { style: () => ({ color: "rgba(255,255,255,0.8)", weight: lv === "ADM1" ? 1 : 0.5, fillOpacity: 0.82, fillColor: "#ccc" }),
        onEachFeature: (f, l) => {
          l.bindTooltip(() => tipHtml(f.properties), { sticky: true, direction: "top", opacity: 1 });
          l.on({ mouseover: (e) => { e.target.setStyle({ weight: 2.5, color: css("--ink") }); e.target.bringToFront(); },
                 mouseout: (e) => S.lyr[lv].resetStyle(e.target), click: (e) => popup(f.properties, lv, e.latlng) });
        } });
    }
    S.lyr.outline = S.d.adm1 ? outline(S.d.adm1) : null;
    S.lyr.ntl = overlay(years.length ? m.rasters.ntl[years[years.length - 1]] : null);
    S.lyr.dark = overlay(Object.values((m.rasters && m.rasters.dark) || {})[0]);
    preloadRasters(years); addMapControls(S.map);
    S.mapReady = true;
    setTimeout(() => { S.map.invalidateSize(); S.map.fitBounds(mapBounds(), { padding: [16, 16] }); }, 80);
    applyMapMode();
  } catch (e) { console.error(e); mapFail("La carte n'a pas pu être initialisée : " + (e && e.message ? e.message : e)); return; }
  $("#map-mode").onclick = (e) => { const b = e.target.closest("button"); if (!b) return; $$("#map-mode button").forEach((x) => x.classList.toggle("on", x === b)); S.mapMode = b.dataset.mode; applyMapMode(); };
  lvSel.onchange = () => { fillInd(); applyMapMode(); };
  indSel.onchange = applyMapMode;
  yr.oninput = () => applyMapMode();
  setupPlay();
  if (ca && cb) { ca.onchange = cb.onchange = () => applyMapMode(); }
};

function applyMapMode() { applyMapMode0(); afterMapMode(); }
function applyMapMode0() {
  if (!S.map || !S.mapReady) return;
  const mode = S.mapMode, m = S.d.meta, lv = $("#map-level").value;
  S.map.closePopup();
  const years = Object.keys((m.rasters && m.rasters.ntl) || {}).sort();
  $$(".map-toolbar .ctl").forEach((el) => { el.hidden = el.dataset.for !== mode; });
  ["ADM1", "ADM2"].forEach((l) => showLayer(S.map, S.lyr[l], mode === "choro" && l === lv));
  showLayer(S.map, S.lyr.outline, mode !== "choro");
  showLayer(S.map, S.lyr.ntl, mode === "ntl" || mode === "compare");
  showLayer(S.map, S.lyr.dark, mode === "dark");
  const legend = $("#map-legend"), help = $("#map-help"), src = $("#map-source");
  src.textContent = "Sources : VIIRS VNL V2 (NOAA/EOG) via Google Earth Engine ; limites {b} ; fond de carte Esri, NASA Black Marble ou © OpenStreetMap (sans clé d'API).".replace("{b}", (m.boundaries || {}).ADM1 || "geoBoundaries");
  if (mode === "choro") {
    const ind = INDICATORS.find((i) => i.k === $("#map-indicator").value) || INDICATORS[0];
    const feats = (S.d[lv.toLowerCase()] || {}).features || [];
    let colorOf, leg;
    if (ind.kind === "cat") {
      const cols = { Croissance: css("--grow"), Stagnation: css("--flat"), "Déclin": css("--decline") };
      colorOf = (p) => cols[p.class] || css("--grid");
      leg = Object.entries(cols).map(([k, v]) => `<div><span class="sw" style="background:${v}"></span>${esc(k)}</div>`).join("");
    } else {
      const vals = feats.map((f) => f.properties[ind.k]);
      let breaks, ramp, lo = Math.min(...vals.filter(isNum)), hi = Math.max(...vals.filter(isNum));
      if (ind.kind === "div") {
        const mx = Math.max(...vals.filter(isNum).map(Math.abs), 0.01); const st = mx / 3.5;
        breaks = [-2.5 * st, -1.5 * st, -0.5 * st, 0.5 * st, 1.5 * st, 2.5 * st]; ramp = DIV; lo = -mx; hi = mx;
      } else { breaks = quantiles(vals); ramp = ind.kind === "seqo" ? SEQ_O : SEQ_B; }
      const uniq = breaks.filter((b, i) => i === 0 || b > breaks[i - 1]);
      colorOf = (p) => { const v = p[ind.k]; if (!isNum(v)) return css("--grid"); let k = 0; while (k < uniq.length && v >= uniq[k]) k++; return ramp[Math.min(k, ramp.length - 1)]; };
      leg = `<div class="ramp" style="background:linear-gradient(90deg,${ramp.join(",")})"></div><div class="ticks"><span>${ind.fmt(lo)}</span>${ind.kind === "div" ? "<span>0</span>" : ""}<span>${ind.fmt(hi)}</span></div>`;
    }
    const lyr = S.lyr[lv];
    if (lyr) { lyr.options.style = (f) => ({ color: "rgba(255,255,255,0.85)", weight: lv === "ADM1" ? 1 : 0.5, fillOpacity: 0.82, fillColor: colorOf(f.properties) }); lyr.setStyle(lyr.options.style); }
    legend.innerHTML = `<strong>${esc(ind.t)}</strong>${leg}<div class="ticks"><span><span class="sw" style="background:${css("--grid")}"></span>non disponible</span></div>`;
    help.textContent = ind.help + " Survolez ou cliquez sur une unité pour le détail.";
    teardownCompare();
  } else if (mode === "ntl" || mode === "compare") {
    const y = mode === "compare" ? ($("#cmp-a") ? $("#cmp-a").value : years[0]) : years[+$("#map-year").value];
    $("#year-label").textContent = mode === "ntl" ? (y || "") : "";
    if (S.lyr.ntl && y) S.lyr.ntl.setUrl(rasterUrl(m.rasters.ntl[y]));
    legend.innerHTML = `<strong>Radiance (échelle log.)</strong><div class="ramp" style="background:linear-gradient(90deg,#000004,#3b0f70,#8c2981,#de4968,#fe9f6d,#fcfdbf)"></div><div class="ticks"><span>0,1</span><span>1</span><span>10</span><span>100 nW</span></div>`;
    if (mode === "compare") {
      const a = $("#cmp-a") ? $("#cmp-a").value : years[0], yB = $("#cmp-b") ? $("#cmp-b").value : years[years.length - 1];
      help.textContent = "Cartes synchronisées : {a} à gauche, {b} à droite (changez les années dans la barre d'outils). Les zones apparues traduisent l'électrification, l'urbanisation ou de nouvelles infrastructures.".replace("{a}", a).replace("{b}", yB);
      setupCompare(yB);
    } else { help.textContent = "Composite annuel VNL V2 (torchères masquées). Déplacez le curseur pour parcourir les années."; teardownCompare(); }
  } else if (mode === "dark") {
    legend.innerHTML = `<strong>Zones habitées (${(m.rasters && Object.keys(m.rasters.dark || {})[0]) || ""})</strong><div><span class="sw" style="background:#f5c242"></span>éclairées</div><div><span class="sw" style="background:#d7263d"></span>non éclairées (« dans le noir »)</div>`;
    help.textContent = "Pixels comptant au moins {p} habitants : en rouge ceux dont la radiance reste sous le seuil de détection. Proxy de l'absence d'accès à l'électricité — un foyer raccordé mais peu éclairé y apparaît aussi.".replace("{p}", (m.config || {}).pop_min || 5);
    teardownCompare();
  }
}

function setupCompare(y0) {
  const m = S.d.meta, wrap = $(".map-wrap");
  wrap.classList.add("split"); $("#map-b").hidden = false;
  if (!S.mapB) {
    S.mapB = newMap("map-b");
    S.lyrB = { ntl: overlay(m.rasters.ntl[y0]), outline: S.d.adm1 ? outline(S.d.adm1) : null };
    showLayer(S.mapB, S.lyrB.ntl, true); showLayer(S.mapB, S.lyrB.outline, true);
    let lock = false;
    const link = (src, dst) => src.on("move", () => { if (lock) return; lock = true; dst.setView(src.getCenter(), src.getZoom(), { animate: false }); lock = false; });
    link(S.map, S.mapB); link(S.mapB, S.map);
  } else if (S.lyrB.ntl) S.lyrB.ntl.setUrl(rasterUrl(m.rasters.ntl[y0]));
  setTimeout(() => { S.map.invalidateSize(); S.mapB.invalidateSize(); S.mapB.setView(S.map.getCenter(), S.map.getZoom(), { animate: false }); }, 60);
}
function teardownCompare() {
  const wrap = $(".map-wrap"); if (!wrap.classList.contains("split")) return;
  wrap.classList.remove("split"); $("#map-b").hidden = true;
  setTimeout(() => S.map && S.map.invalidateSize(), 60);
}

function popup(p, lv, latlng) {
  const rows = [["Somme des lumières", F.num(p.sol)], ["Part nationale", F.share(p.share_last, 1)], ["Croissance", F.pct(p.growth) + "/an"], ["Classe", p.class || "–"], ["Lumière/hab.", F.num(p.sol_pc, 3)], ["Pop. dans le noir", `${F.people(p.pop_dark)} (${F.share(p.dark_share)})`]];
  if (lv === "ADM1" && isNum(p.gdp_pc_est)) rows.push(["PIB/hab. estimé", F.num(p.gdp_pc_est) + " USD"]);
  L.popup({ maxWidth: 320, minWidth: 260 }).setLatLng(latlng).setContent(`<strong>${esc(p.name)}</strong>${p.parent_name ? `<div class="why">${esc(p.parent_name)}</div>` : ""}` +
    sparkline(p.unit_id) + `<table>${rows.map(([a, b]) => `<tr><td style="color:var(--ink-2);padding-right:8px">${a}</td><td>${b}</td></tr>`).join("")}</table>`).openOn(S.map);
}

/* ================================================================ theme & boot */
function toggleTheme() {
  const next = effTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next; store.set("ntl-theme", next); rethemed();
}
function rethemed() {
  const cur = (location.hash || "#overview").slice(1);
  S.rendered = { map: S.rendered.map }; route();   // the map is re-themed in place, never rebuilt
  for (const mp of [S.map, S.mapB, S.imap]) if (mp) setBase(mp);
  if (cur === "map") applyMapMode();
}


/* ---- FR / EN switch: the other language lives in "<lang>/" (or "../" from inside it) */
function langSwitch() {
  const a = $("#lang-switch"); if (!a) return;
  const me = document.documentElement.lang, other = me === "fr" ? "en" : "fr";
  const inSub = new RegExp("/" + me + "/(index\\.html)?$").test(location.pathname);
  const upd = () => { a.href = (inSub ? "../" : other + "/") + location.search + location.hash; };
  upd(); window.addEventListener("hashchange", upd);
}
async function boot() {
  langSwitch();
  $("#theme-toggle").onclick = toggleTheme;
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (!document.documentElement.dataset.theme) rethemed(); });
  let countries = [];
  try { countries = await getJSON("data/countries.json"); } catch (e) { /* handled below */ }
  if (!countries.length) { $("#country-title").textContent = "Aucune donnée publiée"; $("#lede").textContent = "Exécutez la section 12 du notebook pour exporter les données."; return; }
  const want = (new URLSearchParams(location.search).get("country") || new URLSearchParams(location.search).get("pays")) || store.get("ntl-country");
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
/* ================================================================ map ergonomics (v2) */
const TXT = { play: "Lire l'animation", pause: "Mettre en pause", reset: "Recentrer sur le pays", full: "Plein écran",
    trend: "Somme des lumières {a}–{b}", fail: "La carte n'a pas pu être chargée. Rechargez la page (Ctrl+F5)." };
function preloadRasters(years) {
  const R = S.d.meta.rasters || {};
  years.forEach((y) => { const im = new Image(); im.src = rasterUrl(R.ntl[y]); });
}
function addMapControls(mp) {
  const Ctl = L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const box = L.DomUtil.create("div", "leaflet-bar ntl-ctl");
      box.innerHTML = `<a href="#" role="button" data-act="reset" title="${TXT.reset}" aria-label="${TXT.reset}">` +
        `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 3h-2.07A7 7 0 0 0 13 5.07V3h-2v2.07A7 7 0 0 0 5.07 11H3v2h2.07A7 7 0 0 0 11 18.93V21h2v-2.07A7 7 0 0 0 18.93 13H21v-2zm-9 6a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg></a>` +
        `<a href="#" role="button" data-act="full" title="${TXT.full}" aria-label="${TXT.full}">` +
        `<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm14 0h2v6h-6v-2h4v-4z"/></svg></a>`;
      L.DomEvent.disableClickPropagation(box);
      box.addEventListener("click", (e) => {
        const a = e.target.closest("a"); if (!a) return; e.preventDefault();
        if (a.dataset.act === "reset") mp.fitBounds(mapBounds(), { padding: [16, 16] }); else toggleFull();
      });
      return box;
    },
  });
  new Ctl().addTo(mp);
}
function refreshMaps() { setTimeout(() => { if (S.map) S.map.invalidateSize(); if (S.mapB) S.mapB.invalidateSize(); }, 220); }
function toggleFull() {
  const card = $(".map-card");
  if (document.fullscreenElement) { document.exitFullscreen(); return; }
  if (card.classList.contains("fs")) { card.classList.remove("fs"); refreshMaps(); return; }
  if (card.requestFullscreen) card.requestFullscreen().catch(() => { card.classList.add("fs"); refreshMaps(); });
  else { card.classList.add("fs"); refreshMaps(); }
}
document.addEventListener("fullscreenchange", refreshMaps);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && $(".map-card.fs")) { $(".map-card").classList.remove("fs"); refreshMaps(); } });

function setupPlay() {
  const btn = $("#map-play"), yr = $("#map-year"); if (!btn || !yr) return;
  const label = (t) => { btn.title = t; btn.setAttribute("aria-label", t); };
  const stop = () => { clearInterval(S.play); S.play = null; btn.textContent = "▶"; btn.classList.remove("on"); label(TXT.play); };
  S.stopPlay = stop;
  btn.onclick = () => {
    if (S.play) { stop(); return; }
    if (+yr.value >= +yr.max) { yr.value = 0; applyMapMode(); }
    btn.textContent = "❚❚"; btn.classList.add("on"); label(TXT.pause);
    S.play = setInterval(() => { if (+yr.value >= +yr.max) { stop(); return; } yr.value = +yr.value + 1; applyMapMode(); }, 1200);
  };
  yr.addEventListener("pointerdown", () => { if (S.play) stop(); });
  yr.addEventListener("keydown", () => { if (S.play) stop(); });
}

function afterMapMode() {
  const mode = S.mapMode, m = S.d.meta, years = Object.keys((m.rasters && m.rasters.ntl) || {}).sort();
  if (mode !== "ntl" && S.play && S.stopPlay) S.stopPlay();
  const a = $("#map-year-badge"), b = $("#map-year-badge-b"); if (!a || !b) return;
  let ya = "", yb = "";
  if (mode === "ntl") ya = years[+$("#map-year").value] || "";
  else if (mode === "compare") { ya = $("#cmp-a").value; yb = $("#cmp-b").value; }
  else if (mode === "dark") ya = Object.keys((m.rasters && m.rasters.dark) || {})[0] || "";
  a.textContent = ya; a.hidden = !ya; b.textContent = yb; b.hidden = !yb;
}

function tipHtml(p) {
  let s = `<strong>${esc(p.name || "")}</strong>`;
  if (p.parent_name) s += ` <span class="tip-p">${esc(p.parent_name)}</span>`;
  if (S.mapMode === "choro") {
    const ind = INDICATORS.find((i) => i.k === $("#map-indicator").value);
    if (ind) { const v = p[ind.k]; s += `<div class="tip-v">${esc(ind.t)} : <b>${ind.kind === "cat" ? esc(v ?? "–") : ind.fmt(v)}</b></div>`; }
  }
  return s;
}

function sparkline(uid) {
  const rows = (S.d.annual || []).filter((r) => r.unit_id === uid && isNum(r.sol)).sort((a, b) => a.year - b.year);
  if (rows.length < 3) return "";
  const W = 250, H = 58, P = 5, xs = rows.map((r) => r.year), ys = rows.map((r) => r.sol);
  const x0 = xs[0], x1 = xs[xs.length - 1], lo = Math.min(...ys), hi = Math.max(...ys), span = hi - lo || 1;
  const X = (x) => P + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * P), Y = (y) => H - P - ((y - lo) / span) * (H - 2 * P);
  const pts = rows.map((r) => `${X(r.year).toFixed(1)},${Y(r.sol).toFixed(1)}`);
  const area = `M${X(x0).toFixed(1)},${H - P} L${pts.join(" L")} L${X(x1).toFixed(1)},${H - P} Z`;
  const ch = ys[0] > 0 ? ys[ys.length - 1] / ys[0] - 1 : null;
  return `<div class="spark"><div class="spark-t">${esc(TXT.trend.replace("{a}", x0).replace("{b}", x1))}` +
    `${isNum(ch) ? ` <b class="${ch >= 0 ? "up" : "down"}">${F.pct(ch, 0)}</b>` : ""}</div>` +
    `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${area}" class="sp-a"/>` +
    `<polyline points="${pts.join(" ")}" class="sp-l"/><circle cx="${X(x1).toFixed(1)}" cy="${Y(ys[ys.length - 1]).toFixed(1)}" r="3.2" class="sp-d"/></svg></div>`;
}

/* ================================================================ basemaps (no API key) */
const BASE_TXT = { label: "Fond", esri: "Gris (Esri)", night: "Nuit (NASA Black Marble)", osm: "OpenStreetMap", none: "Aucun" };
function baseKind(mp) { return mp._baseKind || store.get("ntl-base") || "esri"; }
function setBase(mp, kind) {
  if (!mp) return;
  kind = kind || baseKind(mp);
  if (mp._base) { mp.removeLayer(mp._base); mp._base = null; }
  mp._baseKind = kind;
  const cfg = BASES[kind];
  const sel = mp._baseSel; if (sel) sel.value = kind;
  if (!cfg) return;
  const dark = mp._forceDark || effTheme() === "dark";
  const url = cfg.url || (dark ? cfg.dark : cfg.light);
  const lyr = L.tileLayer(url, { attribution: cfg.attr, maxNativeZoom: cfg.maxNativeZoom, maxZoom: 19, crossOrigin: false });
  let ok = 0, bad = 0;
  lyr.on("tileload", () => { ok++; });
  lyr.on("tileerror", () => {
    bad++;
    if (!ok && bad >= 4 && mp._base === lyr) {         // this provider is unreachable here: next one
      const nxt = BASE_ORDER[BASE_ORDER.indexOf(kind) + 1] || "none";
      console.warn("basemap", kind, "unavailable, switching to", nxt);
      setBase(mp, nxt);
    }
  });
  mp._base = lyr.addTo(mp); lyr.bringToBack();
}
function addBaseControl(mp) {
  const Ctl = L.Control.extend({
    options: { position: "bottomright" },
    onAdd() {
      const box = L.DomUtil.create("div", "base-ctl");
      box.innerHTML = `<label><span>${BASE_TXT.label}</span><select aria-label="${BASE_TXT.label}">` +
        Object.keys(BASES).map((k) => `<option value="${k}">${BASE_TXT[k]}</option>`).join("") + `</select></label>`;
      L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
      const sel = box.querySelector("select"); mp._baseSel = sel; sel.value = baseKind(mp);
      sel.onchange = () => { store.set("ntl-base", sel.value); for (const m of [S.map, S.mapB, S.imap]) if (m) setBase(m, sel.value); };
      return box;
    },
  });
  new Ctl().addTo(mp);
}

/* ================================================================ industrial zones */
const IT = {
  lede: "Où se trouvent les zones industrielles de {c} ? Les sites industriels brillent la nuit comme les villes, mais leurs bâtiments sont surtout non résidentiels, peu de gens y habitent et ils émettent du dioxyde d'azote. En combinant ces signaux, {n} zones candidates sont détectées.",
  none: "Les zones industrielles n'ont pas encore été calculées pour ce pays : exécutez la section 10 du notebook puis republiez.",
  k_n: "Zones détectées", k_n_sub: "{a} pôles majeurs · {b} sites énergétiques",
  k_share: "Part de la lumière nationale", k_share_sub: "émise par les zones, {y}",
  k_area: "Surface cumulée", k_area_sub: "km² de zones candidates",
  k_growth: "Croissance de la lumière des zones", k_growth_sub: "%/an, {a}–{b} (Theil–Sen)",
  k_val: "Confirmées par OpenStreetMap", k_val_sub: "des zones contiennent une zone industrielle OSM (± 1 km)",
  k_val_na: "validation OSM non disponible",
  cls: { major: "Pôle industriel majeur", zone: "Zone industrielle ou logistique", energy: "Site énergétique / extractif" },
  dyn: { up: "en expansion", flat: "stable", down: "en recul", na: "n.d." },
  legend: "Type de zone", size: "taille ∝ lumière émise",
  cols: ["Rang", "Zone", "Type", "Surface (km²)", "Lumière", "Part nationale", "Croissance %/an", "Bâti non résid.", "Habitants/km²", "OSM"],
  p_area: "Surface", p_sol: "Lumière émise", p_share: "Part nationale", p_growth: "Croissance", p_dyn: "Dynamique",
  p_nres: "Bâti non résidentiel", p_popd: "Habitants/km²", p_no2: "Indice NO₂", p_score: "Score industriel", p_osm: "Zones OSM industrielles",
  trend: "Lumière émise {a}–{b}", x_scatter: "Part non résidentielle du bâti (%)", y_scatter: "Lumière par habitant (échelle log.)",
  x_top: "Part de la lumière nationale (%)",
  method: `<p><strong>Principe.</strong> Un pixel VIIRS (~460 m) est candidat s'il est lumineux (≥ {r} nW) et que son
    <em>score industriel</em> dépasse {t}. Le score combine quatre signaux normalisés entre 0 et 1 :</p>
    <table><tr><th>Signal</th><th>Donnée</th><th>Poids</th></tr>
    <tr><td>Intensité lumineuse</td><td>VIIRS VNL V2, médiane des 3 dernières années</td><td>{w1}</td></tr>
    <tr><td>Bâti non résidentiel</td><td>GHSL BUILT-S (époque {ep}), part non résidentielle</td><td>{w2}</td></tr>
    <tr><td>Faible population résidente</td><td>GHSL GHS-POP</td><td>{w3}</td></tr>
    <tr><td>Émissions de NO₂</td><td>Sentinel-5P TROPOMI ({no2})</td><td>{w4}</td></tr></table>
    <p>Les torchères détectées par le notebook forment la classe <em>énergie / extraction</em>. Les pixels voisins sont
    regroupés en zones ; une zone est un <em>pôle majeur</em> si elle fait partie des 10 % les plus lumineuses ou dépasse 8 km².</p>
    <p><strong>Validation.</strong> {val}</p>
    <p><strong>Limites.</strong> Le bâti « non résidentiel » inclut aussi commerces, ports, aéroports et équipements publics ;
    le NO₂ est mesuré à ~5 km et suit aussi le trafic ; une zone est un <em>candidat</em> à confronter aux registres
    nationaux des zones industrielles et à l'imagerie à haute résolution.</p>`,
  val_ok: "{p} des zones détectées (et {pt} des 30 plus lumineuses) contiennent au moins une zone <code>landuse=industrial</code> d'OpenStreetMap à moins de 1 km ; ces zones portent {pw} de la lumière détectée. {rc} des {n} zones industrielles OSM du pays sont couvertes.",
  val_na: "La comparaison avec OpenStreetMap n'a pas pu être faite (API Overpass indisponible au moment du calcul).",
};
const ICOL = { major: "#F5C242", zone: "#F28C28", energy: "#E4572E" };
const fmtT = (s, o) => String(s).replace(/\{(\w+)\}/g, (_, k) => (o[k] ?? ""));
function indYears(p) { return Object.keys(p).filter((k) => /^sol_\d{4}$/.test(k)).map((k) => +k.slice(4)).sort(); }
function indSpark(p) {
  const yrs = indYears(p); const ys = yrs.map((y) => p["sol_" + y]);
  if (yrs.length < 3 || !ys.every(isNum)) return "";
  const W = 250, H = 58, P = 5, lo = Math.min(...ys), hi = Math.max(...ys), sp = hi - lo || 1;
  const X = (i) => P + (i / (yrs.length - 1)) * (W - 2 * P), Y = (v) => H - P - ((v - lo) / sp) * (H - 2 * P);
  const pts = ys.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`);
  const ch = ys[0] > 0 ? ys[ys.length - 1] / ys[0] - 1 : null;
  return `<div class="spark"><div class="spark-t">${esc(fmtT(IT.trend, { a: yrs[0], b: yrs[yrs.length - 1] }))}` +
    `${isNum(ch) ? ` <b class="${ch >= 0 ? "up" : "down"}">${F.pct(ch, 0)}</b>` : ""}</div><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">` +
    `<path class="sp-a" d="M${X(0)},${H - P} L${pts.join(" L")} L${X(yrs.length - 1)},${H - P} Z"/><polyline class="sp-l" points="${pts.join(" ")}"/>` +
    `<circle class="sp-d" r="3.2" cx="${X(yrs.length - 1)}" cy="${Y(ys[ys.length - 1])}"/></svg></div>`;
}
function indPopup(p) {
  const rows = [[IT.p_area, F.num(p.area_km2, 1) + " km²"], [IT.p_sol, F.num(p.sol)], [IT.p_share, F.share(p.share_national, 1)],
    [IT.p_growth, F.pct(p.growth) + "/an".replace("/an", document.documentElement.lang === "en" ? "/yr" : "/an")],
    [IT.p_dyn, IT.dyn[p.dynamics] || "–"], [IT.p_nres, F.share(p.nres_share)], [IT.p_popd, F.num(p.pop_density)],
    [IT.p_no2, isNum(p.s_no2) ? F.num(100 * p.s_no2) + " / 100" : "–"], [IT.p_score, isNum(p.score) ? F.num(100 * p.score) + " / 100" : "–"],
    [IT.p_osm, isNum(p.osm_n) ? (p.osm_n > 0 ? "✔ " + p.osm_n : "–") : "–"]];
  return `<div class="ind-pop"><span class="ind-badge" style="background:${ICOL[p.class]}">${esc(IT.cls[p.class] || "")}</span>` +
    `<strong>${esc(p.name)}</strong><div class="why">${esc(p.zone_id)} · ${F.num(Math.abs(p.lat), 3)}° ${p.lat >= 0 ? "N" : "S"} · ${F.num(Math.abs(p.lon), 3)}° ${p.lon >= 0 ? "E" : (document.documentElement.lang === "en" ? "W" : "O")}</div>` + indSpark(p) +
    `<table>${rows.map(([a, b]) => `<tr><td style="color:var(--ink-2);padding-right:10px">${a}</td><td>${b}</td></tr>`).join("")}</table></div>`;
}
RENDER.industry = () => {
  const gj = S.d.ind, im = S.d.indmeta, m = S.d.meta;
  const feats = (gj && gj.features) || [];
  if (!feats.length) {
    $("#ind-lede").textContent = IT.none;
    ["#ind-kpis"].forEach((s) => { $(s).innerHTML = ""; });
    $$("#page-industry .card, #page-industry .grid").forEach((el) => { el.hidden = true; });
    return;
  }
  const sm = (im && im.summary) || {}, val = im && im.validation, info = (im && im.info) || {};
  const P = feats.map((f) => f.properties);
  const yrs = indYears(P[0]);
  $("#ind-lede").textContent = fmtT(IT.lede, { c: m.name, n: F.num(feats.length) });
  const k = [
    [IT.k_n, F.num(sm.n ?? feats.length), fmtT(IT.k_n_sub, { a: sm.n_major ?? "–", b: sm.n_energy ?? "–" })],
    [IT.k_share, F.share(sm.share_national, 0), fmtT(IT.k_share_sub, { y: yrs[yrs.length - 1] })],
    [IT.k_area, F.num(sm.area_km2), IT.k_area_sub],
    [IT.k_growth, F.pct(sm.growth_total), fmtT(IT.k_growth_sub, { a: yrs[0], b: yrs[yrs.length - 1] })],
    val ? [IT.k_val, F.share(val.precision), IT.k_val_sub] : [IT.k_val, "–", IT.k_val_na],
  ];
  $("#ind-kpis").innerHTML = k.map(([l, v, s]) => `<div class="kpi"><div class="label">${esc(l)}</div><div class="value">${v}</div><div class="sub">${esc(s)}</div></div>`).join("");
  // ---- method text
  const pr = info.params || {}, w = info.weights || {};
  const pct0 = (v) => (isNum(v) ? F.share(v) : "–");
  const valTxt = val ? fmtT(IT.val_ok, { p: pct0(val.precision), pt: pct0(val.precision_top30), pw: pct0(val.light_weighted_precision),
    rc: pct0(val.recall), n: F.num(val.osm_areas) }) : IT.val_na;
  $("#ind-method").innerHTML = fmtT(IT.method, { r: pr.min_rad ?? 5, t: F.num(pr.threshold ?? 0.55, 2), w1: pct0(w.light), w2: pct0(w.nres),
    w3: pct0(w.lowres), w4: pct0(w.no2), ep: info.ghsl_epoch ?? "–", no2: info.no2 ? info.no2.year : "–", val: valTxt });
  // ---- charts
  const c = C(), top = P.slice().sort((a, b) => (b.sol || 0) - (a.sol || 0)).slice(0, 15).reverse();
  plot("ind-top", Object.keys(ICOL).map((cl) => {
    const v = top.filter((p) => p.class === cl);
    return { type: "bar", orientation: "h", name: IT.cls[cl], y: v.map((p) => `${p.name} · ${p.zone_id}`), x: v.map((p) => 100 * (p.share_national || 0)),
      marker: { color: ICOL[cl], line: { color: c.surface, width: 1 } }, customdata: v.map((p) => p.zone_id),
      hovertemplate: "%{y}<br>%{x:.2f} %<extra>%{fullData.name}</extra>" };
  }).filter((t) => t.y.length), { yaxis: { categoryorder: "array", categoryarray: top.map((p) => `${p.name} · ${p.zone_id}`), automargin: true },
    xaxis: { title: { text: IT.x_top } }, barmode: "overlay", margin: { l: 10 }, legend: { orientation: "h", x: 0, y: 1.08 } });
  const mx = Math.max(...P.map((p) => p.sol || 0), 1);
  plot("ind-scatter", Object.keys(ICOL).map((cl) => {
    const v = P.filter((p) => p.class === cl && isNum(p.nres_share) && isNum(p.sol) && p.pop > 0);
    return { type: "scatter", mode: "markers", name: IT.cls[cl], x: v.map((p) => 100 * p.nres_share), y: v.map((p) => p.sol / p.pop),
      text: v.map((p) => p.name), marker: { color: ICOL[cl], size: v.map((p) => 6 + 34 * Math.sqrt(p.sol / mx)), opacity: 0.8,
      line: { color: c.surface, width: 1 } }, hovertemplate: "%{text}<br>%{x:.0f} % · %{y:.3g}<extra>%{fullData.name}</extra>" };
  }).filter((t) => t.x.length), { xaxis: { title: { text: IT.x_scatter }, range: [0, 100] }, yaxis: { title: { text: IT.y_scatter }, type: "log" },
    legend: { orientation: "h", x: 0, y: 1.08 } });
  // ---- table
  S.indSort = S.indSort || { k: "sol", d: -1 };
  drawIndTable(P);
  // ---- map
  if (!window.L) return;
  if (!S.imap) {
    S.imap = L.map("imap", { zoomSnap: 0.25 });
    S.imap.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    S.imap._forceDark = true;
    setBase(S.imap); addBaseControl(S.imap);
    S.imap.createPane("raster"); S.imap.getPane("raster").style.zIndex = 350;
    L.control.scale({ imperial: false }).addTo(S.imap);
    addMapControls(S.imap);
    const ys = Object.keys((m.rasters && m.rasters.ntl) || {}).sort();
    S.ilyr = { ntl: overlay(ys.length ? m.rasters.ntl[ys[ys.length - 1]] : null), adm1: S.d.adm1 ? outline(S.d.adm1) : null };
    if (S.ilyr.ntl) S.ilyr.ntl.setOpacity(0.55).addTo(S.imap);
    if (S.ilyr.adm1) S.ilyr.adm1.setStyle({ color: "rgba(255,255,255,0.35)", weight: 0.8 }).addTo(S.imap);
    S.ilyr.poly = L.geoJSON(gj, { style: (f) => ({ color: ICOL[f.properties.class], weight: 1.4, fillColor: ICOL[f.properties.class], fillOpacity: 0.35, className: "izone" }),
      onEachFeature: (f, l) => { l.bindTooltip(`<strong>${esc(f.properties.name)}</strong><div class="tip-v">${esc(IT.cls[f.properties.class])}</div>`, { sticky: true });
        l.bindPopup(() => indPopup(f.properties), { maxWidth: 330, minWidth: 270 }); } }).addTo(S.imap);
    S.ilyr.pts = L.layerGroup(P.slice().sort((a, b) => (b.sol || 0) - (a.sol || 0)).map((p) => {
      const mk = L.circleMarker([p.lat, p.lon], { radius: 4 + 22 * Math.sqrt((p.sol || 0) / mx), color: "#fff", weight: 1.2,
        fillColor: ICOL[p.class], fillOpacity: 0.85, className: "izone-pt" });
      mk._cls = p.class; mk._id = p.zone_id;
      mk.bindTooltip(`<strong>${esc(p.name)}</strong><div class="tip-v">${esc(IT.cls[p.class])} · <b>${F.share(p.share_national, 1)}</b></div>`, { direction: "top" });
      mk.bindPopup(() => indPopup(p), { maxWidth: 330, minWidth: 270 });
      return mk;
    })).addTo(S.imap);
    const b = L.geoJSON(S.d.adm0 || S.d.adm1).getBounds();
    S.imap.fitBounds(b.isValid() ? b : S.ilyr.poly.getBounds(), { padding: [16, 16] });
    $("#ind-legend").innerHTML = `<strong>${esc(IT.legend)}</strong>` + Object.keys(ICOL).map((cl) =>
      `<div><span class="sw round" style="background:${ICOL[cl]}"></span>${esc(IT.cls[cl])}</div>`).join("") +
      `<div class="ticks"><span>○ ${esc(IT.size)}</span></div>`;
    $("#ind-filter").onclick = (e) => { const bt = e.target.closest("button"); if (!bt) return;
      $$("#ind-filter button").forEach((x) => x.classList.toggle("on", x === bt)); indFilter(bt.dataset.c); };
    $("#ind-ntl").onchange = (e) => showLayer(S.imap, S.ilyr.ntl, e.target.checked);
    $("#ind-poly").onchange = (e) => showLayer(S.imap, S.ilyr.poly, e.target.checked);
  }
  setTimeout(() => S.imap.invalidateSize(), 80);
};
function indFilter(cl) {
  const on = (c) => cl === "all" || c === cl;
  S.ilyr.pts.eachLayer((mk) => { mk.setStyle({ opacity: on(mk._cls) ? 1 : 0, fillOpacity: on(mk._cls) ? 0.85 : 0 }); if (!on(mk._cls)) mk.closeTooltip(); });
  S.ilyr.poly.setStyle((f) => ({ opacity: on(f.properties.class) ? 1 : 0, fillOpacity: on(f.properties.class) ? 0.35 : 0 }));
}
function drawIndTable(P) {
  const cols = [
    ["rank", (p) => p._rank], ["name", (p) => `<a href="#industry" data-z="${esc(p.zone_id)}">${esc(p.name)}</a>`],
    ["class", (p) => `<span class="pill" style="background:${ICOL[p.class]};color:#1b1b1b">${esc(IT.cls[p.class] || "")}</span>`],
    ["area_km2", (p) => F.num(p.area_km2, 1)], ["sol", (p) => F.num(p.sol)], ["share_national", (p) => F.share(p.share_national, 2)],
    ["growth", (p) => F.pct(p.growth)], ["nres_share", (p) => F.share(p.nres_share)], ["pop_density", (p) => F.num(p.pop_density)],
    ["osm_n", (p) => (isNum(p.osm_n) ? (p.osm_n > 0 ? "✔" : "–") : "n.d.")],
  ];
  const byLight = P.slice().sort((a, b) => (b.sol || 0) - (a.sol || 0)); byLight.forEach((p, i) => { p._rank = i + 1; });
  const { k, d } = S.indSort; const key = k === "rank" ? "_rank" : k;
  const rows = P.slice().sort((a, b) => { const x = a[key], y = b[key]; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * d; });
  const t = $("#ind-table");
  t.innerHTML = `<thead><tr>${cols.map(([c], i) => `<th scope="col" data-k="${c}" ${c === k ? `aria-sort="${d > 0 ? "ascending" : "descending"}"` : ""}>${esc(IT.cols[i])}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map((p) => `<tr data-z="${esc(p.zone_id)}">${cols.map(([, f]) => `<td>${f(p)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  t.querySelector("thead").onclick = (e) => { const th = e.target.closest("th"); if (!th) return;
    S.indSort = { k: th.dataset.k, d: S.indSort.k === th.dataset.k ? -S.indSort.d : (th.dataset.k === "name" || th.dataset.k === "rank" ? 1 : -1) }; drawIndTable(P); };
  t.querySelector("tbody").onclick = (e) => { const tr = e.target.closest("tr"); if (!tr || !S.imap) return; e.preventDefault();
    let mk = null; S.ilyr.pts.eachLayer((l) => { if (l._id === tr.dataset.z) mk = l; });
    if (mk) { $("#imap").scrollIntoView({ behavior: "smooth", block: "center" }); S.imap.flyTo(mk.getLatLng(), 11, { duration: 0.8 }); setTimeout(() => mk.openPopup(), 900); } };
}

boot();
