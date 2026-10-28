#!/usr/bin/env node
/**
 * Live test dashboard. Start it, open the address it prints, then run the suite (npm test) in another terminal:
 * src/live-reporter.ts posts each test's start and result here, and the page updates as they arrive.
 * Finished runs are saved under <workDir>/runs and can be reopened from the page.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { root, workDir, loadEndpoints, endpointFor } = require('./lib');

const PORT = Number(process.env.DASHBOARD_PORT ?? 9000);
const runsDir = path.join(workDir, 'runs');
const specFile = path.join(workDir, '.cache', 'spec.json');
const notesFile = path.join(root, 'testdata', 'endpoint-notes.json');
const BODY_LIMIT = 8000;

let state = { status: 'idle', startedAt: null, finishedAt: null, label: '', tests: new Map() };
const clients = new Set();

// Start on the newest saved run so a restart does not show an empty page.
try {
  const saved = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((n) => n.endsWith('.json')).sort().pop() : undefined;
  if (saved) {
    const run = JSON.parse(fs.readFileSync(path.join(runsDir, saved), 'utf8'));
    state = { ...run, tests: new Map(run.tests.map((t) => [t.id, t])) };
  }
} catch { /* an unreadable run file is ignored */ }

// ---- helpers --------------------------------------------------------------------------------------------------------
const trim = (v) => {
  if (v === undefined) return v;
  let s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  if (typeof v === 'string') { try { s = JSON.stringify(JSON.parse(v), null, 2); } catch { /* plain text */ } }
  return s.length > BODY_LIMIT ? s.slice(0, BODY_LIMIT) + `\n... (cut, ${s.length} characters in total)` : s;
};

let specCache = { mtime: 0, endpoints: [] };
function endpoints() {
  if (!fs.existsSync(specFile)) return [];
  const mtime = fs.statSync(specFile).mtimeMs;
  if (mtime !== specCache.mtime) specCache = { mtime, endpoints: loadEndpoints(JSON.parse(fs.readFileSync(specFile, 'utf8'))) };
  return specCache.endpoints;
}

function outcomeOf(status, knownDefect) {
  if (status === 'skipped') return 'skipped';
  if (status === 'passed') return 'passed';
  return knownDefect ? 'defect' : 'failed';
}

const light = (t) => ({ id: t.id, title: t.title, group: t.group, file: t.file, line: t.line, status: t.status, ms: t.ms, startedAt: t.startedAt, error: t.error, skipReason: t.skipReason, requests: t.exchanges.length, endpoints: t.endpoints });
const snapshot = () => ({ status: state.status, startedAt: state.startedAt, finishedAt: state.finishedAt, label: state.label, dealer: process.env.DEALER_ID ?? '', tests: [...state.tests.values()].map(light) });

function broadcast(event) {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(data);
}

function save() {
  fs.mkdirSync(runsDir, { recursive: true });
  const name = `run-${state.startedAt.replace(/[:.]/g, '-')}.json`;
  fs.writeFileSync(path.join(runsDir, name), JSON.stringify({ ...snapshot(), tests: [...state.tests.values()] }));
}

