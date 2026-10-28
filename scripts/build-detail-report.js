#!/usr/bin/env node
/**
 * Builds the detailed, expandable HTML report from the last run. Every row is plain HTML (<details>), so it opens
 * without scripts; the small script in the template only adds tabs, search and filters.
 *   input : <workDir>/run-data.json (src/detail-reporter.ts) and <workDir>/.cache/spec.json (downloaded by global setup)
 *   notes : testdata/endpoint-notes.json  { "POST /api/v1/...": "why this endpoint is not automated" }
 *   output: reports/TargetDMS-API-Detailed-Report.html  (or the path given as the first argument)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const root = path.resolve(__dirname, '..');
const workDir = process.env.WORK_DIR ? path.resolve(process.env.WORK_DIR) : path.join(os.tmpdir(), 'targetdms-api-tests');
const run = JSON.parse(fs.readFileSync(path.join(workDir, 'run-data.json'), 'utf8'));
const spec = JSON.parse(fs.readFileSync(path.join(workDir, '.cache', 'spec.json'), 'utf8'));
const notesFile = path.join(root, 'testdata', 'endpoint-notes.json');
const notes = fs.existsSync(notesFile) ? JSON.parse(fs.readFileSync(notesFile, 'utf8')) : {};
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'reports', 'TargetDMS-API-Detailed-Report.html');

const METHODS = ['get', 'post', 'put', 'delete', 'patch'];
const BODY_LIMIT = 8000;
const LABEL = { passed: 'PASSED', failed: 'FAILED', defect: 'KNOWN DEFECT', skipped: 'SKIPPED' };
const ORDER = ['failed', 'defect', 'skipped', 'passed'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- endpoints from the swagger spec ------------------------------------------------------------------------------
const endpoints = [];
for (const [p, item] of Object.entries(spec.paths ?? {})) {
  for (const m of METHODS) {
    const op = item[m];
    if (!op) continue;
    const regex = new RegExp('^' + p.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+') + '/?$', 'i');
    endpoints.push({
      key: `${m.toUpperCase()} ${p}`, method: m.toUpperCase(), path: p, tag: op.tags?.[0] ?? 'Untagged', summary: op.summary ?? '',
      regex, literal: p.replace(/\{[^}]+\}/g, '').length, // more literal characters = more specific template
      tests: [],
    });
  }
}
const endpointFor = (method, url) => {
  const pathOnly = url.replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
  return endpoints.filter((e) => e.method === method && e.regex.test(pathOnly)).sort((a, b) => b.literal - a.literal)[0];
};

// ---- tests ----------------------------------------------------------------------------------------------------------
const trim = (v) => {
  if (v === undefined) return v;
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return s.length > BODY_LIMIT ? s.slice(0, BODY_LIMIT) + `\n... (cut, ${s.length} characters in total)` : s;
};
const pretty = (v) => { // response bodies arrive as pretty JSON or as plain text
  if (typeof v !== 'string') return v;
  try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; }
};

const tests = run.tests.map((t, i) => {
  const exchanges = t.exchanges.map((x) => ({
    method: x.method, url: x.url, endpoint: endpointFor(x.method, x.url)?.key ?? '', status: x.status, ms: x.durationMs, error: x.error ?? '',
    request: trim(x.requestBody), response: trim(pretty(x.responseBody)),
  }));
  const skipReason = t.outcome !== 'skipped' ? '' : t.skipReason || 'Not run: an earlier step of this flow failed or was skipped, and the flow stops at the first failure.';
  const outcome = t.outcome === 'failed' ? (t.knownDefect ? 'defect' : 'failed') : t.outcome;
  for (const key of new Set(exchanges.map((x) => x.endpoint).filter(Boolean))) endpoints.find((e) => e.key === key).tests.push(i);
  return { id: i, file: `tests/${t.file}`, line: t.line, group: t.group, title: t.title, outcome, ms: t.durationMs, error: t.error, skipReason, exchanges };
});

const rows = endpoints.map((e) => {
  const linked = e.tests.map((id) => tests[id]);
  const count = (o) => linked.filter((t) => t.outcome === o).length;
  const automated = linked.length > 0;
  return { ...e, automated, passed: count('passed'), failed: count('failed'), defect: count('defect'), skipped: count('skipped'), linked,
    note: automated ? '' : notes[e.key] ?? 'No test sends a request to this endpoint.' };
});

// ---- html -----------------------------------------------------------------------------------------------------------
const pill = (o) => `<span class="pill p-${o}">${LABEL[o]}</span>`;
const badge = (m) => `<span class="m ${m}">${m}</span>`;

function exchangeHtml(x, open) {
  const ok = x.status >= 200 && x.status < 300;
  const req = x.request === undefined ? '(no body)' : x.request;
  const res = x.error ? x.error : x.response === undefined || x.response === '' ? '(empty body)' : x.response;
  return `<details class="ex"${open ? ' open' : ''}><summary>${badge(x.method)}<span class="path">${esc(x.url)}</span><span class="st ${ok ? 'ok' : 'no'}">${x.error ? 'ERROR' : 'HTTP ' + x.status}</span><span class="nums">${x.ms} ms</span></summary>` +
    `<div class="cols"><div><h4>Request payload</h4><pre>${esc(req)}</pre></div><div><h4>Response</h4><pre>${esc(res)}</pre></div></div></details>`;
}

function testBody(t, focus) {
  const head = `<div class="gname">${esc(t.file)}:${t.line}${t.group ? '  |  ' + esc(t.group) : ''}</div>`;
  const skip = t.skipReason ? `<div class="note">Skipped: ${esc(t.skipReason)}</div>` : '';
  const err = t.error ? `<div class="err">${esc(t.error)}</div>` : '';
  const none = t.exchanges.length ? '' : `<div class="gname">${t.outcome === 'skipped' ? 'No requests were sent.' : 'No requests were recorded for this test (it sends none through the shared client).'}</div>`;
  const list = (focus ? t.exchanges.filter((x) => x.endpoint === focus) : t.exchanges)
    .map((x) => exchangeHtml(x, t.outcome !== 'passed' && (focus ? true : t.exchanges.length <= 2))).join('');
  return `<div class="body">${head}${skip}${err}${none}${list}</div>`;
}

const testRow = (t, focus) =>
  `<details class="row trow"${focus && (t.outcome === 'failed' || t.outcome === 'defect') ? ' open' : ''}><summary>${pill(t.outcome)}<span>${esc(t.title)}</span><span class="gname">${esc(t.group || t.file)}</span><span class="nums">${t.ms} ms</span></summary>` +
  `${testBody(t, focus)}${focus ? `<div class="body"><a class="goto" href="#t${t.id}">Show the whole test (all its requests)</a></div>` : ''}</details>`;

function endpointRow(e) {
  const sorted = [...e.linked].sort((a, b) => ORDER.indexOf(a.outcome) - ORDER.indexOf(b.outcome));
  const body = e.automated
    ? `<div class="body"><div class="gname">Tests that send a request to this endpoint (failed ones are opened first):</div>${sorted.map((t) => testRow(t, e.key)).join('')}</div>`
    : `<div class="body"><div class="note">${esc(e.note)}</div></div>`;
  const nums = e.automated ? `<span class="nums"><b class="n-pass">${e.passed} pass</b> / <b class="n-def">${e.defect} known defect</b> / <b class="n-fail">${e.failed} fail</b> / <b class="n-skip">${e.skipped} skip</b></span>` : '<span></span>';
  const text = `${e.path} ${e.tag} ${e.summary} ${e.method}`.toLowerCase();
  return `<details class="row" data-tag="${esc(e.tag)}" data-auto="${e.automated ? 1 : 0}" data-fail="${e.failed || e.defect ? 1 : 0}" data-skip="${e.skipped ? 1 : 0}" data-text="${esc(text)}">` +
    `<summary>${badge(e.method)}<span class="path">${esc(e.path)}${e.summary ? `<small>${esc(e.summary)}</small>` : ''}</span>` +
    `<span class="pill ${e.automated ? 'p-auto' : 'p-no'}">${e.automated ? 'AUTOMATED' : 'NOT AUTOMATED'}</span>${nums}</summary>${body}</details>`;
}

const tags = [...new Set(rows.map((e) => e.tag))].sort();
let epHtml = '<div id="eplist">';
for (const tag of tags) {
  const group = rows.filter((e) => e.tag === tag);
  epHtml += `<div class="tag-head">${esc(tag)}  (${group.filter((e) => e.automated).length}/${group.length} automated)</div>${group.map(endpointRow).join('')}`;
}
epHtml += '</div>';

const files = [...new Set(tests.map((t) => t.file))].sort();
let tcHtml = '<div id="tclist">';
for (const file of files) {
  tcHtml += `<div class="tag-head">${esc(file.replace(/^tests\//, ''))}</div>`;
  for (const t of tests.filter((x) => x.file === file)) {
    const text = `${t.title} ${t.group} ${t.file} ${t.error} ${t.skipReason}`.toLowerCase();
    tcHtml += testRow(t).replace('<details class="row trow"', `<details class="row trow" id="t${t.id}" data-outcome="${t.outcome}" data-file="${esc(t.file)}" data-text="${esc(text)}"`);
  }
}
tcHtml += '</div>';

const count = (o) => tests.filter((t) => t.outcome === o).length;
const automated = rows.filter((e) => e.automated).length;
const card = (n, label, cls) => `<div class="card ${cls}"><b>${n}</b><span>${label}</span></div>`;
const cards = [
  card(tests.length, 'test cases', ''), card(count('passed'), 'passed', 'c-ok'), card(count('defect'), 'failed: known server defects', 'c-def'),
  card(count('failed'), 'failed: unexpected', 'c-bad'), card(count('skipped'), 'skipped', 'c-warn'),
  card(rows.length, 'endpoints in the API', ''), card(automated, 'endpoints automated', 'c-ok'), card(rows.length - automated, 'endpoints not automated', 'c-bad'),
].join('');
const sub = `${esc(spec.info?.title ?? 'TargetDMS API')} - dealer ${esc(process.env.DEALER_ID ?? '')} - run ${esc(new Date(run.startedAt).toLocaleString())} to ${esc(new Date(run.finishedAt).toLocaleTimeString())}`;

const html = fs.readFileSync(path.join(__dirname, 'detail-report.template.html'), 'utf8')
  .replace('<!--SUB-->', () => sub).replace('<!--CARDS-->', () => cards)
  .replace('<!--TAGS-->', () => tags.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join(''))
  .replace('<!--FILES-->', () => files.map((f) => `<option value="${esc(f)}">${esc(f.replace(/^tests\//, ''))}</option>`).join(''))
  .replace('<!--EP-->', () => epHtml).replace('<!--TC-->', () => tcHtml);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Report: ${out} (${(html.length / 1e6).toFixed(1)} MB)`);
console.log(`${tests.length} tests (${count('passed')} passed, ${count('defect')} known defects, ${count('failed')} other failures, ${count('skipped')} skipped); ${automated}/${rows.length} endpoints automated.`);
