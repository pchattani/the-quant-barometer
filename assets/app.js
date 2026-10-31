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
  sort: { key: "release", dir: 1 }, ecoRegion: "all", window: "2015-01", rscope: "headline", gdph: "1", daily: null,
  hfView: "all", hfWin: "92", hfTarget: null, hfLeaf: null, gcc: "US", gtarget: null, gwin: null, gh: null };
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.get("tab")) state.tab = p.get("tab");
  if (p.get("cc")) state.cc = p.get("cc").toUpperCase();
  if (state.tab === "hf") state.hfView = p.get("cc") ? "one" : "all";
  if (state.tab === "growth") state.gcc = p.get("cc") ? p.get("cc").toUpperCase() : "US";
}
function writeHash() {
  const p = new URLSearchParams({ tab: state.tab });
  if (state.tab === "country" || (state.tab === "hf" && state.hfView === "one")) p.set("cc", state.cc);
  if (state.tab === "growth" && state.gcc !== "US") p.set("cc", state.gcc);
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

// ── Plotly theme (The Quant Macro tokens: the Governor's round 2) ──────────
// Planes, ink and roles come from the CSS tokens (base.css is the Governor's sheet; barometer.css adds the
// Barometer's roles), so the charts follow the stylesheet. Tick labels and hover figures are IBM Plex Mono.
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const C = {};
function tokens() {
  Object.assign(C, { ours: css("--signal"), actual: css("--c-actual"), naive: css("--c-naive"), bench: css("--c-bench"),
    bench2: css("--c-bench2"), market: css("--c-market"), hot: css("--hot"), cool: css("--cool"), grid: css("--grid"),
    axis: css("--axis"), ink1: css("--ink-1"), ink2: css("--ink-2"), ink3: css("--ink-3"), slate: css("--slate"), card: css("--s-1"),
    elev: css("--s-2"), border: css("--line-3"), live: css("--c-live"), lines: [1, 2, 3, 4, 5].map((i) => css("--c-line-" + i)) });
}
const COND = "Barlow Condensed, Barlow, Arial Narrow, sans-serif";
const MONO = "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
// regions, in the order the pickers and filters list them
const REGIONS = [["Americas", "Americas"], ["Europe", "Europe"], ["Asia-Pacific", "Asia-Pac"], ["Middle East and Africa", "MEA"]];
function axis(title, extra = {}) {
  return { title: { text: title, font: { family: COND, size: 12, color: C.ink2 }, standoff: 8 }, gridcolor: C.grid, zerolinecolor: C.axis,
    linecolor: C.axis, tickfont: { family: MONO, size: 11, color: C.ink3 }, automargin: true, ...extra };
}
function layout(o = {}) {
  return { paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)", font: { family: "Barlow, sans-serif", color: C.ink2, size: 12 },
    margin: { l: 56, r: 16, t: 10, b: 44 }, showlegend: false, hovermode: "closest",
    hoverlabel: { bgcolor: C.elev, bordercolor: C.border, font: { family: MONO, color: C.ink1, size: 11.5 } }, ...o };
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
  if (page === "gdp") { state.gcc = cc || "US"; state.gtarget = null; return showTab("growth"); }
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
  $("#hero-sub").textContent = `Our call for the next CPI print in ${econ.length} economies and the next GDP print, built bottom-up from the widest net of public prices and data we can find, every input dated by when it was published. ${nextR ? `Next up: ${nextR.economy} ${nextR.label} on ${longDay(nextR.release)}, where we have ${val(num(nextR.nowcast), nextR.unit)}${nextR.unit}.` : ""}`;
  $("#kpis").replaceChildren(
    tile("Next release", nextR ? dayFmt(nextR.release).replace(",", "") : "—", "", nextR ? `${nextR.cc} ${nextR.label} · ours ${val(num(nextR.nowcast), nextR.unit)}` : ""),
    tile("Live nowcasts", String(b.length), "targets", `${econ.length} economies · CPI and GDP`),
    tile("Beat last print", `${heads.filter((r) => num(r.skill_naive) > 0).length}/${heads.length}`, "headline", `${sigN} significant at 5%`),
    tile("Beat benchmark", `${benches.filter((r) => num(r.skill_bench) > 0).length}/${benches.length}`, "targets", "Cleveland, Focus, REM, GDPNow"),
    tile("Last round in band", `${inBand}/${lp.length}`, "80% band", `expect about ${Math.round(lp.length * 0.8)}`),
    tile("Calibration", pct(BOARD.pooled.calib.find((c) => c.level === 0.8).actual), "in 80%", `${BOARD.pooled.n.toLocaleString("en-GB")} prints since 2015`));
  $("#mon-explain").innerHTML = "";
  $("#mon-explain").append(el("b", { text: "What's that number? " }), "Every figure is a release-eve call: what we would have said the day before each print using only data published by then. Skill compares our errors with a simple rule (repeat last month's print) and with the published benchmark where one exists; the amber ", el("span", { class: "sig yes", text: "sig" }), " mark means the gap passes a Diebold-Mariano test at 5%.");
  segb("seg-scope", [["headline", "Headline"], ["all", "All targets"]], state.scope, (v) => { state.scope = v; drawBoard(); });
  segb("seg-region", [["all", "All"], ...REGIONS, ["GDP", "GDP"]], state.region, (v) => { state.region = v; drawBoard(); });
  const s = $("#board-search"); s.oninput = () => { state.search = s.value.trim().toLowerCase(); drawBoard(); };
  drawBoard(); drawHeat(); drawSkill(); drawLast(); drawCalib(); renderDigest();
};

// The month in five lines: built here from the board, the economies and the last-print scorecard.
function renderDigest() {
  const wrap = $("#week"), lede = $("#week-lede");
  if (!wrap) return;
  const E = BOARD.economies, b = BOARD.board, lp = BOARD.lastprint || [];
  const yy = E.filter((e) => e.unit === "% y/y" && isNum(e.mean) && isNum(e.last));
  const up = yy.filter((e) => e.mean > e.last + 0.05), down = yy.filter((e) => e.mean < e.last - 0.05);
  const big = yy.slice().sort((a, c) => Math.abs(c.mean - c.last) - Math.abs(a.mean - a.last))[0];
  const mover = E.filter((e) => isNum(e.move_7d)).sort((a, c) => Math.abs(c.move_7d) - Math.abs(a.move_7d))[0];
  const due = b.filter((r) => isHead(r) && daysTo(r.release) >= 0 && daysTo(r.release) <= 7).sort((a, c) => (a.release < c.release ? -1 : 1));
  const inBand = lp.filter((r) => truthy(r.in_band)).length, closer = lp.filter((r) => truthy(r.beat_naive)).length;
  const miss = lp.filter((r) => isNum(num(r.z))).sort((a, c) => Math.abs(num(c.z)) - Math.abs(num(a.z)))[0];
  lede.textContent = `${due.length} headline print${due.length === 1 ? " is" : "s are"} due in the next seven days. Our calls see headline inflation rising in ${up.length} economies and easing in ${down.length} of the ${yy.length} that publish it year on year. In the latest round, ${inBand} of ${lp.length} prints landed inside our 80% band and ${closer} were closer to our call than to the month before.`;
  const tile = (k, v, p, cls = "", unit = "") => el("div", { class: "week-tile" }, [el("span", { class: "k", text: k }), el("span", { class: `v ${cls}`.trim() }, [v, unit ? el("small", { text: unit }) : null]), el("p", { text: p })]);
  const open = (t, cc, page) => { t.classList.add("link"); t.setAttribute("role", "button"); t.tabIndex = 0; t.onclick = () => openEconomy(cc, page);
    t.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openEconomy(cc, page); } }; return t; };
  const tiles = [];
  if (big) tiles.push(open(tile("Biggest call", `${big.cc} ${sg(big.mean - big.last, 1)}`, `${big.name}: ${f1(big.last)}% last time, ${f1(big.mean)}% our call for ${periodFmt(big.period)}, out ${dayFmt(big.release)}. The largest expected change of any headline y/y print.`, big.mean >= big.last ? "up" : "down", "pp"), big.cc));
  if (mover) tiles.push(open(tile("Moved most, 7 days", `${mover.cc} ${sg(mover.move_7d, 2)}`, `Our ${mover.label} call for ${periodFmt(mover.period)} (${mover.unit}) moved ${sg(mover.move_7d, 2)} points in a week and stands at ${val(mover.mean, mover.unit)}. The call moves when an input lands.`, mover.move_7d >= 0 ? "up" : "down", "pp"), mover.cc));
  if (due.length) tiles.push(open(tile("Due this week", `${due.length} print${due.length === 1 ? "" : "s"}`, due.slice(0, 6).map((r) => `${r.family === "GDP" ? r.cc + " GDP" : r.cc} ${D(r.release).toLocaleDateString("en-GB", { weekday: "short" })} ${val(num(r.nowcast), r.unit)}`).join(" · ") + (due.length > 6 ? ` · and ${due.length - 6} more` : ""), "ours"), due[0].cc, due[0].page));
  else tiles.push(tile("Due this week", "None", "No headline print is due in the next seven days."));
  if (lp.length) tiles.push(miss ? open(tile("Latest round", `${inBand}/${lp.length}`, `inside our 80% band (about ${Math.round(lp.length * 0.8)} expected). Biggest miss: ${miss.economy} ${miss.label}, ${miss.period}, printed ${miss.actual} against our ${f2(num(miss.ours))} (z ${sg(num(miss.z))}).`, "", "in band"), miss.cc, miss.page) : tile("Latest round", `${inBand}/${lp.length}`, "inside our 80% band.", "", "in band"));
  tiles.push(tile("Hotter or cooler", `${up.length} ↑ ${down.length} ↓`, `Economies where we expect the next headline y/y print above or below the last by more than 0.05 points; ${yy.length - up.length - down.length} hold.`));
  wrap.replaceChildren(...tiles.slice(0, 5));
}

