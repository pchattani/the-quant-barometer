/* The Quant Barometer — client.
   Loads the JSON feeds built by scripts/site/build_barometer.py and draws every panel: the Monitor
   (stat strip, release board, heat chart, skill, scorecard, calibration), the cross-section, one
   economy in depth, US GDP, the track record and the methodology. Charts are Plotly, themed from the
   Quant kit tokens (Broadcast, dark only). Nothing here computes a forecast: every number is a feed value
   or a direct formatting of one. */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
};
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => (v === null || v === undefined || v === "" ? null : (isNum(+v) ? +v : null));
const f2 = (v) => (isNum(v) ? v.toFixed(2) : "—");
const f1 = (v) => (isNum(v) ? v.toFixed(1) : "—");
const f3 = (v) => (isNum(v) ? v.toFixed(3) : "—");
const sg = (v, d = 2) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) : "—");
const pct = (v, d = 0) => (isNum(v) ? (v * 100).toFixed(d) + "%" : "—");
const spct = (v) => (isNum(v) ? (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v * 100).toFixed(0) + "%" : "—");
const isMom = (u) => /m\/m|q\/q/.test(u || "");
const val = (v, u) => (isMom(u) ? sg(v) : f2(v));
const D = (s) => new Date(String(s).slice(0, 10) + "T00:00:00");
const M = (m) => new Date(m + "-01T00:00:00");
const dayFmt = (s) => D(s).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const longDay = (s) => D(s).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const monthFmt = (m) => M(m).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
const periodFmt = (p) => (/^\d{4}-\d{2}$/.test(p || "") ? monthFmt(p) : p);
const today = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
const daysTo = (s) => Math.round((D(s) - today()) / 86400000);
const isHead = (r) => r.headline === true || r.headline === "True" || r.headline === "true";
const truthy = (v) => v === true || v === "True" || v === "true";

// ── State and routing ───────────────────────────────────────────────────────
const state = { tab: "monitor", cc: "US", target: null, look: "5", scope: "headline", region: "all", search: "",
  sort: { key: "release", dir: 1 }, ecoRegion: "all", window: "2015-01", rscope: "headline", gdph: "1", daily: null };
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("tab")) state.tab = p.get("tab");
  if (p.get("cc")) state.cc = p.get("cc").toUpperCase();
}
function writeHash() {
  const p = new URLSearchParams({ tab: state.tab });
  if (state.tab === "country") p.set("cc", state.cc);
  try { history.replaceState(null, "", "#" + p.toString()); } catch (_) { /* sandboxed */ }
}

// ── Data ────────────────────────────────────────────────────────────────────
const cache = new Map();
function load(path) {
  if (!cache.has(path)) cache.set(path, fetch("data/" + path).then((r) => { if (!r.ok) throw new Error(path + " " + r.status); return r.json(); })
    .catch((e) => { cache.delete(path); throw e; }));
  return cache.get(path);
}
let META, BOARD;

// ── Plotly theme (Broadcast tokens) ────────────────────────────────────────
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const C = {};
function tokens() {
  Object.assign(C, { ours: css("--signal"), actual: css("--volt"), naive: css("--c-naive"), bench: css("--c-bench"),
    bench2: css("--c-bench2"), market: css("--c-market"), hot: css("--hot"), cool: css("--cool"), grid: css("--grid"),
    axis: css("--axis"), ink1: css("--ink-1"), ink2: css("--ink-2"), ink3: css("--ink-3"), slate: css("--slate"), card: css("--s-1") });
}
const COND = "Barlow Condensed, Barlow, Arial Narrow, sans-serif";
function axis(title, extra = {}) {
  return { title: { text: title, font: { family: COND, size: 12, color: C.ink2 }, standoff: 8 }, gridcolor: C.grid, zerolinecolor: C.axis,
    linecolor: C.axis, tickfont: { family: COND, size: 12, color: C.ink3 }, automargin: true, ...extra };
}
function layout(o = {}) {
  return { paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { family: "Barlow, sans-serif", color: C.ink2, size: 12 },
    margin: { l: 56, r: 16, t: 10, b: 44 }, showlegend: false, hovermode: "closest",
    hoverlabel: { bgcolor: "#000", bordercolor: C.actual, font: { family: "Barlow, sans-serif", color: "#fff", size: 12 } }, ...o };
}
const CONFIG = { displaylogo: false, responsive: true, displayModeBar: "hover", modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"] };
function mount(id, traces, lay, height = 320) {
  const node = document.getElementById(id);
  if (!node) return;
  node.style.height = height + "px";
  node.setAttribute("role", "img");
  Plotly.react(node, traces, layout({ ...lay, height }), CONFIG);
}

// ── Small builders ─────────────────────────────────────────────────────────
function segb(id, options, value, onChange) {
  const box = document.getElementById(id); if (!box) return;
  box.replaceChildren(...options.map(([v, label]) => el("button", { type: "button", "aria-pressed": String(v === value),
    onclick: (ev) => { for (const b of box.children) b.setAttribute("aria-pressed", String(b === ev.currentTarget)); onChange(v); } }, label)));
}
function meter(v, p) {
  const trk = el("span", { class: "trk" });
  if (isNum(v)) {
    const c = Math.max(-0.5, Math.min(1, v)), zero = 100 / 3, w = Math.abs(c) * (200 / 3);
    trk.append(el("span", { class: "fill " + (c >= 0 ? "p" : "n"), style: `left:${c >= 0 ? zero : zero - w}%;width:${w}%` }));
  }
  const lab = el("span", { class: "lab " + (!isNum(v) ? "" : v > 0 ? "pos" : "neg"), text: spct(v) });
  const wrap = el("span", { class: "meter", title: isNum(p) ? `Diebold-Mariano p = ${p}` : "" }, [trk, lab]);
  if (isNum(p)) wrap.append(el("span", { class: "sig " + (p < 0.05 ? (v > 0 ? "yes" : "neg") : "no"), text: p < 0.05 ? "sig" : "n.s." }));
  return wrap;
}
function tile(label, value, unit, delta) {
  return el("div", { class: "tile" }, [el("span", { class: "label eyebrow", text: label }),
    el("span", { class: "value" }, [value, unit ? el("span", { class: "unit", text: unit }) : null]),
    delta ? el("span", { class: "delta", text: delta }) : null]);
}
function sortable(container, cols, rows, opts = {}) {
  let key = opts.key || null, dir = opts.dir || 1;
  const draw = () => {
    const sorted = key ? rows.slice().sort((a, b) => {
      const c = cols.find((x) => x.key === key), x = c.sortv ? c.sortv(a) : a[key], y = c.sortv ? c.sortv(b) : b[key];
      const xn = num(x), yn = num(y);
      if (xn !== null && yn !== null) return (xn - yn) * dir;
      if (x === y) return 0; if (x === null || x === undefined || x === "") return 1; if (y === null || y === undefined || y === "") return -1;
      return String(x) < String(y) ? -dir : dir;
    }) : rows;
    const thead = el("thead", {}, el("tr", {}, cols.map((c) => el("th", { class: (c.n ? "n " : "") + (c.lo ? "lo" : ""), role: "button", tabindex: "0",
      "aria-sort": key === c.key ? (dir > 0 ? "ascending" : "descending") : "none", title: c.tip || null,
      onclick: () => { dir = key === c.key ? -dir : (c.n ? -1 : 1); key = c.key; draw(); },
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } } }, c.label))));
    const tbody = el("tbody", {}, sorted.map((r) => {
      const tr = el("tr", { class: opts.onRow ? "clickable" : "", tabindex: opts.onRow ? "0" : null,
        onclick: opts.onRow ? () => opts.onRow(r) : null, onkeydown: opts.onRow ? (e) => { if (e.key === "Enter") opts.onRow(r); } : null });
      for (const c of cols) {
        const v = c.render ? c.render(r) : r[c.key];
        tr.append(el("td", { class: (c.n ? "n " : "") + (c.t ? "t " : "") + (c.lo ? "lo" : "") }, v instanceof Node ? v : String(v ?? "—")));
      }
      return tr;
    }));
    container.replaceChildren(el("table", { class: "data" }, [thead, tbody]));
  };
  draw();
}
const ccTag = (cc) => el("span", { class: "cc", text: cc });
const unitTag = (u) => el("span", { class: "unit", text: u });

