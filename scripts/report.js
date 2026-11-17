/**
 * Report analysis: compares two saved runs of the same module and renders the comparison as HTML (shown on /report and printed
 * to PDF by Microsoft Edge). The older run is always the baseline ("Run 1"), so "improved" means better in the newer run.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const STATUSES = ['passed', 'failed', 'defect', 'skipped'];
const keyOf = (t) => `${t.file}|${t.group ?? ''}|${t.title}`;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);
const secs = (ms) => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');

/** The modules (other than Everything) a test belongs to: its file is one of the module's files and it matches the module's filter. */
function modulesOf(t, modules) {
  const f = 'tests/' + t.file;
  return modules.filter((m) => m.id !== 'all' && m.id !== 'defects' && m.files.some((e) => f === e || f.startsWith(e + '/'))
    && (!m.grep || new RegExp(m.grep).test(`${t.group ?? ''} ${t.title}`)));
}

/** A failure in plain words (the same reading the dashboard gives), from the error and the last call the test made. */
function plainError(t) {
  const err = t.error || '';
  const calls = (t.exchanges || []).filter((x) => x.method !== 'DELETE');
  const last = calls[calls.length - 1] || (t.exchanges || []).slice(-1)[0];
  const got = (err.match(/Received:\s*(\d{3})\b/) || err.match(/HTTP (\d{3})/) || [])[1] || (last && last.status ? String(last.status) : '');
  const want = (err.match(/Expected:\s*(\d{3})\b/) || [])[1] || '';
  const said = ((err.match(/"Message":"([^"]{5,200})"/) || [])[1] || '').replace(/\\r\\n/g, ' ');
  const tail = said ? ` The API said: "${said}".` : '';
  if (/ECONNRESET|socket hang up|ECONNREFUSED/i.test(err)) return 'The connection to the test server was cut (network problem, not an API fault).';
  if (/Timeout \d+ms exceeded|timed out/i.test(err)) return 'The server did not answer in time.';
  if (/ENOTFOUND|EAI_AGAIN/i.test(err)) return 'The server address could not be found (DNS or VPN problem); no request reached the API.';
  if (got === '429') return 'Too many requests in a short time (rate limit).';
  if (got === '401' && want !== '401') return 'The login was not accepted (401): the token had stopped working.';
  if (/^5/.test(got) && !/^5/.test(want)) return `The API failed on its own side (error ${got})${want ? `; ${want} was expected` : ''}.${tail}`;
  if (got && want && got !== want) return `The API answered ${got}; ${want} was expected.${tail}`;
  if (/Expected/.test(err) && /Received/.test(err)) return `The API answered, but a value in the answer is not what the test expects.${tail}`;
  const first = err.split('\n').find((l) => l.trim()) || 'A check in the test did not hold.';
  return first.replace(/^Error:\s*/, '').slice(0, 220) + tail;
}

/** Per endpoint: how many calls, how many answered 2xx, and the statuses seen. */
function endpointStats(tests) {
  const map = new Map();
  for (const t of tests) for (const x of t.exchanges || []) {
    if (!x.endpoint) continue;
    const e = map.get(x.endpoint) ?? { calls: 0, ok: 0, statuses: new Set() };
    e.calls += 1; if (x.status >= 200 && x.status < 300) e.ok += 1; e.statuses.add(x.status || 'no answer');
    map.set(x.endpoint, e);
  }
  return map;
}

const counts = (tests) => Object.fromEntries(STATUSES.map((s) => [s, tests.filter((t) => t.status === s).length]));
const passRate = (c) => pct(c.passed, c.passed + c.failed + c.defect);   // of the tests that ran (skipped left out)

function verdict(a, b) {
  const d = b.rate - a.rate;
  if (b.fixed > 0 && b.broke === 0 && d >= 0) return 'Improved';
  if (b.broke > 0 && b.fixed === 0 && d <= 0) return 'Worse';
  if (Math.abs(d) < 0.5 && !b.fixed && !b.broke) return 'Same';
  return d > 0 ? 'Improved' : d < 0 ? 'Worse' : 'Mixed';
}

function compareRuns(runA, runB, modules) {
  // The older run is the baseline.
  let [r1, r2] = [runA, runB];
  if (new Date(r1.run.startedAt) > new Date(r2.run.startedAt)) [r1, r2] = [r2, r1];
  const t1 = r1.run.tests ?? [], t2 = r2.run.tests ?? [];
  const m1 = new Map(t1.map((t) => [keyOf(t), t])), m2 = new Map(t2.map((t) => [keyOf(t), t]));
  const both = [...m2.keys()].filter((k) => m1.has(k));
  const pairs = both.map((k) => ({ a: m1.get(k), b: m2.get(k) }));
  const row = (t) => ({ title: t.title, group: t.group ?? '', file: t.file, why: plainError(t), modules: modulesOf(t, modules).map((m) => m.name) });

  const fixed = pairs.filter(({ a, b }) => a.status === 'failed' && b.status === 'passed').map(({ b, a }) => ({ ...row(b), why: plainError(a) }));
  const broke = pairs.filter(({ a, b }) => a.status === 'passed' && b.status === 'failed').map(({ b }) => row(b));
  const still = pairs.filter(({ a, b }) => a.status === 'failed' && b.status === 'failed').map(({ b }) => row(b));
  const nowRun = pairs.filter(({ a, b }) => a.status === 'skipped' && (b.status === 'passed' || b.status === 'failed')).map(({ b }) => ({ ...row(b), now: b.status }));
  const nowSkipped = pairs.filter(({ a, b }) => a.status !== 'skipped' && b.status === 'skipped').map(({ a, b }) => ({ ...row(b), was: a.status, why: b.skipReason || '' }));

  const defects = pairs.filter(({ a }) => a.status === 'defect').map(({ a, b }) => ({ ...row(b), was: a.status, now: b.status }));
  const newDefects = pairs.filter(({ a, b }) => a.status !== 'defect' && b.status === 'defect').map(({ b }) => row(b));

  // Per module: counts over the tests that belong to it, in each run.
  const perModule = [];
  for (const m of modules.filter((x) => x.id !== 'all' && x.id !== 'defects')) {
    const in1 = t1.filter((t) => modulesOf(t, [m]).length), in2 = t2.filter((t) => modulesOf(t, [m]).length);
    if (!in1.length && !in2.length) continue;
    const c1 = counts(in1), c2 = counts(in2);
    const mine = pairs.filter(({ b }) => modulesOf(b, [m]).length);
    const a = { ...c1, total: in1.length, rate: passRate(c1) };
    const b = { ...c2, total: in2.length, rate: passRate(c2),
      fixed: mine.filter(({ a: x, b: y }) => x.status === 'failed' && y.status === 'passed').length,
      broke: mine.filter(({ a: x, b: y }) => x.status === 'passed' && y.status === 'failed').length };
    perModule.push({ id: m.id, name: m.name, a, b, change: Math.round((b.rate - a.rate) * 10) / 10, verdict: verdict(a, b) });
  }
  // Known-defect tests are their own row.
  const d1 = t1.filter((t) => /known defect/i.test(t.title) || t.file.startsWith('defects/')), d2 = t2.filter((t) => /known defect/i.test(t.title) || t.file.startsWith('defects/'));
  if (d1.length || d2.length) {
    const c1 = counts(d1), c2 = counts(d2);
    perModule.push({ id: 'defects', name: 'Known server defects', a: { ...c1, total: d1.length, rate: passRate(c1) },
      b: { ...c2, total: d2.length, rate: passRate(c2), fixed: 0, broke: 0 }, change: Math.round((passRate(c2) - passRate(c1)) * 10) / 10,
      verdict: c2.passed > c1.passed ? 'Improved' : c2.passed < c1.passed ? 'Worse' : 'Same' });
  }

  // Endpoints that started or stopped answering 2xx (only endpoints called in both runs).
  const e1 = endpointStats(t1), e2 = endpointStats(t2);
  const epRow = (k) => ({ endpoint: k, a: { calls: e1.get(k).calls, ok: e1.get(k).ok, statuses: [...e1.get(k).statuses].join(', ') }, b: { calls: e2.get(k).calls, ok: e2.get(k).ok, statuses: [...e2.get(k).statuses].join(', ') } });
  const common = [...e2.keys()].filter((k) => e1.has(k));
  const started = common.filter((k) => !e1.get(k).ok && e2.get(k).ok).map(epRow);
  const stopped = common.filter((k) => e1.get(k).ok && !e2.get(k).ok).map(epRow);
  const onlyIn1 = [...e1.keys()].filter((k) => !e2.has(k)).sort(), onlyIn2 = [...e2.keys()].filter((k) => !e1.has(k)).sort();

  // Timing.
  const dur = (r) => (r.startedAt && r.finishedAt ? new Date(r.finishedAt) - new Date(r.startedAt) : (r.tests ?? []).reduce((s, t) => s + (t.ms || 0), 0));
  const slowest = [...t2].filter((t) => t.ms).sort((x, y) => y.ms - x.ms).slice(0, 10).map((t) => ({ title: t.title, file: t.file, b: t.ms, a: m1.get(keyOf(t))?.ms ?? null }));
  const slower = pairs.filter(({ a, b }) => a.ms > 0 && b.ms - a.ms > 2000 && b.ms > a.ms * 1.5).sort((x, y) => (y.b.ms - y.a.ms) - (x.b.ms - x.a.ms)).slice(0, 10)
    .map(({ a, b }) => ({ title: b.title, file: b.file, a: a.ms, b: b.ms }));

  const c1 = counts(t1), c2 = counts(t2);
  const side = (r, c, file) => ({ file, name: r.name, startedAt: r.run.startedAt, finishedAt: r.run.finishedAt, dealer: r.run.dealer ?? '', total: (r.run.tests ?? []).length, ...c, rate: passRate(c), ms: dur(r.run) });
  return {
    run1: side(r1, c1, r1.file), run2: side(r2, c2, r2.file),
    common: both.length, onlyIn1: t1.length - both.length, onlyIn2: t2.length - both.length,
    fixed, broke, still, nowRun, nowSkipped, defects, newDefects, perModule,
    endpoints: { started, stopped, onlyIn1, onlyIn2, called1: e1.size, called2: e2.size, working1: [...e1.values()].filter((e) => e.ok).length, working2: [...e2.values()].filter((e) => e.ok).length },
    timing: { slowest, slower },
  };
}

// ---- rendering --------------------------------------------------------------------------------------------------------
const CSS = `
.rp { --ok:#1a7f4b; --bad:#b42318; --warn:#a15c00; --def:#7a3db8; --mute:#5b6675; --line:#e2e6ec; --okbg:#e6f4ec; --badbg:#fdeceb; --warnbg:#fff4e0; --defbg:#f1e8fb; --head:#f3f5f8;
  color:#1c2430; background:#fff; font:13px/1.45 system-ui,"Segoe UI",sans-serif; }
.rp h2 { font-size:20px; margin:0 0 2px; } .rp h3 { font-size:15px; margin:22px 0 8px; padding-bottom:4px; border-bottom:2px solid var(--line); break-after:avoid; }
.rp .sub { color:var(--mute); margin:0 0 14px; }
.rp .headline { background:var(--head); border-left:4px solid #1d4ed8; border-radius:6px; padding:10px 14px; margin:10px 0 4px; font-size:14px; }
.rp .runs { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.rp .run { border:1px solid var(--line); border-radius:8px; padding:10px 12px; }
.rp .run b { display:block; font-size:14px; } .rp .run small { color:var(--mute); }
.rp .tiles { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }
.rp .tile { border-radius:6px; padding:3px 8px; font-weight:600; font-size:12px; }
.rp .p { background:var(--okbg); color:var(--ok); } .rp .f { background:var(--badbg); color:var(--bad); } .rp .d { background:var(--defbg); color:var(--def); } .rp .s { background:var(--head); color:var(--mute); }
.rp table { width:100%; border-collapse:collapse; margin-top:4px; } .rp th, .rp td { text-align:left; padding:5px 7px; border-bottom:1px solid var(--line); vertical-align:top; }
.rp th { background:var(--head); font-size:12px; } .rp td.n, .rp th.n { text-align:right; white-space:nowrap; } .rp th.n, .rp td.wrap { white-space:normal; } .rp tr { break-inside:avoid; }
.rp .v { font-weight:700; border-radius:999px; padding:1px 9px; font-size:12px; white-space:nowrap; }
.rp .v.Improved { background:var(--okbg); color:var(--ok); } .rp .v.Worse { background:var(--badbg); color:var(--bad); } .rp .v.Mixed { background:var(--warnbg); color:var(--warn); } .rp .v.Same { background:var(--head); color:var(--mute); }
.rp .up { color:var(--ok); font-weight:600; } .rp .down { color:var(--bad); font-weight:600; }
.rp .why { color:var(--mute); font-size:12px; } .rp .where { color:var(--mute); font-size:11px; }
.rp .none { color:var(--mute); font-style:italic; margin:4px 0; }
.rp .note { color:var(--mute); font-size:12px; margin:4px 0 0; }
.rp .charts { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
.rp .chart { margin:12px 0 0; border:1px solid var(--line); border-radius:8px; padding:10px 12px; break-inside:avoid; }
.rp .charts .chart { margin:0; }
.rp figcaption { font-weight:700; font-size:13px; margin-bottom:6px; }
.rp .donutrow { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.rp .legend { display:flex; flex-direction:column; gap:4px; font-size:12px; min-width:170px; }
.rp .legend.inline { flex-direction:row; flex-wrap:wrap; gap:14px; margin-bottom:4px; }
.rp .lg { display:flex; align-items:center; gap:6px; } .rp .lg i { width:10px; height:10px; border-radius:3px; flex:none; }
.rp .lg b { margin-left:auto; padding-left:10px; } .rp .lg span { color:var(--mute); width:44px; text-align:right; }
.rp svg text { font-family:system-ui,"Segoe UI",sans-serif; }
.rp svg .big { font-size:22px; font-weight:700; fill:#1c2430; } .rp svg .small { font-size:11px; fill:#5b6675; }
.rp svg .lbl { font-size:12px; fill:#1c2430; } .rp svg .val { font-size:11px; fill:#5b6675; } .rp svg .axis { font-size:10px; fill:#8a94a3; }
.rp svg .grid { stroke:#eef1f4; stroke-width:1; }
.rp svg rect:hover, .rp svg circle:hover { opacity:.8; }
@media (max-width:640px) { .rp .charts { grid-template-columns:1fr; } }
`;

// ---- charts (inline SVG, so they show the same on the page and in the PDF) ----------------------------------------------
// Status colors match the dashboard; every slice and bar also carries a text label, so nothing is told by color alone.
const STATUS_COLORS = { passed: '#1a7f4b', failed: '#b42318', defect: '#7a3db8', skipped: '#8a94a3' };
const STATUS_NAMES = { passed: 'Passed', failed: 'Failed', defect: 'Known defects', skipped: 'Skipped' };
const RUN_COLORS = ['#d97706', '#1d4ed8'];   // Run 1, Run 2 (checked for colour-blind separation and contrast)

/** A donut of passed / failed / known defects / skipped for one run. */
function donut(r, label) {
  const R = 54, W = 18, C = 2 * Math.PI * R, total = r.total || 1;
  let at = 0;
  const arcs = STATUS_ORDER.map((s) => {
    const n = r[s] || 0; if (!n) return '';
    const len = (n / total) * C, gap = len > 4 ? 2 : 0;
    const arc = `<circle cx="70" cy="70" r="${R}" fill="none" stroke="${STATUS_COLORS[s]}" stroke-width="${W}" stroke-dasharray="${len - gap} ${C - len + gap}" stroke-dashoffset="${-at}" transform="rotate(-90 70 70)"><title>${STATUS_NAMES[s]}: ${n} of ${r.total} (${pct(n, r.total)}%)</title></circle>`;
    at += len; return arc;
  }).join('');
  const legend = STATUS_ORDER.map((s) => `<div class="lg"><i style="background:${STATUS_COLORS[s]}"></i>${STATUS_NAMES[s]}<b>${r[s] || 0}</b><span>${pct(r[s] || 0, r.total)}%</span></div>`).join('');
  return `<figure class="chart donut"><figcaption>${esc(label)}</figcaption><div class="donutrow">
    <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="${esc(label)}: ${STATUS_ORDER.map((s) => `${r[s] || 0} ${STATUS_NAMES[s].toLowerCase()}`).join(', ')}">
      <circle cx="70" cy="70" r="${R}" fill="none" stroke="#eef1f4" stroke-width="${W}"/>${arcs}
      <text x="70" y="68" text-anchor="middle" class="big">${r.rate}%</text><text x="70" y="86" text-anchor="middle" class="small">pass rate</text>
    </svg><div class="legend">${legend}</div></div></figure>`;
}
const STATUS_ORDER = ['passed', 'failed', 'defect', 'skipped'];

/** Horizontal bars with a text label at each bar end. rows: [{ label, values:[{ v, color, name }] }], max: the scale's top. */
function hbars(title, rows, { max, unit = '', legend = [], note = '' } = {}) {
  const LBL = 230, PLOT = 430, BAR = 10, GAP = 2, PAD = 10;
  const per = rows[0]?.values.length ?? 1, rowH = per * BAR + (per - 1) * GAP + PAD * 2;
  // Counts get a whole-number scale (top = 4 equal whole steps).
  const top = max || Math.ceil(Math.max(1, ...rows.flatMap((r) => r.values.map((v) => v.v))) / 4) * 4;
  const H = rows.length * rowH + 22, W = LBL + PLOT + 50;
  const x = (v) => (v / top) * PLOT;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  const grid = [...new Set(ticks)].map((t) => `<line x1="${LBL + x(t)}" x2="${LBL + x(t)}" y1="0" y2="${H - 20}" class="grid"/><text x="${LBL + x(t)}" y="${H - 6}" text-anchor="middle" class="axis">${t}${unit}</text>`).join('');
  const bars = rows.map((r, i) => {
    const y0 = i * rowH + PAD;
    const name = r.label.length > 36 ? r.label.slice(0, 35) + '…' : r.label;
    return `<text x="${LBL - 8}" y="${y0 + (per * (BAR + GAP) - GAP) / 2 + 4}" text-anchor="end" class="lbl"><title>${esc(r.label)}</title>${esc(name)}</text>` + r.values.map((v, j) => {
      const y = y0 + j * (BAR + GAP), w = Math.max(v.v ? 2 : 0, x(v.v));
      return `<g><rect x="${LBL}" y="${y}" width="${w}" height="${BAR}" rx="3" fill="${v.color}"><title>${esc(r.label)}${v.name ? ' - ' + esc(v.name) : ''}: ${v.v}${unit}</title></rect><text x="${LBL + w + 5}" y="${y + BAR - 1}" class="val">${v.v}${unit}</text></g>`;
    }).join('');
  }).join('');
  const lg = legend.length ? `<div class="legend inline">${legend.map((l) => `<div class="lg"><i style="background:${l.color}"></i>${esc(l.name)}</div>`).join('')}</div>` : '';
  return `<figure class="chart"><figcaption>${esc(title)}</figcaption>${lg}<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(title)}">${grid}${bars}</svg>${note ? `<p class="note">${note}</p>` : ''}</figure>`;
}

function charts(c) {
  const changes = [
    { label: 'Fixed (failed, now pass)', v: c.fixed.length, color: STATUS_COLORS.passed },
    { label: 'Newly failing', v: c.broke.length, color: STATUS_COLORS.failed },
    { label: 'Still failing in both', v: c.still.length, color: '#a15c00' },
    { label: 'Ran now, skipped before', v: c.nowRun.length, color: '#1d4ed8' },
    { label: 'Skipped now, ran before', v: c.nowSkipped.length, color: STATUS_COLORS.skipped },
    { label: 'Known defects now passing', v: c.defects.filter((d) => d.now === 'passed').length, color: STATUS_COLORS.defect },
  ];
  return `<div class="charts">${donut(c.run1, 'Run 1 results')}${donut(c.run2, 'Run 2 results')}</div>`
    + hbars('What changed from Run 1 to Run 2 (number of tests)', changes.map((x) => ({ label: x.label, values: [{ v: x.v, color: x.color }] })));
}

function moduleChart(c) {
  const rows = c.perModule.map((m) => ({ label: m.name, values: [{ v: m.a.rate, color: RUN_COLORS[0], name: 'Run 1' }, { v: m.b.rate, color: RUN_COLORS[1], name: 'Run 2' }] }));
  return rows.length ? hbars('Pass rate per module', rows, { max: 100, unit: '%', legend: [{ name: 'Run 1 (older)', color: RUN_COLORS[0] }, { name: 'Run 2 (newer)', color: RUN_COLORS[1] }] }) : '';
}

const tile = (cls, n, label) => `<span class="tile ${cls}">${n} ${label}</span>`;
const delta = (n, unit = '', goodUp = true) => (n === 0 ? `<span>0${unit}</span>` : `<span class="${(n > 0) === goodUp ? 'up' : 'down'}">${n > 0 ? '+' : ''}${n}${unit}</span>`);
const testList = (rows, extra) => (rows.length ? `<table><tr><th>Test</th><th>Module</th><th>${extra?.head ?? 'Why'}</th></tr>${rows.map((r) =>
  `<tr><td>${esc(r.title)}<div class="where">${esc(r.file)}${r.group ? ' | ' + esc(r.group) : ''}</div></td><td>${esc(r.modules.join(', ') || '-')}</td><td class="why">${extra?.cell ? extra.cell(r) : esc(r.why)}</td></tr>`).join('')}</table>` : '<p class="none">None.</p>');

function renderReport(c) {
  const r1 = c.run1, r2 = c.run2;
  const runBox = (label, r) => `<div class="run"><b>${label}: ${esc(r.name)}</b><small>${when(r.startedAt)} - took ${secs(r.ms)}${r.dealer ? ' - dealer ' + esc(r.dealer) : ''}</small>
    <div class="tiles">${tile('p', r.passed, 'passed')}${tile('f', r.failed, 'failed')}${tile('d', r.defect, 'known defects')}${tile('s', r.skipped, 'skipped')}</div>
    <small>${r.total} tests - pass rate ${r.rate}% (of the tests that ran)</small></div>`;
  const rateChange = Math.round((r2.rate - r1.rate) * 10) / 10;
  const headline = `Run 2 has <b>${c.fixed.length}</b> test${c.fixed.length === 1 ? '' : 's'} fixed and <b>${c.broke.length}</b> newly failing; pass rate ${r1.rate}% &rarr; ${r2.rate}% (${delta(rateChange, ' pts')}). `
    + `${c.still.length} still fail in both runs. Endpoints answering successfully: ${c.endpoints.working1} &rarr; ${c.endpoints.working2}.`;
  const mods = c.perModule.length ? `<table><tr><th>Module</th><th class="n">Run 1 passed / failed / defect / skipped</th><th class="n">Run 2 passed / failed / defect / skipped</th><th class="n">Pass rate</th><th class="n">Fixed</th><th class="n">Newly failing</th><th>Verdict</th></tr>${c.perModule.map((m) =>
    `<tr><td>${esc(m.name)}</td><td class="n">${m.a.passed} / ${m.a.failed} / ${m.a.defect} / ${m.a.skipped}</td><td class="n">${m.b.passed} / ${m.b.failed} / ${m.b.defect} / ${m.b.skipped}</td>
     <td class="n wrap">${m.a.rate}% &rarr; ${m.b.rate}% (${delta(m.change, ' pts')})</td><td class="n">${m.b.fixed}</td><td class="n">${m.b.broke}</td><td><span class="v ${m.verdict}">${m.verdict}</span></td></tr>`).join('')}</table>
    <p class="note">A test can belong to more than one module (for example a warranty checkout is in both warranty modules), so the module rows do not add up to the run total. Pass rate leaves skipped tests out.</p>` : '<p class="none">No module data.</p>';
  const defectsFixed = c.defects.filter((d) => d.now === 'passed'), defectsStill = c.defects.filter((d) => d.now === 'defect'), defectsOther = c.defects.filter((d) => d.now !== 'passed' && d.now !== 'defect');
  const epTable = (rows) => (rows.length ? `<table><tr><th>Endpoint</th><th class="n">Run 1: calls (2xx) - statuses</th><th class="n">Run 2: calls (2xx) - statuses</th></tr>${rows.map((e) =>
    `<tr><td>${esc(e.endpoint)}</td><td class="n">${e.a.calls} (${e.a.ok}) - ${esc(e.a.statuses)}</td><td class="n">${e.b.calls} (${e.b.ok}) - ${esc(e.b.statuses)}</td></tr>`).join('')}</table>` : '<p class="none">None.</p>');
  const timeRows = (rows) => (rows.length ? `<table><tr><th>Test</th><th class="n">Run 1</th><th class="n">Run 2</th><th class="n">Change</th></tr>${rows.map((t) =>
    `<tr><td>${esc(t.title)}<div class="where">${esc(t.file)}</div></td><td class="n">${t.a == null ? '-' : secs(t.a)}</td><td class="n">${secs(t.b)}</td><td class="n">${t.a == null ? '-' : delta(Math.round((t.b - t.a) / 100) / 10, 's', false)}</td></tr>`).join('')}</table>` : '<p class="none">None.</p>');

  return `<div class="rp">
<h2>Run comparison: ${esc(r2.name)}</h2>
<p class="sub">Run 1 (baseline, older) ${when(r1.startedAt)} compared with Run 2 (newer) ${when(r2.startedAt)}. ${c.common} tests ran in both${c.onlyIn1 || c.onlyIn2 ? `; ${c.onlyIn1} only in Run 1, ${c.onlyIn2} only in Run 2` : ''}.</p>
<div class="runs">${runBox('Run 1', r1)}${runBox('Run 2', r2)}</div>
<div class="headline">${headline}</div>
${charts(c)}

<h3>1. Modules</h3>${moduleChart(c)}${mods}

<h3>2. Fixed in Run 2 (${c.fixed.length})</h3><p class="note">Failed in Run 1, passed in Run 2. "Why" is what went wrong in Run 1.</p>${testList(c.fixed, { head: 'Why it failed in Run 1' })}
<h3>3. Newly failing in Run 2 (${c.broke.length})</h3><p class="note">Passed in Run 1, failed in Run 2.</p>${testList(c.broke)}
<h3>4. Still failing in both runs (${c.still.length})</h3>${testList(c.still, { head: 'Why (Run 2)' })}
${c.nowRun.length ? `<h3>Ran in Run 2 but were skipped in Run 1 (${c.nowRun.length})</h3>${testList(c.nowRun, { head: 'Run 2 result', cell: (r) => r.now === 'passed' ? '<span class="up">passed</span>' : `<span class="down">failed</span>: ${esc(r.why)}` })}` : ''}
${c.nowSkipped.length ? `<h3>Ran in Run 1 but were skipped in Run 2 (${c.nowSkipped.length})</h3>${testList(c.nowSkipped, { head: 'Run 1 result / why skipped', cell: (r) => `${esc(r.was)}; ${esc(r.why)}` })}` : ''}

<h3>5. Known server defects</h3>
<p class="note">${defectsStill.length} still failing as known, ${defectsFixed.length} now pass (the server may have fixed them - check and close the bug), ${c.newDefects.length} new.</p>
${defectsFixed.length ? `<b>Now pass in Run 2</b>${testList(defectsFixed, { head: 'Run 2 result', cell: () => '<span class="up">passed</span>' })}` : ''}
${c.newDefects.length ? `<b>New known-defect failures in Run 2</b>${testList(c.newDefects)}` : ''}
${defectsOther.length ? `<b>Skipped or changed in Run 2</b>${testList(defectsOther, { head: 'Run 2 result', cell: (r) => esc(r.now) })}` : ''}
<b>Still failing as known</b>${testList(defectsStill, { head: 'Why (Run 2)' })}

<h3>6. Endpoints</h3>
<p class="note">Called in Run 1: ${c.endpoints.called1}, answering 2xx at least once: ${c.endpoints.working1}. Called in Run 2: ${c.endpoints.called2}, answering 2xx: ${c.endpoints.working2}. Only endpoints called in both runs are compared.</p>
<b>Started working in Run 2 (${c.endpoints.started.length})</b>${epTable(c.endpoints.started)}
<b>Stopped working in Run 2 (${c.endpoints.stopped.length})</b>${epTable(c.endpoints.stopped)}
${c.endpoints.onlyIn1.length ? `<p class="note">Called only in Run 1: ${c.endpoints.onlyIn1.map(esc).join(', ')}</p>` : ''}
${c.endpoints.onlyIn2.length ? `<p class="note">Called only in Run 2: ${c.endpoints.onlyIn2.map(esc).join(', ')}</p>` : ''}

<h3>7. Timing</h3>
<p class="note">Run 1 took ${secs(r1.ms)}, Run 2 took ${secs(r2.ms)} (${delta(Math.round((r2.ms - r1.ms) / 1000), 's', false)}). Most of a full run is the request limit (80 calls per 3 minutes), not server speed.</p>
<b>Slowest tests in Run 2</b>${timeRows(c.timing.slowest)}
<b>Much slower than in Run 1</b>${timeRows(c.timing.slower)}
</div>`;
}

/** A standalone page of the report, for printing to PDF. */
const printPage = (c) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Run comparison - ${esc(c.run2.name)}</title>
<style>@page { size:A4; margin:14mm 12mm; } body { margin:0; background:#fff; -webkit-print-color-adjust:exact; print-color-adjust:exact; } ${CSS}</style></head><body>${renderReport(c)}</body></html>`;

function edgePath() {
  const candidates = [process.env.EDGE_PATH, path.join(process.env['ProgramFiles(x86)'] ?? '', 'Microsoft/Edge/Application/msedge.exe'), path.join(process.env.ProgramFiles ?? '', 'Microsoft/Edge/Application/msedge.exe')];
  return candidates.find((p) => p && fs.existsSync(p));
}

/** Prints an HTML page to PDF with headless Microsoft Edge (its own temporary profile, so an open Edge window is not touched). */
function htmlToPdf(html) {
  return new Promise((resolve, reject) => {
    const edge = edgePath();
    if (!edge) return reject(new Error('Microsoft Edge was not found (set EDGE_PATH in .env).'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-report-'));
    const page = path.join(dir, 'report.html'), pdf = path.join(dir, 'report.pdf');
    fs.writeFileSync(page, html);
    const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', `--user-data-dir=${path.join(dir, 'profile')}`, '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, 'file:///' + page.replace(/\\/g, '/')], { stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on('error', reject);
    child.on('close', () => {
      clearTimeout(timer);
      try { const out = fs.readFileSync(pdf); resolve(out); } catch { reject(new Error('Edge did not produce the PDF.')); }
      finally { fs.rm(dir, { recursive: true, force: true }, () => {}); }
    });
  });
}

module.exports = { compareRuns, renderReport, printPage, htmlToPdf, CSS, counts, passRate };