// ---- events from the reporter ---------------------------------------------------------------------------------------
function handle(ev) {
  if (ev.type === 'begin') {
    state = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, label: '', tests: new Map() };
    for (const t of ev.tests) state.tests.set(t.id, { ...t, status: 'queued', ms: 0, error: '', skipReason: '', exchanges: [], endpoints: [] });
    broadcast({ type: 'state', state: snapshot() });
  } else if (ev.type === 'start') {
    const t = state.tests.get(ev.id);
    if (t) { t.status = 'running'; t.startedAt = new Date().toISOString(); broadcast({ type: 'test', test: light(t) }); }
  } else if (ev.type === 'end') {
    const eps = endpoints();
    const exchanges = ev.exchanges.map((x) => ({
      method: x.method, url: x.url, endpoint: endpointFor(eps, x.method, x.url)?.key ?? '', status: x.status, ms: x.durationMs, error: x.error ?? '',
      request: trim(x.requestBody), response: trim(x.responseBody),
    }));
    const t = state.tests.get(ev.test.id) ?? { ...ev.test, startedAt: null };
    Object.assign(t, ev.test, {
      status: outcomeOf(ev.status, ev.test.knownDefect), ms: ev.ms, error: ev.error, exchanges,
      endpoints: [...new Set(exchanges.map((x) => x.endpoint).filter(Boolean))],
      skipReason: ev.status !== 'skipped' ? '' : ev.skipReason || 'Not run: an earlier step of this flow failed or was skipped, and the flow stops at the first failure.',
    });
    state.tests.set(t.id, t);
    broadcast({ type: 'test', test: light(t) });
  } else if (ev.type === 'finish') {
    state.status = 'finished';
    state.finishedAt = new Date().toISOString();
    save();
    broadcast({ type: 'state', state: snapshot() });
  }
}

// ---- endpoint coverage ----------------------------------------------------------------------------------------------
function coverage() {
  const notes = fs.existsSync(notesFile) ? JSON.parse(fs.readFileSync(notesFile, 'utf8')) : {};
  return endpoints().map((e) => {
    const linked = [...state.tests.values()].filter((t) => t.endpoints.includes(e.key));
    const count = (s) => linked.filter((t) => t.status === s).length;
    return {
      key: e.key, method: e.method, path: e.path, tag: e.tag, summary: e.summary, automated: linked.length > 0,
      passed: count('passed'), failed: count('failed'), defect: count('defect'), skipped: count('skipped'),
      tests: linked.map((t) => ({ id: t.id, title: t.title, status: t.status })),
      note: linked.length ? '' : notes[e.key] ?? 'No test sends a request to this endpoint.',
    };
  });
}

// ---- http -----------------------------------------------------------------------------------------------------------
const json = (res, body, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { const parts = []; req.on('data', (c) => parts.push(c)); req.on('end', () => resolve(Buffer.concat(parts).toString('utf8'))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === 'POST' && url.pathname === '/event') {
    try { handle(JSON.parse(await readBody(req))); json(res, { ok: true }); } catch (err) { json(res, { error: String(err) }, 400); }
  } else if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`data: ${JSON.stringify({ type: 'state', state: snapshot() })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  } else if (url.pathname === '/api/state') {
    json(res, snapshot());
  } else if (url.pathname === '/api/endpoints') {
    json(res, coverage());
  } else if (url.pathname.startsWith('/api/test/')) {
    const t = state.tests.get(decodeURIComponent(url.pathname.slice('/api/test/'.length)));
    t ? json(res, { error: t.error, skipReason: t.skipReason, exchanges: t.exchanges }) : json(res, { error: 'unknown test' }, 404);
  } else if (url.pathname === '/api/runs') {
    const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort().reverse() : [];
    json(res, files);
  } else if (req.method === 'POST' && url.pathname === '/api/load') {
    const file = path.basename(JSON.parse(await readBody(req)).file ?? '');
    if (state.status === 'running') return json(res, { error: 'A run is in progress.' }, 409);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));
    state = { ...saved, tests: new Map(saved.tests.map((t) => [t.id, t])) };
    broadcast({ type: 'state', state: snapshot() });
    json(res, { ok: true });
  } else if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(__dirname, 'dashboard.html')));
  } else {
    res.writeHead(404); res.end('Not found');
  }
}).listen(PORT, () => {
  const address = `http://localhost:${PORT}/`;
  console.log(`Dashboard: ${address}\nNow run the suite in another terminal: npm test`);
  if (!process.env.NO_OPEN && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', address], { detached: true, stdio: 'ignore' }).unref();
}).on('error', (err) => { console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (is the dashboard already running?)` : err); process.exit(1); });