// ── Shell ───────────────────────────────────────────────────────────────────
function showTab(tab) {
  state.tab = tab;
  for (const t of $$(".tab")) t.setAttribute("aria-selected", String(t.dataset.tab === tab));
  for (const p of $$(".panel")) p.hidden = p.id !== "tab-" + tab;
  writeHash();
  render[tab] && render[tab]();
  window.scrollTo({ top: 0 });
}
function openEconomy(cc, page) {
  if (page === "gdp") return showTab("growth");
  state.cc = cc; state.target = null; showTab("country");
}

function renderTicker() {
  const ahead = BOARD.board.filter((r) => isHead(r) && daysTo(r.release) >= 0).sort((a, b) => (a.release < b.release ? -1 : 1));
  const box = $("#ticker");
  box.replaceChildren(el("div", { class: "tick-head", text: "Releases ahead" }), ...ahead.map((r) => el("button", { class: "tick", type: "button",
    title: `${r.economy} ${r.label}, ${r.unit}`, onclick: () => openEconomy(r.cc, r.page) }, [
    el("span", { class: "code", text: r.family === "GDP" ? "GDP" : r.cc }),
    el("span", { class: "when", text: dayFmt(r.release) }),
    el("span", { class: "bank" }, [el("span", { class: "call-t", text: val(num(r.nowcast), r.unit) }), " ", r.family === "GDP" ? "US " + r.label : r.label])])));
}

// ── Monitor ────────────────────────────────────────────────────────────────
const render = {};
render.monitor = function () {
  const b = BOARD.board, heads = b.filter(isHead), econ = BOARD.economies;
  const nextR = b.filter((r) => daysTo(r.release) >= 0).sort((x, y) => (x.release < y.release ? -1 : 1))[0];
  const sigN = econ.filter((e) => isNum(e.p_n) && e.p_n < 0.05 && e.skill_n > 0).length;
  const benches = b.filter((r) => num(r.skill_bench) !== null);
  const lp = BOARD.lastprint, inBand = lp.filter((r) => truthy(r.in_band)).length;
  $("#hero-sub").textContent = `Our call for the next CPI print in ${econ.length} economies and the next US GDP print, built bottom-up from the widest net of public prices and data we can find, every input dated by when it was published. ${nextR ? `Next up: ${nextR.economy} ${nextR.label} on ${longDay(nextR.release)}, where we have ${val(num(nextR.nowcast), nextR.unit)}${nextR.unit}.` : ""}`;
  $("#kpis").replaceChildren(
    tile("Next release", nextR ? dayFmt(nextR.release).replace(",", "") : "—", "", nextR ? `${nextR.cc} ${nextR.label} · ours ${val(num(nextR.nowcast), nextR.unit)}` : ""),
    tile("Live nowcasts", String(b.length), "targets", `${econ.length} economies · CPI and GDP`),
    tile("Beat last print", `${heads.filter((r) => num(r.skill_naive) > 0).length}/${heads.length}`, "headline", `${sigN} significant at 5%`),
    tile("Beat benchmark", `${benches.filter((r) => num(r.skill_bench) > 0).length}/${benches.length}`, "targets", "Cleveland, Focus, REM, GDPNow"),
    tile("Last round in band", `${inBand}/${lp.length}`, "80% band", `expect about ${Math.round(lp.length * 0.8)}`),
    tile("Calibration", pct(BOARD.pooled.calib.find((c) => c.level === 0.8).actual), "in 80%", `${BOARD.pooled.n.toLocaleString("en-GB")} prints since 2015`));
  $("#mon-explain").innerHTML = "";
  $("#mon-explain").append(el("b", { text: "What's that number? " }), "Every figure is a release-eve call: what we would have said the day before each print using only data published by then. Skill compares our errors with a simple rule (repeat last month's print) and with the published benchmark where one exists; the volt ", el("span", { class: "sig yes", text: "sig" }), " mark means the gap passes a Diebold-Mariano test at 5%.");
  segb("seg-scope", [["headline", "Headline"], ["all", "All targets"]], state.scope, (v) => { state.scope = v; drawBoard(); });
  segb("seg-region", [["all", "All"], ["Americas", "Americas"], ["Europe", "Europe"], ["Asia-Pacific", "Asia-Pac"], ["GDP", "GDP"]], state.region, (v) => { state.region = v; drawBoard(); });
  const s = $("#board-search"); s.oninput = () => { state.search = s.value.trim().toLowerCase(); drawBoard(); };
  drawBoard(); drawHeat(); drawSkill(); drawLast(); drawCalib();
};

const moveOf = (r) => { if (!isHead(r) || r.family === "GDP") return null; const e = BOARD.economies.find((x) => x.cc === r.cc && x.headline === r.target); return e && isNum(e.move_7d) ? e.move_7d : null; };
function drawBoard() {
  const rows = BOARD.board.filter((r) => (state.scope === "all" || isHead(r))
    && (state.region === "all" || (state.region === "GDP" ? r.family === "GDP" : r.region === state.region))
    && (!state.search || `${r.economy} ${r.cc} ${r.label} ${r.family}`.toLowerCase().includes(state.search)));
  $("#board-count").textContent = rows.length + (rows.length === 1 ? " target" : " targets");
  sortable($("#board"), [
    { key: "release", label: "Release", render: (r) => el("span", {}, [dayFmt(r.release), daysTo(r.release) >= 0 ? el("span", { class: "unit", text: "T−" + daysTo(r.release) }) : null]) },
    { key: "economy", label: "Economy", render: (r) => el("span", {}, [ccTag(r.cc), r.economy]) },
    { key: "label", label: "Print", render: (r) => el("span", {}, [r.label, unitTag(r.unit)]) },
    { key: "period", label: "Period", lo: true, render: (r) => periodFmt(r.period) },
    { key: "nowcast", label: "Ours", n: true, render: (r) => el("b", { class: "pos", text: val(num(r.nowcast), r.unit) }) },
    { key: "move", label: "7-day move", n: true, sortv: (r) => moveOf(r), render: (r) => { const m = moveOf(r); return el("span", { class: m === null ? "" : m > 0.0005 ? "up" : m < -0.0005 ? "down" : "", text: m === null ? "—" : sg(m, 3) }); } },
    { key: "sd", label: "±1σ", n: true, lo: true, render: (r) => f2(num(r.sd)) },
    { key: "mode", label: "Mode", n: true, render: (r) => String(r.mode ?? "—") },
    { key: "p_mode", label: "P(mode)", n: true, lo: true, render: (r) => pct(num(r.p_mode)) },
    { key: "last", label: "Last", n: true, render: (r) => String(r.last ?? "—") },
    { key: "p_up", label: "P(> last)", n: true, render: (r) => { const p = num(r.p_up); return el("span", { class: p === null ? "" : p >= 0.6 ? "up" : p <= 0.4 ? "down" : "", text: pct(p) }); } },
    { key: "bench", label: "Benchmark", lo: true, render: (r) => r.bench_name ? el("span", {}, [r.bench_name, num(r.bench) !== null ? el("span", { class: "unit", text: val(num(r.bench), r.unit) }) : null]) : "—" },
    { key: "market", label: "Kalshi", n: true, lo: true, render: (r) => num(r.market) !== null ? el("span", { class: "unit", style: "margin:0", text: val(num(r.market), r.unit) }) : "—" },
    { key: "skill_naive", label: "Skill v last", sortv: (r) => num(r.skill_naive), render: (r) => meter(num(r.skill_naive), null) },
    { key: "skill_bench", label: "Skill v bench", lo: true, sortv: (r) => num(r.skill_bench), render: (r) => r.bench_name ? meter(num(r.skill_bench), null) : "—" },
    { key: "n", label: "Months", n: true, lo: true, render: (r) => String(r.n ?? "—") },
  ], rows, { key: "release", dir: 1, onRow: (r) => openEconomy(r.cc, r.page) });
}