const moveOf = (r) => { if (!isHead(r) || r.family === "GDP") return null; const e = BOARD.economies.find((x) => x.cc === r.cc && x.headline === r.target); return e && isNum(e.move_7d) ? e.move_7d : null; };
function drawBoard() {
  const rows = BOARD.board.filter((r) => (state.scope === "all" || isHead(r))
    && (state.region === "all" || (state.region === "GDP" ? r.family === "GDP" : r.region === state.region))
    && (!state.search || `${r.economy} ${r.cc} ${r.label} ${r.family}`.toLowerCase().includes(state.search)));
  $("#board-count").textContent = rows.length + (rows.length === 1 ? " target" : " targets");
  sortable($("#board"), [
    { key: "release", label: "Release", render: (r) => el("span", {}, [dayFmt(r.release), daysTo(r.release) >= 0 ? el("span", { class: "unit", text: "T−" + daysTo(r.release) }) : el("span", { class: "unit", text: "out", title: "Printed already: the next period's call starts once its first data are published" })]) },
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
  traces.push({ type: "scatter", mode: "markers+text", x: rows.map((e) => e.mean), y, name: "ours", marker: { color: C.ours, size: 11, line: { color: C.ink1, width: 1.5 } },
    text: rows.map((e) => e.mean.toFixed(1)), textposition: rows.map((e) => (e.mean >= e.last ? "middle right" : "middle left")),
    textfont: { family: MONO, size: 12, color: C.ink1 }, customdata: rows.map((e) => [e.last, e.period, e.sd]),
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
    { type: "bar", orientation: "h", x: items.map((d) => d.k), y, marker: { color: items.map((d) => (d.k < 0 ? C.slate : C.ours)),
      line: { color: items.map((d) => (isNum(d.p) && d.p < 0.05 ? C.actual : "rgba(0,0,0,0)")), width: 2 } },
      text: items.map((d) => spct(d.k)), textposition: "outside", textfont: { family: MONO, size: 12, color: C.ink1 }, cliponaxis: false,
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
      marker: { size: 10, color: C.ours }, text: calib.map((c) => pct(c.actual)), textposition: "top left", textfont: { family: MONO, size: 12, color: C.ink1 },
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
  segb("seg-eco-region", [["all", "All"], ...REGIONS], state.ecoRegion, (v) => { state.ecoRegion = v; drawMultiples(); });
  drawMultiples();
  $("#eco-title").textContent = `${econ.length} economies. One scale.`;
  drawCrossSection(econ);
};
// Our call against the last print; an economy's last twelve first prints (each against the one before) trail
// behind its dot only while it is hovered, or after a click pins it.
function drawCrossSection(econ) {
  // high-inflation economies (above 15% y/y) would squeeze everyone else into a corner: named off scale instead
  const yy = econ.filter((e) => e.unit === "% y/y" && isNum(e.mean) && isNum(e.last));
  const off = yy.filter((e) => Math.max(e.mean, e.last) > 15), pts = yy.filter((e) => !off.includes(e));
  const trailOf = (e) => { const s = (e.spark || []).filter(isNum).slice(-13); return { x: s.slice(0, -1), y: s.slice(1) }; };
  const all = pts.flatMap((e) => [e.mean, e.last]);
  const lo = Math.min(...all) - 0.5, hi = Math.max(...all) + 0.5;
  mount("chart-xs", [{ type: "scatter", mode: "lines", x: [lo - 100, hi + 100], y: [lo - 100, hi + 100], line: { color: C.naive, dash: "dash", width: 1.5 }, hoverinfo: "skip" },
    { type: "scatter", mode: "markers+text", x: pts.map((e) => e.last), y: pts.map((e) => e.mean), text: pts.map((e) => e.cc), textposition: "top center",
      textfont: { family: COND, size: 12, color: C.ink1 }, marker: { size: 12, color: pts.map((e) => (e.mean >= e.last ? C.hot : C.cool)), line: { color: C.card, width: 2 } },
      customdata: pts.map((e) => [e.name, e.period]), hovertemplate: "%{customdata[0]} (%{customdata[1]})<br>Last %{x:.2f}% → ours %{y:.2f}%<extra></extra>" },
    { type: "scatter", mode: "lines+markers", x: [], y: [], line: { color: C.ink2, width: 1.2 }, marker: { size: 5, color: C.ink2 }, hoverinfo: "skip" }],
  { xaxis: axis("Last print, % y/y", { range: [lo, hi] }), yaxis: axis("Our call, % y/y", { range: [lo, hi] }),
    annotations: [{ x: lo + 0.2, y: hi - 0.2, text: "we expect a rise", showarrow: false, xanchor: "left", font: { family: COND, size: 13, color: C.hot } },
      { x: hi - 0.2, y: lo + 0.2, text: "we expect a fall", showarrow: false, xanchor: "right", font: { family: COND, size: 13, color: C.cool } },
      ...(off.length ? [{ xref: "paper", yref: "paper", x: 0.01, y: 0.93, xanchor: "left", yanchor: "top", showarrow: false, align: "left",
        text: "Off scale: " + off.map((e) => `${e.name} ${e.last.toFixed(1)} → ${e.mean.toFixed(1)}`).join(", "), font: { family: COND, size: 12, color: C.ink3 } }] : [])] }, 420);
  const node = $("#chart-xs");
  let pinned = null, shown = null;
  const show = (cc) => {
    if (cc === shown) return;
    shown = cc;
    const e = pts.find((p) => p.cc === cc), t = e ? trailOf(e) : { x: [], y: [] };
    // the trail runs into the economy's dot: the last print, then our call; the axes widen to hold it while shown
    const xs = e ? [...t.x, e.last] : [], ys = e ? [...t.y, e.mean] : [];
    const a = Math.min(lo, ...xs, ...ys) - (e ? 0.3 : 0), z = Math.max(hi, ...xs, ...ys) + (e ? 0.3 : 0);
    Plotly.update(node, { x: [xs], y: [ys] }, { "xaxis.range": [a, z], "yaxis.range": [a, z] }, [2]);
  };
  if (node.removeAllListeners) for (const k of ["plotly_hover", "plotly_unhover", "plotly_click"]) node.removeAllListeners(k);
  node.on("plotly_hover", (ev) => { const p = ev.points && ev.points[0]; if (p && p.curveNumber === 1 && !pinned) show(pts[p.pointIndex].cc); });
  node.on("plotly_unhover", () => { if (!pinned) show(null); });
  node.on("plotly_click", (ev) => { const p = ev.points && ev.points[0]; if (!p || p.curveNumber !== 1) return; const cc = pts[p.pointIndex].cc; pinned = pinned === cc ? null : cc; shown = undefined; show(pinned); });
}
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
  // ordered by our call: year-on-year targets first, highest first, then month-on-month ones
  const econ = BOARD.economies.filter((e) => state.ecoRegion === "all" || e.region === state.ecoRegion)
    .sort((a, b) => (isMom(a.unit) - isMom(b.unit)) || ((isNum(b.mean) ? b.mean : -1e9) - (isNum(a.mean) ? a.mean : -1e9)));
  $("#multiples").replaceChildren(...econ.map((e) => el("button", { class: "mini", type: "button", onclick: () => openEconomy(e.cc), title: `${e.name}: ${e.label}, ${e.unit}` }, [
    el("span", { class: "t", text: e.cc }),
    el("span", { class: "vals" }, [el("span", { class: "call-v", text: val(e.mean, e.unit) }), el("span", { class: "last-v", text: "last " + (e.last ?? "—") })]),
    sparkSvg(e.spark, e.last, e.mean),
    el("span", { class: "name", text: `${e.name} · ${e.unit} · ${periodFmt(e.period)}` })])));
}

// ── Country ────────────────────────────────────────────────────────────────
render.country = async function () {
  buildPicker("picker", (cc) => { state.cc = cc; state.target = null; state.daily = null; writeHash(); render.country(); });
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
  $("#dist-note").textContent = `Most likely print in amber. The chance of each print at the agency's rounding, from 20,000 joint draws of every component, rounded the way ${F.agency} rounds.`;
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
      text: g.map((r) => `${sg(r.contribution_pp, 3)} · w ${f1(r.weight)}%`), textposition: "outside", cliponaxis: false, textfont: { family: MONO, size: 12, color: C.ink2 },
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

// ── High frequency ─────────────────────────────────────────────────────────
// The daily and weekly inputs behind the nowcasts (validated: read by a leaf model that passed the walk-forward
// tests) and the experimental live-prices layer (daily indices from our scraped panels, run beside the call).
const LINE_COLS = () => C.lines;
const fmtv = (v) => (!isNum(v) ? "—" : Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-GB") : v.toFixed(Math.abs(v) >= 100 ? 1 : Math.abs(v) >= 10 ? 2 : 3));
const sgp = (v, d = 1) => (isNum(v) ? sg(v, d) + "%" : "—");
const wTxt = (w) => (isNum(w) ? (w * 100).toFixed(w < 0.001 ? 3 : w < 0.01 ? 2 : 1) + "%" : "—");
const narrow = () => window.innerWidth < 640;
const cutLabel = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const dirCls = (v) => (!isNum(v) ? "" : v > 0 ? "up" : v < 0 ? "down" : "");
const moveSpan = (v, d = 1) => el("span", { class: dirCls(v), text: sgp(v, d) });
const shortName = (s) => s.replace(/^Day-ahead power, /, "Power ").replace(/ pump price/, "").replace("Euro-super 95", "Petrol 95")
  .replace("NY Harbor", "NYH").replace("Unleaded terminal gate price", "ULP gate").replace("Unleaded", "ULP").replace(/ \(Com\. A 3500\)/, "");
const shortDay = (s) => D(s).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
function statusTag(status, age, superseded) {
  const cls = status === "current" ? "current" : status === "late" ? "due" : superseded ? "none" : "overdue";
  const txt = status === "current" ? "current" : status === "late" ? "late" : superseded ? "superseded" : "stopped";
  return el("span", { class: "status " + cls, title: isNum(age) ? `${age} day${age === 1 ? "" : "s"} since the last observation` : "" }, [el("span", { class: "dot" }), txt]);
}
function buildPicker(boxId, onPick) {
  const pick = document.getElementById(boxId); pick.replaceChildren();
  // each region's label travels with its economies, so a label never ends a row on its own
  for (const [g, label] of REGIONS) {
    const here = BOARD.economies.filter((x) => x.region === g);
    if (!here.length) continue;
    pick.append(el("span", { class: "pgrp" }, [el("span", { class: "grp", text: label }),
      ...here.map((e) => el("button", { type: "button", "aria-pressed": String(e.cc === state.cc), title: e.name, onclick: () => onPick(e.cc) }, e.cc))]));
  }
}
function openHf(cc) { state.cc = cc; state.hfView = "one"; state.hfTarget = null; state.hfLeaf = null; writeHash(); render.hf(); window.scrollTo({ top: 0 }); }

render.hf = async function () {
  let H;
  try { H = await load("hf.json"); } catch (e) { $("#hf-all").replaceChildren(el("p", { class: "empty", text: "The high-frequency feed did not load." })); return; }
  const E = H.economies, liveN = E.reduce((s, e) => s + (e.live.leaves || 0), 0);
  const cs = E.map((e) => e.live.c).filter(isNum), cMax = cs.length ? Math.max(...cs) : null;
  $("#hf-sub").textContent = `The daily and weekly series our nowcasts read, and the live price indices we build from ${liveN} CPI leaves in ${E.filter((e) => e.live.leaves).length} economies, so you can see what moved, which leaf it feeds and how much of the basket that leaf is. Data to ${longDay(H.as_of)}.`;
  $("#hf-explain").replaceChildren(el("b", { text: "Validated or experimental? " }),
    "Inputs marked ", el("span", { class: "tag val", text: "validated" }), " passed our walk-forward tests and feed the official nowcast. The live-prices layer ",
    el("span", { class: "tag exp", text: "experimental" }), " is built from our own daily price panels; it has no track record yet, runs beside the nowcast and is shown for information only. ",
    el("b", { text: "It is not our call: the validated nowcast is the call." }),
    ` Today the panels carry at most ${isNum(cMax) ? Math.round(cMax * 100) : "a few "}% of the month's change (c), so model + live sits within hundredths of a point of the model; the gap grows as the panels see more of the month.`);
  segb("seg-hfview", [["all", "All economies"], ["one", "One economy"]], state.hfView, (v) => { state.hfView = v; writeHash(); drawHfView(H); });
  drawHfView(H);
};
function drawHfView(H) {
  $("#hf-all").hidden = state.hfView !== "all"; $("#hf-one").hidden = state.hfView !== "one";
  if (state.hfView === "all") drawHfAll(H); else drawHfOne(H);
}

function drawHfAll(H) {
  const E = H.economies, sum = (f) => E.reduce((s, e) => s + (f(e) || 0), 0);
  const latest = E.map((e) => e.latest).filter(Boolean).sort().pop();
  const ws = E.map((e) => e.live.weight).filter(isNum).sort((a, b) => a - b), wMed = ws.length ? ws[Math.floor(ws.length / 2)] : null;
  const heads = E.filter((e) => e.head && isNum(e.head.diff));
  const big = heads.slice().sort((a, b) => Math.abs(b.head.diff) - Math.abs(a.head.diff))[0];
  const late = sum((e) => e.late), stale = sum((e) => e.stale);
  const cs = E.map((e) => e.live.c).filter(isNum);
  $("#hf-kpis").replaceChildren(
    tile("Validated inputs", String(sum((e) => e.n.validated)), "series", `${E.filter((e) => e.n.validated).length} economies · feed the call`),
    tile("Latest input", latest ? shortDay(latest) : "—", "", `${late} late · ${stale} stopped`),
    tile("Live leaves", String(sum((e) => e.live.leaves)), "experimental", `${E.filter((e) => e.live.leaves).length} economies · median ${wTxt(wMed)} of CPI`),
    tile("Products priced", sum((e) => e.live.products).toLocaleString("en-GB"), "", "on each leaf's latest scrape day"),
    tile("Coverage c", cs.length ? f2(Math.max(...cs)) : "—", "max", "share of the month's change seen"),
    tile("Largest live − model", big ? sg(big.head.diff, 3) : "—", "pp", big ? `${big.name} ${big.head.label}` : ""));

  // what moved: the largest month-to-date moves in validated inputs, at most two per economy
  const mv = E.flatMap((e) => e.moves.filter((m) => isNum(m.mtd)).slice(0, 2).map((m) => ({ ...m, cc: e.cc, name: e.name })))
    .sort((a, b) => Math.abs(b.mtd) - Math.abs(a.mtd)).slice(0, 16).sort((a, b) => a.mtd - b.mtd);
  const n = narrow(), yl = mv.map((m) => `${m.cc} · ${n ? cutLabel(shortName(m.label), 20) : cutLabel(m.label, 30)}`);
  const lim = Math.max(1, ...mv.map((m) => Math.abs(m.mtd)), ...mv.map((m) => (isNum(m.chg7) ? Math.abs(m.chg7) : 0)));
  mount("chart-hfmoves", [
    { type: "bar", orientation: "h", x: mv.map((m) => m.mtd), y: mv.map((_, i) => i), marker: { color: mv.map((m) => (m.mtd >= 0 ? C.hot : C.cool)) },
      text: mv.map((m) => sgp(m.mtd)), textposition: "outside", cliponaxis: false, textfont: { family: MONO, size: 12, color: C.ink1 },
      customdata: mv.map((m) => [m.name, m.label, m.src, fmtv(m.last_v), m.unit, m.leaf_label, wTxt(m.w), shortDay(m.last)]),
      hovertemplate: "%{customdata[0]} · %{customdata[1]} (%{customdata[2]})<br>Month-to-date average v last month %{x:+.1f}%<br>Last %{customdata[3]} %{customdata[4]} on %{customdata[7]}<br>Feeds %{customdata[5]}, %{customdata[6]} of CPI<extra></extra>" },
    { type: "scatter", mode: "markers", x: mv.map((m) => m.chg7), y: mv.map((_, i) => i), marker: { symbol: "diamond", size: 10, color: C.ink1, line: { color: C.card, width: 1.5 } },
      hovertemplate: "7-day change %{x:+.1f}%<extra></extra>" }],
  { xaxis: axis("Change in the input's price or rate, %", { zeroline: true, zerolinewidth: 2, range: [-lim * 1.3, lim * 1.3] }),
    yaxis: axis("", { tickvals: mv.map((_, i) => i), ticktext: yl, tickfont: { family: COND, size: n ? 11 : 12, color: C.ink2 } }),
    margin: { l: 10, r: 16, t: 6, b: 44 }, bargap: 0.3 }, Math.max(300, mv.length * 26 + 70));

  // live minus model, headline
  const hd = heads.slice().sort((a, b) => a.head.diff - b.head.diff);
  const dl = Math.max(0.006, ...hd.map((e) => Math.abs(e.head.diff))) * 1.9;
  mount("chart-hflive", [{ type: "bar", orientation: "h", x: hd.map((e) => e.head.diff), y: hd.map((_, i) => i), marker: { color: css("--c-live") },
    customdata: hd.map((e) => [e.name, e.head.label, e.head.unit, val(e.head.model, e.head.unit), val(e.head.live, e.head.unit)]),
    hovertemplate: "%{customdata[0]} %{customdata[1]}, %{customdata[2]}<br>Model %{customdata[3]} · model + live %{customdata[4]}<br>Gap %{x:+.3f} pp<extra></extra>" }],
  { xaxis: axis("Model + live − model, pp of each headline", { zeroline: true, zerolinewidth: 2, range: [-dl, dl], tickformat: ".3f", nticks: n ? 5 : 9 }),
    yaxis: axis("", { tickvals: hd.map((_, i) => i), ticktext: hd.map((e) => (n ? e.cc : e.name)), tickfont: { family: COND, size: 12, color: C.ink2 } }),
    annotations: hd.map((e, i) => ({ x: 0, y: i, xanchor: e.head.diff < 0 ? "left" : "right", xshift: e.head.diff < 0 ? 4 : -4, showarrow: false,
      text: `${sg(e.head.diff, 3)}${isNum(e.live.c) ? " · c " + f2(e.live.c) : ""}`, font: { family: COND, size: 12, color: C.ink2 } })),
    margin: { l: 10, r: 16, t: 6, b: 44 }, bargap: 0.35 }, Math.max(300, hd.length * 22 + 70));

  sortable($("#hf-inputs"), [
    { key: "name", label: "Economy", render: (r) => el("span", {}, [ccTag(r.cc), el("span", { class: "nm-full", text: r.name })]) },
    { key: "nv", label: "Validated", n: true, lo: true, sortv: (r) => r.n.validated, render: (r) => String(r.n.validated) },
    { key: "ne", label: "Experimental", n: true, lo: true, sortv: (r) => r.n.experimental, render: (r) => String(r.n.experimental) },
    { key: "nd", label: "Related", n: true, lo: true, sortv: (r) => r.n.display, render: (r) => String(r.n.display), tip: "Related series no model reads, incl. single-panel live indices" },
    { key: "latest", label: "Latest input", lo: true, render: (r) => (r.latest ? shortDay(r.latest) : "—") },
    { key: "flags", label: "Status", sortv: (r) => r.late * 10 + r.stale * 100, render: (r) => (r.late || r.stale ? el("span", { class: "flags" }, [
      r.stale ? statusTag("stale", null, false) : null, r.stale > 1 ? ` ${r.stale}` : null, r.late ? statusTag("late") : null, r.late > 1 ? ` ${r.late}` : null]) : statusTag("current")),
      tip: "Current: every validated input is up to date. Late or stopped: at least one is (see the economy)" },
    { key: "mover", label: "Biggest move", sortv: (r) => (r.moves[0] ? r.moves[0].label : null), render: (r) => (r.moves[0] ? el("span", {}, [narrow() ? cutLabel(shortName(r.moves[0].label), 18) : r.moves[0].label, unitTag(r.moves[0].unit)]) : "—") },
    { key: "mtd", label: "MTD avg", n: true, sortv: (r) => (r.moves[0] ? r.moves[0].mtd : null), render: (r) => (r.moves[0] ? moveSpan(r.moves[0].mtd) : "—"), tip: "Month-to-date average against last month's average" },
    { key: "chg7", label: "7 days", n: true, sortv: (r) => (r.moves[0] ? r.moves[0].chg7 : null), render: (r) => (r.moves[0] ? moveSpan(r.moves[0].chg7) : "—") },
    { key: "leaf", label: "Feeds", lo: true, sortv: (r) => (r.moves[0] ? r.moves[0].w : null), render: (r) => (r.moves[0] ? el("span", {}, [cutLabel(r.moves[0].leaf_label, 26), unitTag(wTxt(r.moves[0].w) + " of CPI")]) : "—") },
  ], E, { onRow: (r) => openHf(r.cc) });

  sortable($("#hf-livecov"), [
    { key: "name", label: "Economy", render: (r) => el("span", {}, [ccTag(r.cc), el("span", { class: "nm-full", text: r.name })]) },
    { key: "leaves", label: "Leaves", n: true, lo: true, sortv: (r) => r.live.leaves, render: (r) => String(r.live.leaves) },
    { key: "weight", label: "Basket", n: true, sortv: (r) => r.live.weight, render: (r) => wTxt(r.live.weight), tip: "Share of the CPI basket in the leaves with a live index" },
    { key: "products", label: "Products", n: true, lo: true, sortv: (r) => r.live.products, render: (r) => (r.live.products || 0).toLocaleString("en-GB") },
    { key: "first", label: "Since", lo: true, sortv: (r) => r.live.first, render: (r) => (r.live.first ? shortDay(r.live.first) : "—") },
    { key: "c", label: "c", n: true, sortv: (r) => r.live.c, render: (r) => f2(r.live.c), tip: "Share of the month's average-on-average change the days seen carry" },
    { key: "target", label: "Headline", lo: true, sortv: (r) => (r.head ? r.head.label : null), render: (r) => (r.head ? el("span", {}, [r.head.label, unitTag(r.head.unit)]) : "—") },
    { key: "model", label: "Model", n: true, sortv: (r) => (r.head ? r.head.model : null), render: (r) => (r.head ? el("b", { class: "pos", text: val(r.head.model, r.head.unit) }) : "—") },
    { key: "live", label: "Model + live", n: true, sortv: (r) => (r.head ? r.head.live : null), render: (r) => (r.head ? el("span", { class: "live", text: val(r.head.live, r.head.unit) }) : "—") },
    { key: "diff", label: "Gap, pp", n: true, sortv: (r) => (r.head ? r.head.diff : null), render: (r) => (r.head ? sg(r.head.diff, 3) : "—") },
  ], E, { onRow: (r) => openHf(r.cc) });
}

async function drawHfOne(H) {
  buildPicker("hf-picker", (cc) => { state.cc = cc; state.hfTarget = null; state.hfLeaf = null; writeHash(); drawHfOne(H); });
  const e = H.economies.find((x) => x.cc === state.cc), grid = $("#hf-grid");
  if (!e) { $("#hf-call").replaceChildren(); grid.replaceChildren(el("p", { class: "empty", text: "No high-frequency feed for this economy yet." })); return; }
  let F;
  try { F = await load(`hf/${state.cc}.json`); } catch (err) { grid.replaceChildren(el("p", { class: "empty", text: "This economy's high-frequency feed did not load." })); return; }
  if (F.cc !== state.cc) return; // a faster click moved on
  const econ = BOARD.economies.find((x) => x.cc === F.cc) || {};
  const top = e.moves[0], L = F.live;
  const lines = [["Validated inputs", String(Object.keys(F.series).length), e.late || e.stale ? `${e.late} late · ${e.stale} stopped` : "all current"],
    ["Latest input", e.latest ? shortDay(e.latest) : "—", ""],
    ["Biggest move, month to date", top ? sgp(top.mtd) : "—", top ? cutLabel(top.label, 28) : ""],
    ["Live leaves (experimental)", String(L.leaves), `${wTxt(L.weight)} of CPI`],
    ["Products priced", (L.products || 0).toLocaleString("en-GB"), isNum(L.c) ? `c ${f2(L.c)}` : ""]];
  if (e.head) lines.push([`Model + live − model, ${e.head.label}`, sg(e.head.diff, 3), "pp"]);
  $("#hf-call").replaceChildren(
    el("div", { class: "left" }, [el("div", { class: "who", text: `${econ.subregion || econ.region || ""} · High frequency` }), el("div", { class: "name", text: F.name }),
      el("div", { class: "meta", text: `Data to ${shortDay(F.as_of)} · validated inputs feed the call · the live layer is experimental` }),
      e.head ? el("div", { class: "big" }, [el("b", { text: val(e.head.model, e.head.unit) }), el("span", { text: `${e.head.label}, ${e.head.unit} · our call` })]) : null,
      el("button", { class: "linkish", type: "button", onclick: () => openEconomy(F.cc), text: "Open the full nowcast →" })]),
    el("div", { class: "right" }, el("div", { class: "lines" }, lines.map(([a, b, c]) => el("div", { class: "line" }, [el("span", { text: a }), el("b", {}, [b, c ? el("small", { text: c }) : null])])))));
  segb("seg-hfwin", [["31", "1M"], ["92", "3M"], ["365", "1Y"], ["0", "All"]], state.hfWin, (v) => { state.hfWin = v; drawHfGroups(F); });
  grid.replaceChildren();
  const sec = (title, text) => grid.append(el("div", { class: "hf-sec" }, [el("h3", { text: title }), text ? el("p", { text }) : null]));
  sec("Validated inputs", "Each chart is one CPI leaf with the daily or weekly series its model reads, and the leaf's weight in the basket. The shaded band is the current month; MTD compares the month-to-date average with last month's average, which is how the monthly index sees a price.");
  grid.append(el("div", { class: "hf-groups", id: "hf-groups" }));
  drawHfGroups(F);
  if (L.leaves) {
    sec("Live price indices · experimental", `Daily chained Jevons indices of regular prices from our scraped panels, one per CPI leaf, since ${L.first ? longDay(L.first) : "—"}. Shown for information: they have no track record yet and do not enter the call.`);
    drawHfLive(F, grid);
  }
  if (F.nowcast.length) drawHfNowcast(F, grid);
  if (F.display.length) drawHfDisplay(F, grid);
}

function drawHfGroups(F) {
  const box = $("#hf-groups"); if (!box) return;
  box.replaceChildren();
  const days = +state.hfWin, cols = LINE_COLS(), n = narrow();
  F.groups.forEach((g, gi) => {
    const S = g.series.map((id) => F.series[id]).filter(Boolean);
    const live = S.filter((s) => s.status !== "stale" && s.pts && s.pts.length), gone = S.filter((s) => !live.includes(s));
    const card = el("figure", { class: "card half" }, el("figcaption", {}, el("h3", {}, [cutLabel(g.label, 60),
      el("span", { class: "ctx", text: `${g.leaves.length ? g.leaves.map((x) => x.code).join(" · ") + " · " : ""}${wTxt(g.w)} of CPI` })])));
    box.append(card);
    const units = [...new Set(live.map((s) => s.unit))];
    units.forEach((u, ui) => {
      const ss = live.filter((s) => s.unit === u);
      card.append(el("div", { class: "legend-row stats" }, ss.map((s) => el("span", { title: `${s.label} (${s.src}), ${s.freq}` }, [
        el("i", { style: `background:${cols[live.indexOf(s) % cols.length]}` }), `${cutLabel(s.label, n ? 26 : 40)} `, el("b", { text: fmtv(s.last_v) }),
        el("small", { text: ` ${s.unit} · ${shortDay(s.last)} · 7d ` }), moveSpan(s.chg7), el("small", { text: " · MTD " }), moveSpan(s.mtd)]))));
      const id = `hf-g${gi}-${ui}`;
      card.append(el("div", { class: "plot", id }));
      const end = ss.map((s) => s.pts[s.pts.length - 1][0]).sort().pop(), endD = D(end);
      const start = days ? new Date(endD.getTime() - days * 86400000) : null;
      const ms = new Date(endD.getFullYear(), endD.getMonth(), 1);
      const tr = ss.map((s) => {
        const P = s.pts.filter((p) => !start || D(p[0]) >= start);
        return { type: "scatter", mode: s.freq === "daily" && P.length > 40 ? "lines" : "lines+markers", x: P.map((p) => D(p[0])), y: P.map((p) => p[1]),
          line: { color: cols[live.indexOf(s) % cols.length], width: ss.length > 2 ? 1.6 : 2.2 }, marker: { size: 4 },
          name: cutLabel(s.label, 30), hovertemplate: `${cutLabel(s.label, 34)} %{y:,.4~f} ${s.unit}<extra></extra>` };
      });
      mount(id, tr, { xaxis: axis("Date", { type: "date", nticks: n ? 4 : 7 }), yaxis: axis(u, { tickformat: ",.4~f" }), hovermode: "x unified",
        shapes: [{ type: "rect", xref: "x", yref: "paper", x0: ms, x1: endD, y0: 0, y1: 1, fillcolor: "rgba(255,178,36,0.07)", line: { width: 0 }, layer: "below" }],
        annotations: [{ xref: "x", yref: "paper", x: ms, y: 1, xanchor: "left", yanchor: "top", text: "MTD", showarrow: false, font: { family: COND, size: 11, color: C.actual } }] }, 250);
    });
    if (!live.length) card.append(el("p", { class: "empty", text: "No current data for this leaf." }));
    if (gone.length) {
      // stopped series, one line per provider and last date: "Day-ahead power, NO1, NO2 (hvakosterstrommen.no) to 31 Dec 2023"
      const by = new Map();
      for (const s of gone) { const k = `${s.src}|${s.last}|${s.superseded}`; if (!by.has(k)) by.set(k, []); by.get(k).push(s); }
      const longDay2 = (x) => D(x).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const parts = [...by.values()].map((ss) => {
        const head = ss[0].label.replace(/, [^,]+$/, ""), tails = ss.map((s) => (s.label.startsWith(head + ", ") ? s.label.slice(head.length + 2) : s.label));
        const what = ss.length > 1 && tails.every((t, i) => t !== ss[i].label) ? `${head}, ${tails.join(", ")}` : ss.map((s) => s.label).join("; ");
        return [el("b", { text: what }), ` (${ss[0].src}) to ${longDay2(ss[0].last)}${ss[0].superseded ? ", continued by the series above" : ": no newer data, the model reads nothing current here"}. `];
      });
      card.append(el("p", { class: "note" }, [el("b", { text: "History only: " }), ...parts.flat()]));
    }
  });
  if (!F.groups.length) box.append(el("p", { class: "empty", text: "No validated high-frequency input in this economy: its leaf models read monthly data only." }));
}

function drawHfLive(F, grid) {
  const L = F.live.leaves_detail, n = narrow(), live = css("--c-live");
  // default: the heaviest leaf among those with the longest daily record
  if (!state.hfLeaf || !L.find((x) => x.leaf === state.hfLeaf)) state.hfLeaf = L.slice().sort((a, b) => b.days - a.days || (b.w || 0) - (a.w || 0))[0].leaf;
  const dot = el("figure", { class: "card seventwelfths" }, [el("figcaption", {}, el("h3", {}, ["Month to date, every leaf", el("span", { class: "ctx", text: "% · ± 1 standard error" })])),
    el("div", { class: "plot", id: "chart-hfdots" }),
    el("p", { class: "note", text: "Month-to-date average of the daily index against last month's average (days before the first scrape take the first level), so early in the panels' life it moves little. Error bars: ± 1 bootstrap standard error over products. Select a leaf for its path." })]);
  const path = el("figure", { class: "card fivetwelfths" }, [el("figcaption", {}, [el("h3", {}, ["One leaf, day by day"]),
    el("div", { class: "card-tools" }, el("select", { class: "ctl", id: "hf-leafsel", "aria-label": "Leaf" }))]),
    el("div", { class: "legend-row" }, [el("span", {}, [el("i", { style: `background:${live}` }), "MTD change (± 1 s.e.)"]), el("span", {}, [el("i", { style: "background:var(--slate)" }), "products matched"])]),
    el("div", { class: "plot", id: "chart-hfleaf" }), el("p", { class: "note", id: "hf-leafnote" })]);
  const tbl = el("figure", { class: "card" }, [el("figcaption", {}, el("h3", {}, ["Every live leaf", el("span", { class: "ctx", text: `${F.live.leaves} leaves · ${wTxt(F.live.weight)} of CPI · select a row` })])),
    el("div", { class: "tablewrap", id: "hf-leaftable", style: "max-height:520px" })]);
  grid.append(dot, path, tbl);
  const S = L.filter((x) => isNum(x.mtd)).sort((a, b) => a.mtd - b.mtd);
  // agencies reuse names ("Resto", "Other"): add the code where a name repeats
  const dup = new Set(L.map((x) => x.name).filter((nm, i, a) => a.indexOf(nm) !== i));
  const leafName = (x, k) => (dup.has(x.name) ? `${cutLabel(x.name, k - x.leaf.length - 3)} (${x.leaf})` : cutLabel(x.name, k));
  const lim = Math.max(0.05, ...S.map((x) => Math.abs(x.mtd) + (x.se || 0))) * 1.15;
  mount("chart-hfdots", [{ type: "scatter", mode: "markers", x: S.map((x) => x.mtd), y: S.map((_, i) => i),
    error_x: { type: "data", array: S.map((x) => x.se || 0), color: live, thickness: 1.5, width: 0 },
    marker: { size: 8, color: S.map((x) => (x.leaf === state.hfLeaf ? C.actual : live)), line: { color: C.card, width: 1 } },
    customdata: S.map((x) => [x.name, wTxt(x.w), x.n.toLocaleString("en-GB"), f3(x.se), shortDay(x.date), x.leaf]),
    hovertemplate: "%{customdata[0]} (%{customdata[1]} of CPI)<br>MTD %{x:+.3f}% ± %{customdata[3]}<br>%{customdata[2]} products on %{customdata[4]}<extra></extra>" }],
  { xaxis: axis("Month-to-date change, %", { zeroline: true, zerolinewidth: 2, range: [-lim, lim] }),
    yaxis: axis("", { tickvals: S.map((_, i) => i), ticktext: S.map((x) => `${leafName(x, n ? 20 : 34)} · ${wTxt(x.w)}`), tickfont: { family: COND, size: n ? 11 : 12, color: C.ink2 } }),
    margin: { l: 10, r: 16, t: 6, b: 44 } }, Math.max(280, S.length * 21 + 70));
  $("#chart-hfdots").on("plotly_click", (ev) => { const p = ev.points && ev.points[0]; if (p) { state.hfLeaf = S[p.pointIndex].leaf; drawHfLeaf(F); } });
  const sel = $("#hf-leafsel");
  sel.replaceChildren(...L.map((x) => el("option", { value: x.leaf, text: leafName(x, 44) })));
  sel.onchange = () => { state.hfLeaf = sel.value; drawHfLeaf(F); };
  sortable($("#hf-leaftable"), [
    { key: "name", label: "Leaf", render: (r) => (narrow() ? leafName(r, 18) : el("span", {}, [cutLabel(r.name, 44), unitTag(r.leaf)])) },
    { key: "w", label: "Weight", n: true, render: (r) => wTxt(r.w) },
    { key: "n", label: "Products", n: true, lo: true, render: (r) => r.n.toLocaleString("en-GB") },
    { key: "idx", label: "Since start", n: true, sortv: (r) => r.idx, render: (r) => moveSpan(isNum(r.idx) ? r.idx - 100 : null, 2), tip: "Index level against 100 on the first scrape day" },
    { key: "mtd", label: "MTD", n: true, render: (r) => moveSpan(r.mtd, 3) },
    { key: "se", label: "± s.e.", n: true, lo: true, render: (r) => f3(r.se) },
    { key: "kc", label: "c", n: true, lo: true, render: (r) => f2(r.kc) },
    { key: "days", label: "Days", n: true, lo: true },
    { key: "date", label: "Latest", lo: true, render: (r) => shortDay(r.date) },
  ], L, { key: "w", dir: -1, onRow: (r) => { state.hfLeaf = r.leaf; drawHfLeaf(F); $("#chart-hfleaf").scrollIntoView({ behavior: "smooth", block: "center" }); } });
  drawHfLeaf(F);
}
function drawHfLeaf(F) {
  const x = F.live.leaves_detail.find((r) => r.leaf === state.hfLeaf); if (!x) return;
  const live = css("--c-live"), R = x.rows, d = R.map((r) => D(r[0]));
  $("#hf-leafsel").value = x.leaf;
  const dots = $("#chart-hfdots");
  if (dots && dots.data) Plotly.restyle(dots, { "marker.color": [dots.data[0].customdata.map((c) => (c[5] === x.leaf ? C.actual : live))] });
  mount("chart-hfleaf", [
    { type: "bar", x: d, y: R.map((r) => r[2]), yaxis: "y2", marker: { color: C.slate }, opacity: 0.55, hovertemplate: "%{y:,} products<extra></extra>" },
    { type: "scatter", mode: "lines", x: d, y: R.map((r) => (isNum(r[4]) ? r[3] + r[4] : null)), line: { width: 0 }, hoverinfo: "skip" },
    { type: "scatter", mode: "lines", x: d, y: R.map((r) => (isNum(r[4]) ? r[3] - r[4] : null)), line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(79,216,168,0.2)", hoverinfo: "skip" },
    { type: "scatter", mode: "lines+markers", x: d, y: R.map((r) => r[3]), line: { color: live, width: 2.4 }, marker: { size: 6, color: live },
      customdata: R.map((r) => [r[4], r[1], r[5]]), hovertemplate: "%{x|%a %d %b}<br>MTD %{y:+.3f}% ± %{customdata[0]:.3f}<br>Index %{customdata[1]:.2f} · c %{customdata[2]:.2f}<extra></extra>" }],
  { xaxis: axis("Scrape day", { type: "date", tickformat: "%d %b", dtick: R.length > 12 ? null : 86400000 * (narrow() ? 3 : 2) }),
    yaxis: axis("MTD change, %", { zeroline: true, tickformat: "+.2f" }),
    yaxis2: { ...axis("Products matched", { rangemode: "tozero" }), overlaying: "y", side: "right", showgrid: false },
    margin: { l: 56, r: 56, t: 10, b: 44 }, hovermode: "x unified", bargap: 0.4 }, 280);
  $("#hf-leafnote").textContent = `${x.name} (${x.leaf}), ${wTxt(x.w)} of CPI: ${x.n.toLocaleString("en-GB")} products on ${shortDay(x.date)}, index ${f2(x.idx)} against 100 on ${shortDay(x.first)}, month to date ${sgp(x.mtd, 3)} ± ${f3(x.se)}, c ${f2(x.kc)}.`;
}

function drawHfNowcast(F, grid) {
  const T = F.nowcast, live = css("--c-live");
  if (!state.hfTarget || !T.find((t) => t.id === state.hfTarget)) state.hfTarget = (T.find((t) => t.head) || T[0]).id;
  const card = el("figure", { class: "card half" }, [el("figcaption", {}, el("h3", {}, ["Model v model + live", el("span", { class: "ctx", text: "each day's last run" })])),
    el("div", { class: "filters tight" }, el("div", { class: "segb", id: "seg-hftarget", "aria-label": "Target" })),
    el("div", { class: "legend-row" }, [el("span", {}, [el("i", { style: "background:var(--signal)" }), "model: our call (80% band)"]), el("span", {}, [el("i", { style: `background:${live}` }), "model + live prices (experimental)"])]),
    el("div", { class: "plot", id: "chart-hfnc" }), el("p", { class: "note", id: "hf-ncnote" })]);
  const tcard = el("figure", { class: "card half" }, [el("figcaption", {}, el("h3", {}, ["Every target", el("span", { class: "ctx", text: `latest run, ${shortDay(T[0].date)}` })])),
    el("div", { class: "tablewrap", id: "hf-nctable" }),
    el("p", { class: "note", text: "Model + live updates each leaf the panels cover by how much of the month they have seen (c), weighing their sampling error and the leaf's own history; nothing is fitted to outcomes. Core measures that need a trimmed or median cut are not recomputed." })]);
  grid.append(card, tcard);
  const draw = () => {
    const t = T.find((x) => x.id === state.hfTarget), R = t.rows, d = R.map((r) => D(r[0]));
    mount("chart-hfnc", [
      { type: "scatter", mode: "lines", x: d, y: R.map((r) => r[1] + 1.2816 * r[2]), line: { width: 0 }, hoverinfo: "skip" },
      { type: "scatter", mode: "lines", x: d, y: R.map((r) => r[1] - 1.2816 * r[2]), line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(125,147,255,0.16)", hoverinfo: "skip" },
      { type: "scatter", mode: "lines+markers", x: d, y: R.map((r) => r[1]), line: { color: C.ours, width: 2.6 }, marker: { size: 7, color: C.ours }, hovertemplate: "Model %{y:.3f}<extra></extra>" },
      { type: "scatter", mode: "lines+markers", x: d, y: R.map((r) => r[3]), line: { color: live, width: 2, dash: "dash" }, marker: { size: 7, color: live, symbol: "diamond" }, hovertemplate: "Model + live %{y:.3f}<extra></extra>" }],
    { xaxis: axis("Run date", { type: "date", tickformat: "%d %b", dtick: R.length > 14 ? null : 86400000 }), yaxis: axis(`${t.label}, ${t.unit}`), hovermode: "x unified" }, 280);
    $("#hf-ncnote").textContent = `${R.length} archived run${R.length === 1 ? "" : "s"} so far. Latest: model ${val(t.model, t.unit)}, model + live ${val(t.live, t.unit)} (${sg(t.diff, 3)} pp). The model is our call; model + live is not.`;
  };
  segb("seg-hftarget", T.map((t) => [t.id, cutLabel(`${t.label} ${t.unit.replace("% ", "")}`, 22)]), state.hfTarget, (v) => { state.hfTarget = v; draw(); });
  draw();
  sortable($("#hf-nctable"), [
    { key: "label", label: "Target", render: (r) => el("span", {}, [r.label, unitTag(r.unit)]) },
    { key: "model", label: "Model", n: true, render: (r) => el("b", { class: "pos", text: val(r.model, r.unit) }) },
    { key: "live", label: "+ live", n: true, render: (r) => el("span", { class: "live", text: val(r.live, r.unit) }) },
    { key: "diff", label: "Gap, pp", n: true, render: (r) => sg(r.diff, 3) },
    { key: "sd", label: "Model sd", n: true, lo: true, render: (r) => f2(r.sd) },
  ], T, { onRow: (r) => { state.hfTarget = r.id; segb("seg-hftarget", T.map((t) => [t.id, cutLabel(`${t.label} ${t.unit.replace("% ", "")}`, 22)]), state.hfTarget, (v) => { state.hfTarget = v; draw(); }); draw(); } });
}

function sparkLine(vals) {
  const v = (vals || []).filter(isNum); if (v.length < 2) return el("span", { text: "" });
  const lo = Math.min(...v), hi = Math.max(...v), w = 90, h = 18;
  const d = v.map((x, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * (w - 2) + 1).toFixed(1)},${(h - 2 - ((x - lo) / (hi - lo || 1)) * (h - 4)).toFixed(1)}`).join("");
  const host = el("span", { class: "sparkcell" });
  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}"/></svg>`;
  return host;
}
function drawHfDisplay(F, grid) {
  const card = el("figure", { class: "card" }, [el("figcaption", {}, el("h3", {}, ["Related series", el("span", { class: "ctx", text: "no model reads these · for context" })])),
    el("div", { class: "tablewrap", id: "hf-display", style: "max-height:420px" }),
    el("p", { class: "note", text: "Series that could inform a leaf but that no validated model reads: candidates, related spot prices, travel counts. Single-retailer panel indices are left out (the pooled index of each leaf is above), as are station-level fuel feeds." })]);
  grid.append(card);
  sortable($("#hf-display"), [
    { key: "label", label: "Series", render: (r) => (narrow() ? cutLabel(r.label, 22) : el("span", {}, [cutLabel(r.label, 48), unitTag(r.src)])) },
    { key: "leaf_label", label: "Leaf", lo: true, render: (r) => cutLabel(r.leaf_label, 32) },
    { key: "last", label: "Latest", lo: true, render: (r) => el("span", {}, [shortDay(r.last), " ", statusTag(r.status, r.age, false)]) },
    { key: "last_v", label: "Value", n: true, render: (r) => el("span", {}, [fmtv(r.last_v), unitTag(r.unit)]) },
    { key: "chg7", label: "7 days", n: true, render: (r) => moveSpan(r.chg7) },
    { key: "mtd", label: "MTD avg", n: true, render: (r) => moveSpan(r.mtd) },
    { key: "spark", label: "Weekly", lo: true, render: (r) => sparkLine(r.spark) },
  ], F.display, { key: "label", dir: 1 });
}

// ── Growth ─────────────────────────────────────────────────────────────────
// Every GDP target on one board, then one economy: the US view (RTDSM engine, Kalshi reference) or the
// periodic-engine view (monthly and quarterly targets, AR-based candidates, the input gate).
const gPeriod = (p) => (/^\d{4}Q\d$/.test(p || "") ? p.replace("Q", " Q") : periodFmt(p));
const rtTag = (rt) => el("span", { class: "tag " + (rt ? "rt" : "prt"), title: rt ? "Inputs and past prints as they stood on each day" : "No vintages exist: today's data cut by publication lags", text: rt ? "real time" : narrow() ? "pseudo-RT" : "pseudo-real-time" });
const strTag = () => el("span", { class: "tag str", title: "An agency's own early reading of the target, or its monthly measure that adds up to the quarter: exempt from the significance test, must not lose in either window", text: "structural" });
const hfTag = () => el("span", { class: "tag hft", title: "Reads a daily or weekly series", text: "HF" });
const isAR = (r) => r.cc !== "US" && r.blend.length === 1 && r.blend[0] === "ar";
const sigTag = (p) => (isNum(p) ? el("span", { class: "sig " + (p < 0.05 ? "yes" : "no"), text: p < 0.05 ? "sig" : "n.s." }) : null);
render.growth = async function () {
  let B = null;
  try { B = await load("gdp_board.json"); } catch (_) { B = null; }
  $("#gdp-explain").hidden = !B;
  if (!B) { $("#gdp-board").closest(".grid").hidden = true; $("#gdp-picker").hidden = true; state.gcc = "US"; return showGdpEconomy(null); }
  const rows = B.board, ecos = B.economies;
  if (!ecos.includes(state.gcc)) state.gcc = "US";
  const nPseudo = new Set(rows.filter((r) => !r.real_time).map((r) => r.cc)).size;
  const hfT = rows.reduce((s, r) => s + (r.hf_tested || 0), 0), hfP = rows.reduce((s, r) => s + (r.hf_passed || 0), 0);
  $("#gdpall-sub").textContent = `Our call for the next GDP print in ${ecos.length} economies: ${rows.length} targets, monthly and quarterly, each scored against an autoregression, last period's print and the agency's own early estimate where it publishes one.`;
  $("#gdp-explain").replaceChildren(el("b", { text: "How to read it. " }),
    "Targets marked ", rtTag(true), " are built from every input as it stood on the day; ", rtTag(false), ` (${nPseudo === 1 ? "one economy" : nPseudo + " economies"}: Norway, Sweden) use today's data cut by publication lags because no vintages exist. A model marked `, strTag(),
    " reads the agency's own preview of the same print, or the monthly measure that adds up to the quarter; that rule was set after the 2025-26 holdout was computed, so Canada's and Mexico's holdout figures are not clean out-of-sample evidence. ",
    el("b", { text: `High-frequency inputs: ${hfT} tested outside the US, ${hfP} passed.` }), hfP ? "" : " They are scored and shown, not used.");
  $("#gdpb-count").textContent = `${rows.length} targets · ${ecos.length} economies`;
  sortable($("#gdp-board"), [
    { key: "release", label: "Release", render: (r) => (narrow() ? shortDay(r.release) : el("span", {}, [dayFmt(r.release), daysTo(r.release) >= 0 ? el("span", { class: "unit", text: "T−" + daysTo(r.release) }) : el("span", { class: "unit", text: "out", title: "Printed already: the next period's call starts once its first data are published" })])) },
    { key: "name", label: "Economy", render: (r) => el("span", {}, [ccTag(r.cc), el("span", { class: "nm-full", text: r.name }), narrow() ? el("span", { class: "unit", style: "margin:0", text: r.unit.replace("% ", "") }) : null]) },
    { key: "label", label: "Target", lo: true, render: (r) => el("span", {}, [r.label, unitTag(r.unit)]) },
    { key: "period", label: "Period", lo: true, render: (r) => gPeriod(r.period) },
    { key: "nowcast", label: "Ours", n: true, render: (r) => el("span", {}, [el("b", { class: "pos", text: val(r.nowcast, r.unit) }), el("span", { class: "unit lo", text: `${f1(r.band_lo)} to ${f1(r.band_hi)}` })]), tip: "Our mean, then the 80% band" },
    { key: "prev", label: "Previous", n: true, lo: true, render: (r) => (isNum(r.prev) ? f2(r.prev) : "—") },
    { key: "bench", label: "Benchmark", lo: true, sortv: (r) => r.bench, render: (r) => (r.bench_name ? el("span", {}, [isNum(r.bench) ? val(r.bench, r.unit) : "not yet out", unitTag(r.bench_name)]) : "—") },
    { key: "real_time", label: "Data", sortv: (r) => (r.real_time ? 1 : 0), render: (r) => rtTag(r.real_time) },
    { key: "structural", label: "Blend", lo: true, sortv: (r) => r.blend.length, render: (r) => (r.cc === "US" ? "models" : el("span", {}, [r.blend.length > 1 ? `AR + ${r.blend.length - 1}` : "AR", r.structural.length ? " " : "", r.structural.length ? strTag() : null])) },
    { key: "skill_ar", label: "Skill v AR", sortv: (r) => (isAR(r) ? null : r.skill_ar), render: (r) => (isAR(r) ? el("span", { class: "unit", style: "margin:0", title: "The blend is the AR alone", text: "= AR" }) : el("span", { title: `${r.skill_window}${r.n_skill ? ", " + r.n_skill + " periods" : ""}, ${r.skill_h} day${r.skill_h === 1 ? "" : "s"} before release` }, [meter(r.skill_ar, r.p_ar)])) },
  ], rows, { key: "release", dir: 1, onRow: (r) => { state.gcc = r.cc; state.gtarget = r.target; writeHash(); drawGdpPicker(ecos, rows); showGdpEconomy(B); document.getElementById("gdp-picker").scrollIntoView({ behavior: "smooth", block: "start" }); } });
  drawGdpPicker(ecos, rows);
  await showGdpEconomy(B);
};
function drawGdpPicker(ecos, rows) {
  const pick = $("#gdp-picker"); pick.replaceChildren();
  for (const g of ["Americas", "Europe"]) {
    const here = ecos.filter((cc) => (rows.find((r) => r.cc === cc) || {}).region === g);
    if (!here.length) continue;
    pick.append(el("span", { class: "pgrp" }, [el("span", { class: "grp", text: g }), ...here.map((cc) => el("button", { type: "button", "aria-pressed": String(cc === state.gcc), title: (rows.find((r) => r.cc === cc) || {}).name,
      onclick: () => { state.gcc = cc; state.gtarget = null; writeHash(); drawGdpPicker(ecos, rows); showGdpEconomy(true); } }, cc))]));
  }
}
async function showGdpEconomy(B) {
  const us = state.gcc === "US";
  $("#gdp-us").hidden = !us; $("#gdp-intl").hidden = us;
  if (us) return drawGdpUS();
  let F;
  try { F = await load(`gdp/${state.gcc}.json`); } catch (_) { $("#gdpi-grid").replaceChildren(el("p", { class: "empty", text: "This economy's GDP feed did not load." })); return; }
  if (F.cc !== state.gcc) return;
  if (!state.gtarget || !F.targets.find((t) => t.id === state.gtarget)) state.gtarget = F.targets[0].id;
  segb("seg-gdpi-target", F.targets.map((t) => [t.id, `${t.label} ${t.unit.replace("% ", "")}`]), state.gtarget, (v) => { state.gtarget = v; drawGdpIntl(F); });
  $("#seg-gdpi-target").closest(".filters").hidden = F.targets.length < 2;
  drawGdpIntl(F);
}
function drawGdpIntl(F) {
  const T = F.targets.find((t) => t.id === state.gtarget), k = daysTo(T.release), n = narrow();
  const acc = T.acc || [], ho = acc.filter((a) => a.window === "holdout").sort((a, b) => a.h - b.h), dev = acc.filter((a) => a.window === "dev_all").sort((a, b) => a.h - b.h);
  const ref = ho[0] || dev[0];
  const mlabel = (id) => (T.models.find((m) => m.id === id) || { label: id }).label;
  const lines = [["80% range", `${f2(T.band_lo)} to ${f2(T.band_hi)}`, ""], ["Most likely print", String(T.mode ?? "—"), "at one decimal"],
    ["Previous print", isNum(T.prev) ? f2(T.prev) : "—", T.known_through ? `GDP known to ${gPeriod(T.known_through)}` : ""]];
  if (T.bench_name) lines.push([`${T.bench_name} · benchmark`, isNum(T.bench) ? val(T.bench, T.unit) : "not out yet", ""]);
  lines.push(["Blend", T.blend.length ? T.blend.map(mlabel).join(" + ") : "—", T.rule ? `${T.rule} weights` : ""]);
  if (ref && T.blend.length === 1 && T.blend[0] === "ar") lines.push(["Skill v AR", "= AR", "the blend is the AR alone"]);
  else if (ref) lines.push([`Skill v AR, ${ref.window === "holdout" ? "holdout" : "development"} (${ref.n})`, spct(isNum(ref.ours) && isNum(ref.ar) ? 1 - ref.ours / ref.ar : null), isNum(ref.p_ar) ? `DM p ${f2(ref.p_ar)}` : ""]);
  $("#gdpi-call").replaceChildren(
    el("div", { class: "left" }, [el("div", { class: "who", text: `${F.region} · ${F.agency}` }), el("div", { class: "name", text: F.name }),
      el("div", { class: "meta", text: `${T.label}, ${T.unit} · ${gPeriod(T.period)} · releases ${dayFmt(T.release)}${k >= 0 ? ` (in ${k} day${k === 1 ? "" : "s"})` : ""}` }),
      el("div", { class: "big" }, [el("b", { text: val(T.nowcast, T.unit) }), el("span", { text: `± ${f2(T.sd)} · our call` })]),
      el("div", { class: "tags" }, [rtTag(T.real_time), T.structural.length ? strTag() : null, el("span", { class: "meta", text: `Run ${T.as_of}` })])]),
    el("div", { class: "right" }, el("div", { class: "lines" }, lines.map(([a, b, c]) => el("div", { class: "line" }, [el("span", { text: a }), el("b", {}, [b, c ? el("small", { text: c }) : null])])))));

  const grid = $("#gdpi-grid"); grid.replaceChildren();
  const card = (title, ctx, cls = "") => { const f = el("figure", { class: "card " + cls }, el("figcaption", {}, el("h3", {}, [title, ctx ? el("span", { class: "ctx", text: ctx }) : null]))); grid.append(f); return f; };
  // what each model says
  const M = T.models.map((m) => (m.id === T.bench_id || m.id === "advance_only" ? { ...m, label: `${T.bench_name || "Agency advance"} (benchmark)`, bench: true } : m)).sort((a, b) => a.nowcast - b.nowcast);
  const fm = card("What each model says", `${T.unit} · this ${T.id === "monthly" ? "month" : "quarter"}`, "half");
  fm.append(el("div", { class: "legend-row" }, [el("span", {}, [el("i", { style: "background:var(--signal)" }), "in the blend"]), el("span", {}, [el("i", { style: "background:var(--slate)" }), "scored, not adopted"]), el("span", {}, [el("i", { style: "background:var(--c-naive)" }), "naive"])].concat(T.bench_name ? [el("span", {}, [el("i", { style: "background:var(--c-bench)" }), "benchmark"])] : [])),
    el("div", { class: "plot", id: "chart-gdpi-models" }),
    el("p", { class: "note", text: `Each candidate adds one motivated input to its base and joins the blend only if it beats the base in an early and a late window with a Diebold-Mariano p below 0.10 (structural models: no worse in either window). HF = reads a daily or weekly series; * = reads a pseudo-real-time input.` }));
  const flags = (m) => [m.structural ? "structural" : "", m.hf ? "HF" : "", m.pseudo_input ? "*" : ""].filter(Boolean).join(" ");
  const lo = Math.min(0, ...M.map((m) => m.nowcast)), hi = Math.max(0, ...M.map((m) => m.nowcast)), pad = (hi - lo || 1) * (n ? 0.9 : 0.5);
  mount("chart-gdpi-models", [{ type: "bar", orientation: "h", x: M.map((m) => m.nowcast), y: M.map((_, i) => i),
    marker: { color: M.map((m) => (m.w > 0 ? C.ours : m.bench ? C.bench : m.id === "naive" ? C.naive : C.slate)) },
    text: M.map((m) => `${f2(m.nowcast)}${m.w > 0 ? " · w " + f2(m.w) : ""}`), textposition: "outside", cliponaxis: false, textfont: { family: MONO, size: 12, color: C.ink2 },
    customdata: M.map((m) => [m.label, m.reads || "the target's own history", m.tested ? (m.pass ? "adopted" : "not adopted") : "base", isNum(m.dm_p) ? f3(m.dm_p) : "—"]),
    hovertemplate: "%{customdata[0]}: %{x:.2f}<br>Reads %{customdata[1]}<br>Test: %{customdata[2]}, DM p %{customdata[3]}<extra></extra>" }],
  { xaxis: axis(`Nowcast, ${T.unit}`, { zeroline: true, zerolinewidth: 2, range: [lo - pad * (lo < 0 ? 1 : 0.2), hi + pad] }),
    yaxis: axis("", { tickvals: M.map((_, i) => i), ticktext: M.map((m) => `${cutLabel(m.label, n ? 18 : 30)}${flags(m) ? " · " + flags(m) : ""}`), tickfont: { family: COND, size: n ? 11 : 12, color: C.ink2 } }),
    margin: { l: 10, r: 16, t: 6, b: 44 }, bargap: 0.3,
    shapes: [{ type: "line", x0: T.nowcast, x1: T.nowcast, yref: "paper", y0: 0, y1: 1, line: { color: C.actual, width: 2 } }],
    annotations: [{ x: T.nowcast, yref: "paper", y: 1.02, yanchor: "bottom", text: "blend " + f2(T.nowcast), showarrow: false, font: { family: COND, size: 12, color: C.actual } }] }, Math.max(260, M.length * 24 + 70));

  // accuracy by horizon
  const fa = card("Accuracy by horizon", "RMSE pp · days before release", "half");
  const tools = el("div", { class: "segb", id: "seg-gdpi-win", "aria-label": "Window" }); fa.querySelector("figcaption").append(el("div", { class: "card-tools" }, tools));
  const leg = [el("span", {}, [el("i", { style: "background:var(--signal)" }), "ours"]), el("span", {}, [el("i", { style: "background:var(--slate)" }), "AR"]), el("span", {}, [el("i", { class: "dash" }), "naive (last print)"])];
  if (T.bench_name) leg.push(el("span", {}, [el("i", { style: "background:var(--c-bench)" }), T.bench_name + " (benchmark)"]));
  fa.append(el("div", { class: "legend-row" }, leg), el("div", { class: "plot", id: "chart-gdpi-acc" }), el("div", { class: "tablewrap", id: "gdpi-acc" }), el("p", { class: "note", id: "gdpi-acc-note" }));
  if (!state.gwin || !acc.some((a) => a.window === state.gwin)) state.gwin = ho.length ? "holdout" : "dev_all";
  const drawAcc = () => {
    const A = acc.filter((a) => a.window === state.gwin).sort((a, b) => b.h - a.h), xl = A.map((a) => `${a.h} day${a.h === 1 ? "" : "s"}`);
    const tr = [{ type: "bar", x: xl, y: A.map((a) => a.ours), marker: { color: C.ours }, hovertemplate: "Ours %{y:.3f}<extra></extra>" },
      { type: "bar", x: xl, y: A.map((a) => a.ar), marker: { color: C.slate }, hovertemplate: "AR %{y:.3f}<extra></extra>" }];
    if (T.bench_name && A.some((a) => isNum(a.bench) && a.n_bench >= 5)) tr.push({ type: "bar", x: xl, y: A.map((a) => (a.n_bench >= 5 ? a.bench : null)), marker: { color: C.bench }, customdata: A.map((a) => [a.ours_on_bench, a.n_bench]), hovertemplate: `${T.bench_name} %{y:.3f} (ours on the same %{customdata[1]} periods %{customdata[0]:.3f})<extra></extra>` });
    tr.push({ type: "scatter", mode: "markers", x: xl, y: A.map((a) => a.naive), marker: { symbol: "line-ew-open", size: 30, color: C.naive, line: { color: C.naive, width: 2 } }, hovertemplate: "Naive %{y:.3f}<extra></extra>" });
    mount("chart-gdpi-acc", tr, { barmode: "group", bargap: 0.25, xaxis: axis("Days before the release", { type: "category" }), yaxis: axis(`RMSE, pp of ${T.unit.replace("% ", "")}`, { rangemode: "tozero" }), hovermode: "x unified" }, 280);
    const pv = (p) => el("span", { class: isNum(p) && p < 0.05 ? "psig" : "", text: f3(p) });
    const cols = [{ key: "h", label: "Days", n: true }, { key: "n", label: "n", n: true, lo: true },
      { key: "ours", label: "Ours", n: true, render: (r) => el("b", { class: "pos", text: f3(r.ours) }) },
      { key: "ar", label: "AR", n: true, render: (r) => f3(r.ar) }, { key: "p_ar", label: "p", n: true, render: (r) => pv(r.p_ar), tip: "Diebold-Mariano p, ours v AR" },
      { key: "naive", label: "Naive", n: true, lo: true, render: (r) => f3(r.naive) }, { key: "p_naive", label: "p", n: true, lo: true, render: (r) => pv(r.p_naive), tip: "Diebold-Mariano p, ours v naive" }];
    if (T.bench_name) cols.push({ key: "bench", label: "Bench (ours)", n: true, lo: true, render: (r) => (isNum(r.bench) ? `${f3(r.bench)} (${f3(r.ours_on_bench)}, n ${r.n_bench})` : "—"), tip: `${T.bench_name} on the periods it covers, and ours on the same periods` },
      { key: "p_bench", label: "p", n: true, lo: true, render: (r) => pv(r.p_bench), tip: `Diebold-Mariano p, ours v ${T.bench_name}` });
    sortable($("#gdpi-acc"), cols, A);
    const caveat = (F.cc === "CA" || F.cc === "MX") && T.structural.length && state.gwin === "holdout" ? ` Not clean out of sample: the structural rule that admitted ${T.structural.map(mlabel).join(" and ")} was decided after this holdout was computed.` : "";
    const flat = A.length > 1 && A.every((a) => a.ours === A[0].ours) ? " The blend is the AR alone here, so it does not change within the period." : "";
    $("#gdpi-acc-note").textContent = `${state.gwin === "holdout" ? "Holdout: from 2025 to the latest print, computed once after every choice was fixed." : "Development: through the first quarter of 2025, walk-forward."} RMSE in points; lower is better. p is the Diebold-Mariano p-value (Harvey-Leybourne-Newbold) of our errors against that reference's, in amber below 0.05.${T.bench_name ? ` The benchmark is scored only on the periods it covers (bars from 5 periods).` : ""}${flat}${caveat}${T.real_time ? "" : " Pseudo-real-time: today's data cut by publication lags."}`;
  };
  segb("seg-gdpi-win", [["dev_all", "Development"], ["holdout", "Holdout"]].filter(([w]) => acc.some((a) => a.window === w)), state.gwin, (v) => { state.gwin = v; drawAcc(); });
  drawAcc();

  // we said, it printed
  const H = T.history || [], hs = [...new Set(H.map((r) => r[1]))].sort((a, b) => b - a);
  if (H.length) {
    const fh = card("We said. It printed.", `${T.unit} · first print v our call`);
    const t2 = el("div", { class: "segb", id: "seg-gdpi-h", "aria-label": "Days before release" }); fh.querySelector("figcaption").append(el("div", { class: "card-tools" }, t2));
    const lg = [el("span", {}, [el("i", { style: "background:var(--volt)" }), "first print"]), el("span", {}, [el("i", { style: "background:var(--signal)" }), "ours (80% band)"]), el("span", {}, [el("i", { class: "dash" }), "AR"])];
    if (T.bench_name) lg.push(el("span", {}, [el("i", { style: "background:var(--c-bench)" }), T.bench_name]));
    fh.append(el("div", { class: "legend-row" }, lg), el("div", { class: "plot", id: "chart-gdpi-hist" }));
    if (!hs.includes(+state.gh)) state.gh = String(hs[hs.length - 1]);
    const drawH = () => {
      const R = H.filter((r) => String(r[1]) === state.gh), x = R.map((r) => M_(r[0]));
      const tr = [{ type: "scatter", mode: "lines", x, y: R.map((r) => r[3] + 1.2816 * r[4]), line: { width: 0 }, hoverinfo: "skip" },
        { type: "scatter", mode: "lines", x, y: R.map((r) => r[3] - 1.2816 * r[4]), line: { width: 0 }, fill: "tonexty", fillcolor: "rgba(125,147,255,0.16)", hoverinfo: "skip" },
        { type: "scatter", mode: "lines", x, y: R.map((r) => r[6]), line: { color: C.naive, width: 1.4, dash: "dot" }, hovertemplate: "AR %{y:.2f}<extra></extra>" }];
      if (T.bench_name && R.some((r) => isNum(r[7]))) tr.push({ type: "scatter", mode: "lines+markers", x, y: R.map((r) => r[7]), line: { color: C.bench, width: 1.5 }, marker: { size: 4 }, connectgaps: false, hovertemplate: `${T.bench_name} %{y:.2f}<extra></extra>` });
      tr.push({ type: "scatter", mode: "lines", x, y: R.map((r) => r[3]), line: { color: C.ours, width: 2.2 }, hovertemplate: "Ours %{y:.2f}<extra></extra>" },
        { type: "scatter", mode: "markers", x, y: R.map((r) => r[2]), marker: { color: C.actual, size: T.id === "monthly" ? 5 : 7 }, hovertemplate: `%{x|${T.id === "monthly" ? "%b %Y" : "%b %Y (quarter end)"}}<br>First print %{y:.2f}<extra></extra>` });
      mount("chart-gdpi-hist", tr, { xaxis: axis(T.id === "monthly" ? "Reference month" : "Reference quarter (end month)", { type: "date" }), yaxis: axis(T.unit), hovermode: "x unified" }, 320);
    };
    segb("seg-gdpi-h", hs.map((h) => [String(h), `${h} day${h === 1 ? "" : "s"}`]), state.gh, (v) => { state.gh = v; drawH(); });
    drawH();
    fh.append(el("p", { class: "note", text: `Each point is the nowcast made the stated number of days before the release with what was published by then${T.real_time ? "" : " (pseudo-real-time)"}, against the first print. Lockdown months with growth beyond the scoring threshold are left out, as in the scores.` }));
  }

  // every input we tested
  if (T.gate.length) {
    const hfG = T.gate.filter((g) => g.hf), hfPass = hfG.filter((g) => g.pass);
    const fg = card("Every input we tested", `${T.gate.length} candidates · ${T.gate.filter((g) => g.pass).length} adopted`);
    fg.append(el("p", { class: "explain", text: hfG.length ? `${hfG.length} candidate${hfG.length === 1 ? "" : "s"} read a high-frequency series (daily or weekly); ${hfPass.length ? hfPass.length + " passed" : "none has passed our test for GDP yet, so none is in the call"}.` : "No high-frequency series was tested for this target." }));
    const wrap = el("div", { class: "tablewrap", id: "gdpi-gate", style: "max-height:520px" }); fg.append(wrap);
    const rm = (a) => (a && isNum(a[0]) ? el("span", {}, [el("b", { class: a[0] < a[1] ? "pos" : "neg", text: f3(a[0]) }), ` v ${f3(a[1])}`, el("span", { class: "unit", text: "n " + (a[2] ?? "—") })]) : "—");
    sortable(wrap, [
      { key: "label", label: "Candidate", render: (g) => el("span", {}, [n ? cutLabel(g.label, 20) : g.label, g.structural ? " " : "", g.structural ? strTag() : null, g.hf ? " " : "", g.hf ? hfTag() : null]) },
      { key: "reads", label: "Adds", lo: true, render: (g) => el("span", { style: "white-space:normal;display:inline-block;max-width:340px", text: (g.reads || "—") + (g.pseudo_input ? " *" : "") }) },
      { key: "base_label", label: "Base", lo: true },
      { key: "early", label: "Early RMSE", lo: true, sortv: (g) => g.early[0], render: (g) => rm(g.early) },
      { key: "late", label: "Late RMSE", lo: true, sortv: (g) => g.late[0], render: (g) => rm(g.late) },
      { key: "dm_p", label: "DM p", n: true, render: (g) => f3(g.dm_p) },
      { key: "pass", label: "Result", sortv: (g) => (g.pass ? 1 : 0), render: (g) => el("span", { class: "chip " + (g.pass ? "in" : "out"), text: g.pass ? "adopted" : !isNum(g.dm_p) ? "too little data" : !g.wins_both ? "lost a window" : "not significant" }) },
    ], T.gate, { key: "pass", dir: -1 });
    fg.append(el("p", { class: "note", text: "Early and late: RMSE of the candidate v its base in the two development windows, on the periods where the candidate's input changed the forecast. DM p: Diebold-Mariano on one loss per period. * reads a pseudo-real-time input (today's data cut by publication lags), which can be tested but never enters a blend compared with a benchmark." }));
  }
}
const M_ = (m) => new Date(String(m).slice(0, 7) + "-01T00:00:00");

async function drawGdpUS() {
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
    textposition: "outside", cliponaxis: false, textfont: { family: MONO, size: 12, color: C.ink2 }, hovertemplate: "%{y}<br>%{x:.2f}%<extra></extra>" }],
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
  ["Brier score", "Mean squared error of probabilities against outcomes for strike contracts; lower is better."],
  ["Validated input", "A daily or weekly series a leaf model reads because it won walk-forward tests in an early and a late window. It feeds the call."],
  ["Live-prices layer", "Experimental: daily indices from our own price panels, run beside the validated nowcast and scored live. Not our call."],
  ["c (coverage)", "The share of the month's average-on-average change carried by the days the panels have seen; the weight the live layer gets grows with it."],
  ["MTD average", "Month-to-date average of a price against last month's average: how a monthly index sees a daily price."]];
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
  window.addEventListener("hashchange", () => { const key = () => state.tab + state.cc + state.hfView + state.gcc, was = key(); readHash(); if (key() !== was) showTab(state.tab); });
  showTab(["monitor", "economies", "country", "hf", "growth", "record", "method"].includes(state.tab) ? state.tab : "monitor");
}
boot().catch((e) => { const m = $("#main"); if (m) m.prepend(el("p", { class: "explain", text: "The data did not load: " + e.message })); });