function drawHeat() {
  const rows = BOARD.economies.filter((e) => e.unit === "% y/y" && isNum(e.mean) && isNum(e.last)).sort((a, b) => a.mean - b.mean);
  const y = rows.map((e) => e.name);
  const traces = [];
  rows.forEach((e) => traces.push({ type: "scatter", mode: "lines", x: [e.last, e.mean], y: [e.name, e.name], hoverinfo: "skip",
    line: { color: e.mean >= e.last ? C.hot : C.cool, width: 4 } }));
  traces.push({ type: "scatter", mode: "markers", x: rows.map((e) => e.last), y, name: "last print", marker: { color: C.naive, size: 9, symbol: "line-ns-open", line: { width: 3, color: C.naive } },
    hovertemplate: "%{y}<br>Last print %{x:.2f}%<extra></extra>" });
  traces.push({ type: "scatter", mode: "markers+text", x: rows.map((e) => e.mean), y, name: "ours", marker: { color: C.ours, size: 11, line: { color: C.card, width: 2 } },
    text: rows.map((e) => e.mean.toFixed(1)), textposition: rows.map((e) => (e.mean >= e.last ? "middle right" : "middle left")),
    textfont: { family: COND, size: 12, color: C.ink1 }, customdata: rows.map((e) => [e.last, e.period, e.sd]),
    hovertemplate: "%{y}<br>Ours %{x:.2f}% ± %{customdata[2]:.2f} for %{customdata[1]}<br>Last print %{customdata[0]:.2f}%<extra></extra>" });
  const ar = rows.find((e) => e.cc === "AR");
  const xs = rows.filter((e) => e.cc !== "AR").flatMap((e) => [e.mean, e.last]);
  mount("chart-heat", traces.filter((t) => !(t.y && t.y.length === 2 && ar && t.y[0] === ar.name)), {
    xaxis: axis("Headline CPI, % y/y", { range: [Math.min(0, Math.min(...xs) - 0.5), Math.max(...xs) + 0.9] }),
    yaxis: axis("", { tickfont: { family: COND, size: 12, color: C.ink2 } }), margin: { l: 120, r: 24, t: 6, b: 44 },
    annotations: ar ? [{ xref: "paper", yref: "y", x: 1, y: ar.name, xanchor: "right", text: `Argentina: ${ar.last.toFixed(1)} → ${ar.mean.toFixed(1)} (off scale)`, showarrow: false, font: { family: COND, size: 12, color: C.ink3 } }] : [],
  }, Math.max(300, rows.length * 24 + 60));
}

function drawSkill() {
  const rows = BOARD.economies.filter((e) => isNum(e.skill_n)).sort((a, b) => a.skill_n - b.skill_n);
  const gdp = BOARD.board.find((r) => r.family === "GDP");
  const items = rows.map((e) => ({ name: e.cc === "US" ? "US CPI" : e.name, k: e.skill_n, p: e.p_n, b: e.skill_b, pb: e.p_b, bn: e.bench_name, cc: e.cc }));
  if (gdp) items.unshift({ name: "US GDP", k: num(gdp.skill_naive), p: null, b: num(gdp.skill_bench), pb: null, bn: "GDPNow", cc: "GDP" });
  const y = items.map((d) => d.name);
  mount("chart-skill", [
    { type: "bar", orientation: "h", x: items.map((d) => d.k), y, marker: { color: items.map((d) => (d.k < 0 ? C.hot : C.ours)),
      line: { color: items.map((d) => (isNum(d.p) && d.p < 0.05 ? C.actual : "rgba(0,0,0,0)")), width: 2 } },
      text: items.map((d) => spct(d.k)), textposition: "outside", textfont: { family: COND, size: 12, color: C.ink1 }, cliponaxis: false,
      customdata: items.map((d) => [isNum(d.p) ? d.p.toFixed(3) : "n/a"]), hovertemplate: "%{y}<br>Skill v last print %{x:.0%}<br>DM p = %{customdata[0]}<extra></extra>" },
    { type: "scatter", mode: "markers", x: items.map((d) => d.b), y, marker: { symbol: "diamond", size: 12, color: C.bench, line: { color: C.card, width: 1.5 } },
      customdata: items.map((d) => [d.bn || "", isNum(d.pb) ? d.pb.toFixed(3) : "n/a"]), hovertemplate: "%{y}<br>Skill v %{customdata[0]} %{x:.0%}<br>DM p = %{customdata[1]}<extra></extra>" },
  ], { xaxis: axis("Skill: 1 − RMSE ours ÷ RMSE reference", { tickformat: ".0%", zeroline: true, zerolinewidth: 2 }), yaxis: axis("", { tickfont: { family: COND, size: 12, color: C.ink2 } }),
    margin: { l: 110, r: 40, t: 6, b: 44 }, bargap: 0.35 }, Math.max(300, items.length * 24 + 60));
}

function drawLast() {
  const chip = (v, yes, no) => (v === null || v === undefined || v === "" ? "—" : el("span", { class: "chip " + (truthy(v) ? "in" : "out"), text: truthy(v) ? yes : no }));
  const rows = BOARD.lastprint.slice().sort((a, b) => Math.abs(num(b.z) || 0) - Math.abs(num(a.z) || 0));
  sortable($("#lastprint"), [
    { key: "economy", label: "Economy", render: (r) => el("span", {}, [ccTag(r.family === "GDP" ? "GDP" : r.cc), r.economy]) },
    { key: "label", label: "Print", render: (r) => el("span", {}, [r.label, unitTag(r.unit)]) },
    { key: "period", label: "Period" },
    { key: "actual", label: "Printed", n: true, render: (r) => el("b", { text: String(r.actual) }) },
    { key: "ours", label: "Our call", n: true, render: (r) => el("span", { class: "pos", text: f2(num(r.ours)) }) },
    { key: "err", label: "Miss", n: true, render: (r) => sg(num(r.err)) },
    { key: "z", label: "z", n: true, render: (r) => { const z = num(r.z); return el("span", { class: z !== null && Math.abs(z) >= 1.2816 ? "neg" : "", text: sg(z) }); } },
    { key: "in_band", label: "80% band", render: (r) => chip(r.in_band, "inside", "outside") },
    { key: "mode_hit", label: "Exact", lo: true, render: (r) => chip(r.mode_hit, "hit", "miss") },
    { key: "naive", label: "Last print", n: true, lo: true, render: (r) => String(r.naive ?? "—") },
    { key: "beat_naive", label: "v last print", render: (r) => chip(r.beat_naive, "closer", "further") },
    { key: "bench_name", label: "Benchmark", lo: true, render: (r) => (r.bench_name ? `${r.bench_name} ${f2(num(r.bench))}` : "—") },
    { key: "beat_bench", label: "v benchmark", lo: true, render: (r) => chip(r.beat_bench, "closer", "further") },
  ], rows, { onRow: (r) => openEconomy(r.cc, r.page) });
}

function drawCalib() {
  const p = BOARD.pooled;
  const c80 = p.calib.find((c) => c.level === 0.8), c50 = p.calib.find((c) => c.level === 0.5), c95 = p.calib.find((c) => c.level === 0.95);
  $("#calib-tiles").replaceChildren(tile("Prints checked", p.n.toLocaleString("en-GB"), "", "headline, every economy"),
    tile("Inside 80% band", pct(c80.actual), "", "target 80%"), tile("Inside 95% band", pct(c95.actual), "", "target 95%: tails a touch fat"),
    tile("Inside 50% band", pct(c50.actual), "", "target 50%"));
  calibChart("chart-calib", p.calib, 300);
  mount("chart-pit", [{ type: "bar", x: p.pit.map((_, i) => `${i * 10}-${i * 10 + 10}`), y: p.pit, marker: { color: C.ours },
    hovertemplate: "Percentile %{x}<br>%{y} prints<extra></extra>" },
    { type: "scatter", mode: "lines", x: p.pit.map((_, i) => `${i * 10}-${i * 10 + 10}`), y: p.pit.map(() => p.n / 10), line: { color: C.naive, dash: "dash", width: 2 }, hoverinfo: "skip" }],
  { xaxis: axis("Where the print landed in our distribution (percentile)"), yaxis: axis("Prints"), bargap: 0.08,
    annotations: [{ x: 9, y: p.n / 10, text: "dashed line = perfectly calibrated", showarrow: false, yshift: 12, xanchor: "right", font: { family: COND, size: 12, color: C.ink3 } }] }, 300);
}
function calibChart(id, calib, h) {
  mount(id, [{ type: "scatter", mode: "lines", x: [0.4, 1], y: [0.4, 1], line: { color: C.naive, dash: "dash", width: 1.5 }, hoverinfo: "skip" },
    { type: "scatter", mode: "lines+markers+text", x: calib.map((c) => c.level), y: calib.map((c) => c.actual), line: { color: C.ours, width: 3 },
      marker: { size: 10, color: C.ours }, text: calib.map((c) => pct(c.actual)), textposition: "top left", textfont: { family: COND, size: 12, color: C.ink1 },
      hovertemplate: "Band %{x:.0%}: %{y:.1%} of prints inside<extra></extra>" }],
  { xaxis: axis("Stated band (our uncertainty)", { tickformat: ".0%", range: [0.42, 1] }), yaxis: axis("Share of prints inside", { tickformat: ".0%", range: [0.4, 1.02] }),
    annotations: [{ x: 0.98, y: 0.98, text: "dashed line = spot on", showarrow: false, xanchor: "right", font: { family: COND, size: 12, color: C.ink3 } }] }, h);
}

// ── Economies ──────────────────────────────────────────────────────────────
render.economies = function () {
  const econ = BOARD.economies;
  const ranked = econ.filter((e) => isNum(e.skill_n)).sort((a, b) => b.skill_n - a.skill_n);
  $("#power").replaceChildren(...ranked.map((e, i) => el("button", { class: "prow", type: "button", onclick: () => openEconomy(e.cc) }, [
    el("span", { class: "rk", text: String(i + 1) }), el("span", { class: "nm", text: e.name }),
    el("span", { class: "val", text: spct(e.skill_n) }),
    el("span", { class: "sub", text: `${e.n} months · ${isNum(e.p_n) && e.p_n < 0.05 ? "significant" : "not significant"} · 80% band ${pct(e.cover80)}` })])));
  segb("seg-eco-region", [["all", "All"], ["Americas", "Americas"], ["Europe", "Europe"], ["Asia-Pacific", "Asia-Pac"]], state.ecoRegion, (v) => { state.ecoRegion = v; drawMultiples(); });
  drawMultiples();
  const pts = econ.filter((e) => e.unit === "% y/y" && e.cc !== "AR");
  const lo = Math.min(...pts.flatMap((e) => [e.mean, e.last])) - 0.5, hi = Math.max(...pts.flatMap((e) => [e.mean, e.last])) + 0.5;
  mount("chart-xs", [{ type: "scatter", mode: "lines", x: [lo, hi], y: [lo, hi], line: { color: C.naive, dash: "dash", width: 1.5 }, hoverinfo: "skip" },
    { type: "scatter", mode: "markers+text", x: pts.map((e) => e.last), y: pts.map((e) => e.mean), text: pts.map((e) => e.cc), textposition: "top center",
      textfont: { family: COND, size: 12, color: C.ink1 }, marker: { size: 12, color: pts.map((e) => (e.mean >= e.last ? C.hot : C.cool)), line: { color: C.card, width: 2 } },
      customdata: pts.map((e) => [e.name, e.period]), hovertemplate: "%{customdata[0]} (%{customdata[1]})<br>Last %{x:.2f}% → ours %{y:.2f}%<extra></extra>" }],
  { xaxis: axis("Last print, % y/y", { range: [lo, hi] }), yaxis: axis("Our call, % y/y", { range: [lo, hi] }),
    annotations: [{ x: lo + 0.2, y: hi - 0.2, text: "we expect a rise", showarrow: false, xanchor: "left", font: { family: COND, size: 13, color: C.hot } },
      { x: hi - 0.2, y: lo + 0.2, text: "we expect a fall", showarrow: false, xanchor: "right", font: { family: COND, size: 13, color: C.cool } }] }, 420);
};
function sparkSvg(vals, last, mean) {
  const v = vals.filter(isNum); if (v.length < 2) return el("span");
  const all = v.concat([mean]).filter(isNum), lo = Math.min(...all), hi = Math.max(...all), w = 130, h = 56, pad = 4;
  const X = (i) => pad + (i / v.length) * (w - 2 * pad), Y = (x) => h - pad - ((x - lo) / (hi - lo || 1)) * (h - 2 * pad);
  const path = v.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join("");
  const host = el("div");
  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="line-a" d="${path}"/>${isNum(mean) ? `<circle class="dot-o" cx="${X(v.length).toFixed(1)}" cy="${Y(mean).toFixed(1)}" r="3.5"/>` : ""}</svg>`;
  return host.firstElementChild;
}
function drawMultiples() {
  const econ = BOARD.economies.filter((e) => state.ecoRegion === "all" || e.region === state.ecoRegion);
  $("#multiples").replaceChildren(...econ.map((e) => el("button", { class: "mini", type: "button", onclick: () => openEconomy(e.cc), title: `${e.name}: ${e.label}, ${e.unit}` }, [
    el("span", { class: "t", text: e.cc }),
    el("span", { class: "vals" }, [el("span", { class: "call-v", text: val(e.mean, e.unit) }), el("span", { class: "last-v", text: "last " + (e.last ?? "—") })]),
    sparkSvg(e.spark, e.last, e.mean),
    el("span", { class: "name", text: `${e.name} · ${e.unit} · ${periodFmt(e.period)}` })])));
}

// ── Country ────────────────────────────────────────────────────────────────
render.country = async function () {
  const groups = [["Americas", "Americas"], ["Europe", "Europe"], ["Asia-Pacific", "Asia-Pac"]];
  const pick = $("#picker"); pick.replaceChildren();
  for (const [g, label] of groups) {
    pick.append(el("span", { class: "grp", text: label }));
    for (const e of BOARD.economies.filter((x) => x.region === g)) pick.append(el("button", { type: "button", "aria-pressed": String(e.cc === state.cc), title: e.name,
      onclick: () => { state.cc = e.cc; state.target = null; state.daily = null; writeHash(); render.country(); } }, e.cc));
  }
  let F;
  try { F = await load(`country/${state.cc}.json`); } catch (e) { $("#call").replaceChildren(el("div", { class: "left" }, "This economy's feed did not load.")); return; }
  if (!state.target || !F.targets.find((t) => t.id === state.target)) state.target = F.headline;
  const T = F.targets.find((t) => t.id === state.target);
  segb("seg-target", F.targets.map((t) => [t.id, `${t.label} ${t.unit.replace("% ", "")}`]), state.target, (v) => { state.target = v; render.country(); });
  segb("seg-lookback", [["3", "3Y"], ["5", "5Y"], ["10", "10Y"], ["0", "All"]], state.look, (v) => { state.look = v; drawCountryCharts(F, F.targets.find((t) => t.id === state.target)); });
  drawCall(F, T);
  drawCountryCharts(F, T);
  drawExtras(F, T);
};
function pAbove(T, x) { return T.dist.filter(([k]) => k > x + 1e-9).reduce((s, [, p]) => s + p, 0); }
function drawCall(F, T) {
  const k = daysTo(T.release), mode = T.dist.find(([k2]) => Math.abs(k2 - T.mode) < 1e-9);
  const w = T.windows[0] || {};
  const lines = [["Last print", f2(T.last), ""], ["Most likely print", String(T.mode), mode ? pct(mode[1]) + " chance" : ""],
    ["Chance it prints above last", isNum(T.last) ? pct(pAbove(T, T.last)) : "—", ""],
    ["80% range", isNum(T.sd) ? `${f2(T.mean - 1.2816 * T.sd)} to ${f2(T.mean + 1.2816 * T.sd)}` : "—", ""],
    [`Skill v last print (${w.n || 0} months)`, spct(w.skill_n), isNum(w.p_n) ? (w.p_n < 0.05 ? "significant" : "not significant") : ""]];
  if (T.bench_name) lines.push([`Skill v ${T.bench_name}`, spct(w.skill_b), isNum(w.p_b) ? (w.p_b < 0.05 ? "significant" : "not significant") : ""]);
  if (isNum(T.bench_now)) lines.push([`${T.bench_name} now`, val(T.bench_now, T.unit), ""]);
  $("#call").replaceChildren(
    el("div", { class: "left" }, [el("div", { class: "who", text: `${F.subregion || F.region} · ${F.agency}` }), el("div", { class: "name", text: F.name }),
      el("div", { class: "meta", text: `${T.label}, ${T.unit} · ${periodFmt(T.period)} · releases ${T.release ? dayFmt(T.release) : "—"}${k >= 0 ? ` (in ${k} day${k === 1 ? "" : "s"})` : ""}` }),
      el("div", { class: "big" }, [el("b", { text: val(T.mean, T.unit) }), el("span", { text: `± ${f2(T.sd)} · our call` })]),
      el("div", { class: "meta", text: `Run ${T.as_of || "—"} UTC` })]),
    el("div", { class: "right" }, el("div", { class: "lines" }, lines.map(([a, b, c]) => el("div", { class: "line" }, [el("span", { text: a }), el("b", {}, [b, c ? el("small", { text: c }) : null])])))));
}
function cut(rows, key = "m") {
  if (state.look === "0") return rows;
  const d = new Date(); d.setFullYear(d.getFullYear() - +state.look);
  const lim = d.toISOString().slice(0, 7);
  return rows.filter((r) => r[key] >= lim);
}
function drawCountryCharts(F, T) {
  // distribution
  $("#dist-title").textContent = `${T.label}: chance of each print`;
  const ds = T.dist.filter(([, p]) => p >= 0.002);
  const dec = ds.some(([k]) => Math.abs(k * 10 - Math.round(k * 10)) > 1e-6) ? 2 : 1;
  const xs = ds.map(([k]) => k.toFixed(dec)), lastK = isNum(T.last) ? T.last.toFixed(dec) : null;
  const leg = [el("span", {}, [el("i", { style: "background:var(--signal)" }), "our chance"]), el("span", {}, [el("i", { style: "background:var(--volt)" }), "last print"])];
  if (isNum(T.bench_now)) leg.push(el("span", {}, [el("i", { style: "background:var(--c-bench)" }), T.bench_name]));
  $("#dist-legend").replaceChildren(...leg);
  const shapes = [];
  if (lastK && xs.includes(lastK)) shapes.push({ type: "line", xref: "x", yref: "paper", x0: lastK, x1: lastK, y0: 0, y1: 1, line: { color: C.actual, width: 2, dash: "dot" } });
  if (isNum(T.bench_now)) { const bk = (Math.round(T.bench_now * 10 ** dec) / 10 ** dec).toFixed(dec); if (xs.includes(bk)) shapes.push({ type: "line", xref: "x", yref: "paper", x0: bk, x1: bk, y0: 0, y1: 1, line: { color: C.bench, width: 2 } }); }
  mount("chart-dist", [{ type: "bar", x: xs, y: ds.map(([, p]) => p), marker: { color: xs.map((x) => (Math.abs(+x - T.mode) < 1e-9 ? C.actual : C.ours)) },
    hovertemplate: "Print %{x}" + (T.unit.includes("%") ? "%" : "") + "<br>Our chance %{y:.1%}<extra></extra>" }],
  { xaxis: axis(`Print, ${T.unit}`, { type: "category", tickangle: 0, nticks: 12 }), yaxis: axis("Our chance", { tickformat: ".0%" }), bargap: 0.18, shapes }, 300);
  $("#dist-note").textContent = `Most likely print in volt. The chance of each print at the agency's rounding, from 20,000 joint draws of every component, rounded the way ${F.agency} rounds.`;
  // history
  const H = cut(T.history);
  $("#hist-ctx").textContent = `${T.unit} · release-eve nowcast v first print · ${H.length} months`;
  const leg2 = [el("span", {}, [el("i", { style: "background:var(--volt)" }), "first print"]), el("span", {}, [el("i", { style: "background:var(--signal)" }), "ours (80% band)"]), el("span", {}, [el("i", { class: "dash" }), "last print (naive)"])];
  if (H.some((r) => isNum(r.b))) leg2.push(el("span", {}, [el("i", { style: "background:var(--c-bench)" }), T.bench_name || "benchmark"]));
  $("#hist-legend").replaceChildren(...leg2);
  const x = H.map((r) => M(r.m));
  const tr = [
    { type: "scatter", mode: "lines", x, y: H.map((r) => (isNum(r.sd) ? r.o + 1.2816 * r.sd : null)), line: { width: 0 }, hoverinfo: "skip" },
    { type: "scatter", mode: "lines", x, y: H.map((r) => (isNum(r.sd) ? r.o - 1.2816 * r.sd : null)), line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(125,147,255,0.16)", hoverinfo: "skip" },
    { type: "scatter", mode: "lines", x, y: H.map((r) => r.n), line: { color: C.naive, width: 1.5, dash: "dot" }, name: "naive", hovertemplate: "Naive %{y:.2f}<extra></extra>" },
  ];
  if (H.some((r) => isNum(r.b))) tr.push({ type: "scatter", mode: "lines", x, y: H.map((r) => r.b), line: { color: C.bench, width: 1.6 }, name: T.bench_name, hovertemplate: (T.bench_name || "Benchmark") + " %{y:.2f}<extra></extra>" });
  tr.push({ type: "scatter", mode: "lines", x, y: H.map((r) => r.o), line: { color: C.ours, width: 2.2 }, name: "ours", hovertemplate: "Ours %{y:.2f}<extra></extra>" },
    { type: "scatter", mode: "markers", x, y: H.map((r) => r.a), marker: { color: C.actual, size: 5 }, name: "print", hovertemplate: "%{x|%b %Y}<br>Print %{y:.2f}<extra></extra>" });
  mount("chart-hist", tr, { xaxis: axis("Reference month", { type: "date" }), yaxis: axis(T.unit), hovermode: "x unified" }, 340);
  // the path through the month
  const P = (T.path || []).filter((r) => isNum(r[1]));
  $("#path-ctx").textContent = P.length ? `${periodFmt(T.period)} · ${P.length} day${P.length === 1 ? "" : "s"} of runs` : "the daily archive starts with the next run";
  const px = P.map((r) => D(r[0]));
  const pshapes = isNum(T.last) ? [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: T.last, y1: T.last, line: { color: C.actual, width: 1.5, dash: "dot" } }] : [];
  mount("chart-path", [
    { type: "scatter", mode: "lines", x: px, y: P.map((r) => (isNum(r[2]) ? r[1] + 1.2816 * r[2] : null)), line: { width: 0 }, hoverinfo: "skip" },
    { type: "scatter", mode: "lines", x: px, y: P.map((r) => (isNum(r[2]) ? r[1] - 1.2816 * r[2] : null)), line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(125,147,255,0.16)", hoverinfo: "skip" },
    { type: "scatter", mode: "lines+markers", x: px, y: P.map((r) => r[1]), line: { color: C.ours, width: 2.6 }, marker: { size: 7, color: C.ours },
      customdata: P.map((r) => r[2]), hovertemplate: "%{x|%a %d %b}<br>Our call %{y:.3f} ± %{customdata:.2f}<extra></extra>" }],
  { xaxis: axis("Run date", { type: "date" }), yaxis: axis(T.unit), shapes: pshapes, hovermode: "x unified" }, 280);
  // accuracy windows
  const W = T.windows;
  sortable($("#acc"), [
    { key: "from", label: "From", render: (r) => `${monthFmt(r.start)} – ${monthFmt(r.end)}` },
    { key: "n", label: "n", n: true },
    { key: "rmse_o", label: "RMSE ours", n: true, render: (r) => el("b", { class: "pos", text: f3(r.rmse_o) }) },
    { key: "rmse_n", label: "Last print", n: true, render: (r) => f3(r.rmse_n) },
    { key: "skill_n", label: "Skill v last", render: (r) => meter(r.skill_n, r.p_n) },
    { key: "p_n", label: "DM p", n: true, lo: true, render: (r) => f3(r.p_n) },
    { key: "rmse_b", label: T.bench_name || "Benchmark", n: true, render: (r) => (isNum(r.rmse_b) ? `${f3(r.rmse_b)} (ours ${f3(r.rmse_ob)}, n ${r.n_b})` : "—") },
    { key: "skill_b", label: "Skill v bench", render: (r) => (isNum(r.skill_b) ? meter(r.skill_b, r.p_b) : "—") },
    { key: "bias", label: "Bias", n: true, lo: true, render: (r) => sg(r.bias, 3) },
    { key: "cover50", label: "Cover 50/80", n: true, render: (r) => `${pct(r.cover50)} / ${pct(r.cover80)}` },
    { key: "hit", label: "Hit", n: true, lo: true, render: (r) => pct(r.hit) },
  ], W);
  // rolling
  const R = cut(T.rolling);
  const leg3 = [el("span", {}, [el("i", { style: "background:var(--signal)" }), "ours"]), el("span", {}, [el("i", { class: "dash" }), "last print"])];
  if (R.some((r) => isNum(r.b))) leg3.push(el("span", {}, [el("i", { style: "background:var(--c-bench)" }), T.bench_name]));
  $("#roll-legend").replaceChildren(...leg3);
  const rt = [{ type: "scatter", mode: "lines", x: R.map((r) => M(r.m)), y: R.map((r) => r.n), line: { color: C.naive, dash: "dot", width: 1.6 }, hovertemplate: "Last print %{y:.3f}<extra></extra>" }];
  if (R.some((r) => isNum(r.b))) rt.push({ type: "scatter", mode: "lines", x: R.map((r) => M(r.m)), y: R.map((r) => r.b), line: { color: C.bench, width: 1.6 }, hovertemplate: (T.bench_name || "") + " %{y:.3f}<extra></extra>" });
  rt.push({ type: "scatter", mode: "lines", x: R.map((r) => M(r.m)), y: R.map((r) => r.o), line: { color: C.ours, width: 2.4 }, hovertemplate: "Ours %{y:.3f}<extra></extra>" });
  mount("chart-roll", rt, { xaxis: axis("Month", { type: "date" }), yaxis: axis("RMSE, pp", { rangemode: "tozero" }), hovermode: "x unified" }, 300);
  // z
  const Z = T.history.slice(-60).filter((r) => isNum(r.sd) && r.sd > 0);
  const z = Z.map((r) => (r.a - r.o) / r.sd);
  mount("chart-z", [{ type: "bar", x: Z.map((r) => M(r.m)), y: z, marker: { color: z.map((v) => (Math.abs(v) >= 1.2816 ? C.hot : C.slate)) },
    hovertemplate: "%{x|%b %Y}<br>z = %{y:.2f}<extra></extra>" }],
  { xaxis: axis("Reference month", { type: "date" }), yaxis: axis("Miss ÷ our sd (z)", { zeroline: true }),
    shapes: [-1.2816, 1.2816].map((v) => ({ type: "line", xref: "paper", x0: 0, x1: 1, y0: v, y1: v, line: { color: C.axis, dash: "dash", width: 1 } })),
    annotations: [{ xref: "paper", x: 1, y: 1.2816, text: "80% band", showarrow: false, xanchor: "right", yshift: 9, font: { family: COND, size: 12, color: C.ink3 } }] }, 300);
}

function drawExtras(F, T) {
  const box = $("#extras"); box.replaceChildren();
  const X = F.extras || {};
  const card = (title, ctx, cls = "") => { const f = el("figure", { class: "card " + cls }, el("figcaption", {}, el("h3", {}, [title, ctx ? el("span", { class: "ctx", text: ctx }) : null]))); box.append(f); return f; };
  if (X.groups && X.groups.length) {
    const f = card("Where this month's move comes from", "weight × forecast m/m, pp of the index", "half");
    const g = X.groups.slice().sort((a, b) => a.contribution_pp - b.contribution_pp);
    f.append(el("div", { class: "plot", id: "chart-groups" }));
    mount("chart-groups", [{ type: "bar", orientation: "h", x: g.map((r) => r.contribution_pp), y: g.map((r) => r.group), marker: { color: g.map((r) => (r.contribution_pp >= 0 ? C.hot : C.cool)) },
      text: g.map((r) => `${sg(r.contribution_pp, 3)} · w ${f1(r.weight)}%`), textposition: "outside", cliponaxis: false, textfont: { family: COND, size: 12, color: C.ink2 },
      hovertemplate: "%{y}<br>%{x:.3f} pp<extra></extra>" }],
    { xaxis: axis("Contribution to the month's change, pp", { zeroline: true, zerolinewidth: 2, range: [Math.min(0, ...g.map((r) => r.contribution_pp)) * 1.9 - 0.004, Math.max(0, ...g.map((r) => r.contribution_pp)) * 1.6 + 0.004] }), yaxis: axis("", { tickfont: { family: COND, size: 12, color: C.ink2 } }), margin: { l: 170, r: 90, t: 6, b: 44 } }, Math.max(260, g.length * 30 + 60));
  }
  if (X.daily && X.daily.length) {
    const tgt = F.cc === "US" ? (state.target === "core" ? "core" : "headline") : (state.target === "headline_mom" ? "headline_mom" : "headline_yoy");
    const months = [...new Set(X.daily.filter((r) => r.t === tgt).map((r) => r.month))].sort().reverse();
    if (!state.daily || !months.includes(state.daily)) state.daily = months[0];
    const f = card("The month, day by day", "what we would have said each business day", "half");
    const tools = el("div", { class: "segb", id: "seg-daily" }); f.querySelector("figcaption").append(el("div", { class: "card-tools" }, tools));
    f.append(el("div", { class: "plot", id: "chart-daily" }));
    const drawDaily = () => {
      const s = X.daily.filter((r) => r.t === tgt && r.month === state.daily);
      const x = s.map((r) => D(r.d)), last = s[s.length - 1];
      const tr = [{ type: "scatter", mode: "lines", x, y: s.map((r) => (isNum(r.sd) ? r.o + 1.2816 * r.sd : null)), line: { width: 0 }, hoverinfo: "skip" },
        { type: "scatter", mode: "lines", x, y: s.map((r) => (isNum(r.sd) ? r.o - 1.2816 * r.sd : null)), line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(125,147,255,0.16)", hoverinfo: "skip" },
        { type: "scatter", mode: "lines", x, y: s.map((r) => r.o), line: { color: C.ours, width: 2.4 }, hovertemplate: "%{x|%a %d %b}<br>Ours %{y:.2f}<extra></extra>" }];
      if (s.some((r) => isNum(r.b))) tr.push({ type: "scatter", mode: "lines", x, y: s.map((r) => r.b), line: { color: C.bench, width: 1.6 }, hovertemplate: "Cleveland Fed %{y:.2f}<extra></extra>" });
      const shapes = last && isNum(last.a) ? [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: last.a, y1: last.a, line: { color: C.actual, width: 2, dash: "dash" } }] : [];
      mount("chart-daily", tr, { xaxis: axis("Decision day", { type: "date" }), yaxis: axis(tgt.includes("yoy") ? "% y/y" : "% m/m"), hovermode: "x unified", shapes,
        annotations: last && isNum(last.a) ? [{ xref: "paper", x: 1, y: last.a, text: "print " + f1(last.a), showarrow: false, xanchor: "right", yshift: 10, font: { family: COND, size: 12, color: C.actual } }] : [] }, 300);
    };
    segb("seg-daily", months.slice(0, 6).map((m) => [m, monthFmt(m)]), state.daily, (v) => { state.daily = v; drawDaily(); });
    drawDaily();
  }
  if (X.kalshi && X.kalshi.length && F.cc === "US") {
    const tgt = state.target === "core" ? "core" : "headline";
    const k = X.kalshi.filter((r) => r.target === tgt).sort((a, b) => a.strike - b.strike);
    const f = card(`Chance the ${tgt} print beats each strike`, "ours v Kalshi (a reference, never an input)", "half");
    f.append(el("div", { class: "legend-row" }, [el("span", {}, [el("i", { style: "background:var(--signal)" }), "ours"]), el("span", {}, [el("i", { style: "background:var(--c-bench)" }), "Cleveland Fed mean, our spread"]), el("span", {}, [el("i", { class: "ring" }), "Kalshi last price"])]));
    f.append(el("div", { class: "plot", id: "chart-kalshi" }));
    mount("chart-kalshi", [
      { type: "scatter", mode: "lines+markers", x: k.map((r) => r.strike), y: k.map((r) => r.p_ours), line: { color: C.ours, width: 2.4 }, marker: { size: 7, color: C.ours }, hovertemplate: "Above %{x:.1f}%: ours %{y:.0%}<extra></extra>" },
      { type: "scatter", mode: "lines", x: k.map((r) => r.strike), y: k.map((r) => r.p_cleveland), line: { color: C.bench, width: 1.5, dash: "dot" }, hovertemplate: "Cleveland %{y:.0%}<extra></extra>" },
      { type: "scatter", mode: "markers", x: k.map((r) => r.strike), y: k.map((r) => r.price), marker: { size: 11, color: "rgba(0,0,0,0)", line: { color: C.market, width: 2 } }, hovertemplate: "Kalshi %{y:.0%}<extra></extra>" }],
    { xaxis: axis("Strike: SA m/m above X%", { dtick: 0.1 }), yaxis: axis("Chance of YES", { tickformat: ".0%", range: [0, 1.02] }) }, 300);
  }
  if (X.strategy && X.strategy.length && F.cc === "US") {
    const f = card("Kalshi scorecard, settled 2021-26", "Brier, lower is better · 10¢ rule P&L per $1 contract");
    const wrap = el("div", { class: "tablewrap" }); f.append(wrap);
    sortable(wrap, [{ key: "variant", label: "When", render: (r) => (r.variant === "last_day" ? "Last day before release" : "Every day") }, { key: "target", label: "Target" },
      { key: "model", label: "Signal", render: (r) => (r.model === "ours" ? "Ours" : "Cleveland Fed + our spread") },
      { key: "brier_model", label: "Brier", n: true, render: (r) => el("b", { class: r.brier_model < r.brier_market ? "pos" : "neg", text: f3(r.brier_model) }) },
      { key: "brier_market", label: "Market Brier", n: true, render: (r) => f3(r.brier_market) }, { key: "trades", label: "Trades", n: true },
      { key: "pnl", label: "P&L", n: true, render: (r) => sg(r.pnl) }, { key: "hit", label: "Hit", n: true, render: (r) => pct(r.hit) }], X.strategy);
  }
  if (X.components && X.components.length) {
    const f = card(`Every component (${X.components.length})`, "weight % of all items · forecast m/m pp · contribution pp");
    const wrap = el("div", { class: "tablewrap", style: "max-height:520px" }); f.append(wrap);
    const cols = [{ key: "name", label: "Component", render: (r) => el("span", {}, [r.name, r.core ? null : el("span", { class: "unit", text: F.cc === "US" ? "non-core" : "" })]) },
      { key: "group", label: "Group", lo: true }, { key: "w", label: "Weight", n: true, render: (r) => f2(r.w) },
      { key: "m", label: "Forecast", n: true, render: (r) => el("span", { class: r.m > 0 ? "up" : r.m < 0 ? "down" : "", text: sg(r.m, 3) }) },
      { key: "sd", label: "sd", n: true, lo: true, render: (r) => f3(r.sd) },
      { key: "c", label: "Contribution", n: true, render: (r) => sg(r.c, 4) }, { key: "model", label: "Model", lo: true, render: (r) => r.model || "—" }];
    if (F.cc === "US") cols.push({ key: "ind", label: "Indicator", lo: true, render: (r) => r.ind || "" }, { key: "vs_naive", label: "v naive", n: true, lo: true, render: (r) => (isNum(r.vs_naive) ? spct(r.vs_naive) : "—") });
    sortable(wrap, cols, X.components, { key: "w", dir: -1 });
  }
}

// ── Growth ─────────────────────────────────────────────────────────────────
render.growth = async function () {
  const G = await load("gdp.json"), n = G.nowcast;
  const k = daysTo(n.release);
  $("#gdp-title").textContent = `US real GDP, ${String(n.quarter).replace("Q", " Q")}`;
  $("#gdp-sub").textContent = `Our nowcast of BEA's advance estimate, q/q at an annual rate, out ${longDay(n.release)}${k >= 0 ? ` (in ${k} day${k === 1 ? "" : "s"})` : ""}. Built from monthly hard data and high-frequency series on real-time vintages; no market data at all. GDPNow, the New York Fed and Kalshi are shown for reference and never enter the model.`;
  $("#gdp-kpis").replaceChildren(tile("Our nowcast", f2(n.nowcast), "% SAAR", `± ${f2(n.sd)} · mode ${f1(n.mode)}`),
    tile("80% range", `${f1(n.band_lo)} to ${f1(n.band_hi)}`, "", "from our draws"), tile("Last quarter", f1(n.prev), "%", "latest estimate"),
    tile("GDPNow", f2(n.gdpnow), "%", "Atlanta Fed · reference"), tile("NY Fed", f2(n.nyfed), "%", "Staff Nowcast · reference"),
    tile("Kalshi median", f2(n.kalshi_median), "%", "implied · reference"));
  const s = G.strikes;
  mount("chart-strikes", [{ type: "scatter", mode: "lines+markers", x: s.map((r) => r.strike), y: s.map((r) => r.p_ours), line: { color: C.ours, width: 2.6 }, marker: { size: 7, color: C.ours }, hovertemplate: "Above %{x:.1f}%: ours %{y:.0%}<extra></extra>" },
    { type: "scatter", mode: "markers", x: s.map((r) => r.strike), y: s.map((r) => r.p_kalshi), marker: { size: 11, color: "rgba(0,0,0,0)", line: { color: C.market, width: 2 } }, hovertemplate: "Kalshi mid %{y:.0%}<extra></extra>" }],
  { xaxis: axis("Strike: advance print above X%, q/q SAAR"), yaxis: axis("Chance", { tickformat: ".0%", range: [0, 1.02] }),
    shapes: [{ type: "line", x0: n.nowcast, x1: n.nowcast, yref: "paper", y0: 0, y1: 1, line: { color: C.ours, dash: "dot", width: 1 } }] }, 320);
  const NAMES = { naive: "Naive (last quarter)", ar: "AR on GDP", bridge_hard: "Bridge, hard data", bridge_hf: "Bridge, hard + high-frequency", bridge_trade: "Bridge with trade",
    components: "Components", components_inv: "Components + inventories", components_v1: "Components, v1", dfm_hard: "Factor model, hard", dfm_hf: "Factor model + high-frequency", dfm_prt: "Factor model, pseudo-real-time" };
  const m = G.models.slice().sort((a, b) => a.nowcast - b.nowcast);
  mount("chart-models", [{ type: "bar", orientation: "h", x: m.map((r) => r.nowcast), y: m.map((r) => NAMES[r.model] || r.model),
    marker: { color: m.map((r) => (r.weight > 0 ? C.ours : C.slate)) }, text: m.map((r) => `${r.nowcast.toFixed(2)}${r.weight > 0 ? ` · w ${r.weight.toFixed(2)}` : ""}`),
    textposition: "outside", cliponaxis: false, textfont: { family: COND, size: 12, color: C.ink2 }, hovertemplate: "%{y}<br>%{x:.2f}%<extra></extra>" }],
  { xaxis: axis("Nowcast, % q/q SAAR", { rangemode: "tozero" }), yaxis: axis("", { tickfont: { family: COND, size: 12, color: C.ink2 } }), margin: { l: 190, r: 80, t: 6, b: 44 },
    shapes: [{ type: "line", x0: n.nowcast, x1: n.nowcast, yref: "paper", y0: 0, y1: 1, line: { color: C.actual, width: 2 } }],
    annotations: [{ x: n.nowcast, yref: "paper", y: 1.02, text: "blend " + f2(n.nowcast), showarrow: false, font: { family: COND, size: 12, color: C.actual } }] }, 360);
  const t = G.track.slice().sort((a, b) => b.days_before - a.days_before), xl = t.map((r) => r.days_before + (r.days_before === 1 ? " day" : " days"));
  mount("chart-horizon", [{ type: "bar", x: xl, y: t.map((r) => r.rmse_ours_on_gdpnow), marker: { color: C.ours }, name: "ours", hovertemplate: "Ours %{y:.2f}<extra></extra>" },
    { type: "bar", x: xl, y: t.map((r) => r.rmse_gdpnow), marker: { color: C.bench }, name: "GDPNow", hovertemplate: "GDPNow %{y:.2f}<extra></extra>" },
    { type: "bar", x: xl, y: t.map((r) => r.rmse_nyfed), marker: { color: C.bench2 }, name: "NY Fed", hovertemplate: "NY Fed %{y:.2f} (ours on same quarters %{customdata:.2f})<extra></extra>", customdata: t.map((r) => r.rmse_ours_on_nyfed) },
    { type: "scatter", mode: "markers", x: xl, y: t.map((r) => r.rmse_naive_ex), marker: { symbol: "line-ew-open", size: 30, color: C.naive, line: { color: C.naive, width: 2 } }, hovertemplate: "Naive %{y:.2f}<extra></extra>" }],
  { barmode: "group", bargap: 0.25, xaxis: axis("Days before the advance release", { type: "category" }), yaxis: axis("RMSE, pp of q/q SAAR", { rangemode: "tozero" }), hovermode: "x unified" }, 320);
  sortable($("#gdp-kalshi"), [{ key: "window", label: "When", render: (r) => (r.window === "last_day" ? "Last day before release" : "Every day with a price") },
    { key: "contract_days", label: "Contract-days", n: true }, { key: "quarters", label: "Quarters", n: true },
    { key: "brier_ours", label: "Ours", n: true, render: (r) => el("b", { class: r.brier_ours < r.brier_market ? "pos" : "neg", text: f3(r.brier_ours) }) },
    { key: "brier_market", label: "Market", n: true, render: (r) => f3(r.brier_market) }, { key: "brier_gdpnow", label: "GDPNow", n: true, render: (r) => f3(r.brier_gdpnow) }], G.kalshi);
  const drawH = () => {
    const h = G.history.filter((r) => String(r.days_before) === state.gdph && !["2020-06", "2020-09"].includes(r.quarter)).sort((a, b) => (a.quarter < b.quarter ? -1 : 1));
    const x = h.map((r) => M(r.quarter));
    mount("chart-gdphist", [{ type: "scatter", mode: "lines", x, y: h.map((r) => r.gdpnow), line: { color: C.bench, width: 1.5 }, hovertemplate: "GDPNow %{y:.2f}<extra></extra>" },
      { type: "scatter", mode: "lines", x, y: h.map((r) => r.nyfed), line: { color: C.bench2, width: 1.5 }, hovertemplate: "NY Fed %{y:.2f}<extra></extra>" },
      { type: "scatter", mode: "lines", x, y: h.map((r) => r.ours), line: { color: C.ours, width: 2.4 }, hovertemplate: "Ours %{y:.2f}<extra></extra>" },
      { type: "scatter", mode: "markers", x, y: h.map((r) => r.actual), marker: { color: C.actual, size: 7 }, hovertemplate: "%{x|%Y Q%q}<br>Advance print %{y:.1f}<extra></extra>" }],
    { xaxis: axis("Quarter (end month)", { type: "date" }), yaxis: axis("% q/q SAAR"), hovermode: "x unified" }, 360);
  };
  segb("seg-gdph", [["60", "60 days"], ["30", "30 days"], ["10", "10 days"], ["1", "1 day"]], state.gdph, (v) => { state.gdph = v; drawH(); });
  drawH();
};

// ── Track record ───────────────────────────────────────────────────────────
render.record = async function () {
  segb("seg-window", [["2015-01", "2015"], ["2021-01", "2021"], ["2024-01", "2024"]], state.window, (v) => { state.window = v; render.record(); });
  segb("seg-rscope", [["headline", "Headline"], ["all", "All"]], state.rscope, (v) => { state.rscope = v; render.record(); });
  const feeds = await Promise.all(BOARD.economies.map((e) => load(`country/${e.cc}.json`)));
  const rows = [];
  for (const F of feeds) for (const T of F.targets) {
    if (state.rscope === "headline" && !T.headline) continue;
    const w = T.windows.find((x) => x.from === state.window); if (!w) continue;
    rows.push({ cc: F.cc, name: F.name, label: T.label, unit: T.unit, bench_name: T.bench_name, ...w });
  }
  $("#rec-count").textContent = `${rows.length} targets · ${rows.filter((r) => r.skill_n > 0 && r.p_n < 0.05).length} significantly beat last print`;
  sortable($("#record"), [
    { key: "name", label: "Economy", render: (r) => el("span", {}, [ccTag(r.cc), r.name]) },
    { key: "label", label: "Target", render: (r) => el("span", {}, [r.label, unitTag(r.unit)]) },
    { key: "n", label: "n", n: true }, { key: "rmse_o", label: "RMSE ours", n: true, render: (r) => el("b", { class: "pos", text: f3(r.rmse_o) }) },
    { key: "rmse_n", label: "Last print", n: true, lo: true, render: (r) => f3(r.rmse_n) },
    { key: "skill_n", label: "Skill v last", sortv: (r) => r.skill_n, render: (r) => meter(r.skill_n, r.p_n) },
    { key: "skill_b", label: "Skill v benchmark", sortv: (r) => r.skill_b, render: (r) => (isNum(r.skill_b) ? el("span", {}, [meter(r.skill_b, r.p_b), el("span", { class: "unit", text: r.bench_name || "" })]) : "—") },
    { key: "bias", label: "Bias", n: true, lo: true, render: (r) => sg(r.bias, 3) },
    { key: "cover80", label: "80% cover", n: true, render: (r) => pct(r.cover80) }, { key: "hit", label: "Hit", n: true, lo: true, render: (r) => pct(r.hit) },
  ], rows, { key: "skill_n", dir: -1, onRow: (r) => openEconomy(r.cc) });
};

// ── Methodology ────────────────────────────────────────────────────────────
const GLOSS = [["Nowcast", "Our estimate of a print for a period that has ended or is under way, made with what was published by the decision time."],
  ["First print", "The value the agency first published. We score against it because markets settle on it and because later revisions were unknown at the time."],
  ["Release eve", "The decision time of the backtest: the earlier of ten days after month end and the business day before the release."],
  ["Point in time", "Every input is dated by when it was published, not the period it covers; revisions count from when they were first seen."],
  ["Skill", "1 − our RMSE ÷ the reference's RMSE on the same months. +40% means our errors are 40% smaller."],
  ["Diebold-Mariano", "A test of whether two forecasts' squared errors differ by more than luck, with Newey-West standard errors. We mark p under 0.05."],
  ["Naive (last print)", "The simplest serious rule: next print = last print. Any nowcast worth reading beats it."],
  ["Benchmark", "A published forecast of the same print (Cleveland Fed, BCB Focus, BCRA REM, GDPNow, NY Fed), used to score only."],
  ["80% band", "Our mean ± 1.28 standard deviations. Honest bands contain about four prints in five."],
  ["z", "The miss divided by our stated standard deviation; |z| over 1.28 is outside the 80% band."],
  ["Mode / P(mode)", "The most likely print at the agency's rounding and our chance of exactly that print."],
  ["P(> last)", "Our chance the print comes in above the last one: a direction call."],
  ["Calibration", "Whether the share of prints inside each stated band matches the band; the dashed diagonal is spot on."],
  ["Brier score", "Mean squared error of probabilities against outcomes for strike contracts; lower is better."]];
render.method = async function () {
  $("#glossary").replaceChildren(...GLOSS.map(([t, d]) => el("dl", {}, [el("dt", { text: t }), el("dd", { text: d })])));
  const L = await load("lineage.json");
  const s = $("#lineage-search");
  const draw = () => {
    const q = s.value.trim().toLowerCase();
    sortable($("#lineage"), [{ key: "economy", label: "Economy" }, { key: "use", label: "Use" }, { key: "what", label: "What it is", render: (r) => el("span", { style: "white-space:normal", text: r.what }) },
      { key: "counts_from", label: "Counts from" }, { key: "source", label: "Source id", t: true, lo: true }],
    L.filter((r) => !q || Object.values(r).join(" ").toLowerCase().includes(q)), { key: "economy", dir: 1 });
  };
  s.oninput = draw; draw();
};

// ── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  document.documentElement.dataset.theme = "dark";
  tokens();
  readHash();
  [META, BOARD] = await Promise.all([load("meta.json"), load("board.json")]);
  $("#freshness").replaceChildren(el("span", { text: "Nowcasts run " }), el("b", { text: META.as_of + " UTC" }), el("br"), el("span", { text: `${META.economies} economies · ${META.targets} targets` }));
  $("#built").textContent = `Built ${META.built}.`;
  for (const t of $$(".tab")) t.addEventListener("click", () => showTab(t.dataset.tab));
  for (const b of $$("[data-goto]")) b.addEventListener("click", () => showTab(b.dataset.goto));
  renderTicker();
  window.addEventListener("hashchange", () => { const was = state.tab + state.cc; readHash(); if (state.tab + state.cc !== was) showTab(state.tab); });
  showTab(["monitor", "economies", "country", "growth", "record", "method"].includes(state.tab) ? state.tab : "monitor");
}
boot().catch((e) => { const m = $("#main"); if (m) m.prepend(el("p", { class: "explain", text: "The data did not load: " + e.message })); });
