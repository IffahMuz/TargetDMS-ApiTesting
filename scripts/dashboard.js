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
require('dotenv').config({ path: path.join(root, '.env') });
const { MODULES } = require('./modules');
const { adoConfig, buildBug, findExisting, createInAdo, deleteFromAdo } = require('./bug-report');

const PORT = Number(process.env.DASHBOARD_PORT ?? 9000);
const runsDir = path.join(workDir, 'runs');
const specFile = path.join(workDir, '.cache', 'spec.json');
const notesFile = path.join(root, 'testdata', 'endpoint-notes.json');
const BODY_LIMIT = 8000;

let state = { status: 'idle', startedAt: null, finishedAt: null, label: '', tests: new Map() };
const clients = new Set();

// The page starts empty; earlier runs are opened on request from the "Saved runs" list.

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
    state = { status: 'running', startedAt: new Date().toISOString(), finishedAt: null, label: job && job.exit === null ? job.name : '', tests: new Map() };
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

// ---- bugs for the Azure DevOps board ----------------------------------------------------------------------------------
/** The bug for one failed test of the current run, or undefined. Only known defects and unexpected failures can be reported. */
function bugFor(id) {
  const t = state.tests.get(id);
  if (!t || (t.status !== 'defect' && t.status !== 'failed')) return undefined;
  const all = [...state.tests.values()];
  const eps = endpoints();
  const runFile = state.startedAt ? `run-${state.startedAt.replace(/[:.]/g, '-')}.json` : '';
  return buildBug(t, state, { index: all.indexOf(t) + 1, total: all.length, runFile, endpointInfo: (key) => eps.find((e) => e.key === key) });
}

// ---- names of saved runs ------------------------------------------------------------------------------------------------
const runInfoCache = new Map();
/** The module a saved run belongs to: the name stored with the run, or (older runs) the module whose files cover every test file of the run. */
function moduleOfRun(run) {
  if (run.label) return run.label;
  const files = new Set([...(run.tests ?? [])].map((t) => t.file));
  if (!files.size) return 'Empty run';
  const inRun = (entry) => [...files].some((f) => ('tests/' + f) === entry || ('tests/' + f).startsWith(entry + '/'));
  const covers = (m) => [...files].every((f) => m.files.some((e) => ('tests/' + f) === e || ('tests/' + f).startsWith(e + '/')));
  const fit = MODULES.filter((m) => m.id !== 'all' && m.files.length && covers(m)).sort((a, b) => b.files.filter(inRun).length - a.files.filter(inRun).length || a.files.length - b.files.length)[0];
  return fit ? fit.name : files.size > 8 ? 'Everything' : 'Custom run';
}
function runInfo(file) {
  if (!runInfoCache.has(file)) {
    let name = 'Run';
    try { name = moduleOfRun(JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'))); } catch { /* unreadable */ }
    const m = file.match(/^run-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
    runInfoCache.set(file, { name, startedAt: m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : '' });
  }
  return runInfoCache.get(file);
}

// ---- the tests of a module, listed without running them -------------------------------------------------------------------
const listCache = new Map();
/** The tests a module would run (Playwright's own --list, so nothing is sent to the API), as dashboard rows that have not run yet. */
function listModule(mod) {
  if (listCache.has(mod.id)) return Promise.resolve(listCache.get(mod.id));
  const args = ['test', '--list', ...mod.files, ...(mod.grep ? ['-g', mod.grep] : [])];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), ...args], { cwd: root, env: { ...process.env, ...(mod.env ?? {}), LIST_ONLY: 'true' } });
    let out = '';
    child.stdout.on('data', (b) => { out += b.toString('utf8'); });
    child.on('close', () => {
      const rows = [];
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^\s*(?:\[[^\]]*\]\s*›\s*)?(\S+?):(\d+):\d+ › (.+)$/);
        if (!m) continue;
        const parts = m[3].split(' › ');
        rows.push({
          id: 'preview-' + rows.length, title: parts[parts.length - 1], group: parts.slice(0, -1).join(' › '), file: m[1].replace(/\\/g, '/').replace(/^tests\//, ''), line: Number(m[2]),
          status: 'queued', ms: 0, startedAt: null, error: '', skipReason: '', requests: 0, endpoints: [],
        });
      }
      if (rows.length) listCache.set(mod.id, rows);
      resolve(rows);
    });
    child.on('error', () => resolve([]));
  });
}

// ---- running modules from the runner page ------------------------------------------------------------------------------
let job = null; // { module, child, startedAt, log: string[], exit: number|null }

/** The saved token if it is still good for 10 more minutes, so a run needs no login call at all. */
function savedToken() {
  try {
    const { token } = JSON.parse(fs.readFileSync(path.join(workDir, '.cache', 'token.json'), 'utf8'));
    const exp = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).exp * 1000;
    return exp - Date.now() > 10 * 60 * 1000 ? token : '';
  } catch { return ''; }
}

function startRun(mod) {
  const token = savedToken();
  const env = { ...process.env, ...(mod.env ?? {}), ...(token ? { API_TOKEN: token, REUSE_TOKEN: 'true' } : {}) };
  const args = ['playwright', 'test', ...mod.files, ...(mod.grep ? ['-g', mod.grep] : [])];
  // Playwright's own entry point, started without a shell: a shell would split a test filter such as "Deposit|PAY-DEF" at the |.
  const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), ...args.slice(1)], { cwd: root, env });
  job = { module: mod.id, name: mod.name, child, startedAt: new Date().toISOString(), log: [], exit: null, login: token ? 'reused the saved token (no login call)' : 'logs in once at the start' };
  const keep = (b) => { job.log.push(...b.toString('utf8').split(/\r?\n/).filter(Boolean)); if (job.log.length > 200) job.log.splice(0, job.log.length - 200); };
  child.stdout.on('data', keep); child.stderr.on('data', keep);
  child.on('close', (code) => { job.exit = code ?? 1; endStaleRun(); });
}

const running = () => !!job && job.exit === null;

/** The test process has ended but the page still shows a run in progress (it was stopped or crashed): mark what never ran as skipped and finish the run. */
function endStaleRun() {
  if (state.status !== 'running') return;
  for (const t of state.tests.values()) {
    if (t.status === 'queued' || t.status === 'running') { t.status = 'skipped'; t.skipReason = 'The run was stopped before this test finished.'; }
  }
  state.status = 'finished';
  state.finishedAt = new Date().toISOString();
  if (state.startedAt) save();
  broadcast({ type: 'state', state: snapshot() });
}

/** Back to an empty page: stops a run that is still going and forgets the shown results (saved runs stay). */
function resetRun() {
  if (running()) spawn('taskkill', ['/pid', String(job.child.pid), '/T', '/F'], { stdio: 'ignore' });
  job = null;
  state = { status: 'idle', startedAt: null, finishedAt: null, label: '', tests: new Map() };
  broadcast({ type: 'state', state: snapshot() });
}
const jobStatus = () => job && { module: job.module, name: job.name, startedAt: job.startedAt, running: running(), exit: job.exit, login: job.login, tail: job.log.slice(-8) };

// ---- http -----------------------------------------------------------------------------------------------------------
const json = (res, body, code = 200) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
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
  } else if (url.pathname === '/runner') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(__dirname, 'runner.html')));
  } else if (url.pathname === '/api/modules') {
    json(res, { modules: MODULES.map(({ id, name, description, files, finalizes }) => ({ id, name, description, files: files.length, finalizes: !!finalizes })), job: jobStatus() });
  } else if (req.method === 'POST' && url.pathname === '/api/run') {
    const { module: id } = JSON.parse((await readBody(req)) || '{}');
    const mod = MODULES.find((m) => m.id === id);
    if (!mod) return json(res, { error: 'Unknown module.' }, 404);
    if (running()) return json(res, { error: 'A run is already in progress.', job: jobStatus() }, 409);
    if (state.status === 'running') endStaleRun();      // a leftover "running" page whose test process is gone
    startRun(mod);
    json(res, { ok: true, job: jobStatus() });
  } else if (url.pathname === '/api/module-tests') {
    const mod = MODULES.find((m) => m.id === url.searchParams.get('module'));
    json(res, mod ? await listModule(mod) : []);
  } else if (req.method === 'POST' && url.pathname === '/api/run-fresh') {
    // A page opened for a module starts empty, unless a run is going right now.
    if (!running() && state.status !== 'running' && state.status !== 'idle') {
      state = { status: 'idle', startedAt: null, finishedAt: null, label: '', tests: new Map() };
      broadcast({ type: 'state', state: snapshot() });
    }
    json(res, { ok: true });
  } else if (req.method === 'POST' && url.pathname === '/api/run-reset') {
    resetRun();
    json(res, { ok: true });
  } else if (req.method === 'POST' && url.pathname === '/api/run-stop') {
    if (running()) spawn('taskkill', ['/pid', String(job.child.pid), '/T', '/F'], { stdio: 'ignore' });
    json(res, { ok: true });
  } else if (url.pathname === '/api/state') {
    json(res, snapshot());
  } else if (url.pathname === '/api/endpoints') {
    json(res, coverage());
  } else if (url.pathname.startsWith('/api/test/')) {
    const t = state.tests.get(decodeURIComponent(url.pathname.slice('/api/test/'.length)));
    t ? json(res, { error: t.error, skipReason: t.skipReason, exchanges: t.exchanges }) : json(res, { error: 'unknown test' }, 404);
  } else if (url.pathname === '/api/runs') {
    const files = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((f) => f.endsWith('.json')).sort().reverse() : [];
    json(res, files.map((file) => ({ file, ...runInfo(file) })));
  } else if (req.method === 'POST' && url.pathname === '/api/load') {
    const file = path.basename(JSON.parse(await readBody(req)).file ?? '');
    if (state.status === 'running') return json(res, { error: 'A run is in progress.' }, 409);
    const saved = JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));
    state = { ...saved, tests: new Map(saved.tests.map((t) => [t.id, t])) };
    broadcast({ type: 'state', state: snapshot() });
    json(res, { ok: true });
  } else if (req.method === 'POST' && url.pathname === '/api/bug-preview') {
    // Builds the bug for each failed test (and checks Azure DevOps for one that is already open). Nothing is created here.
    const { ids = [] } = JSON.parse((await readBody(req)) || '{}');
    const cfg = adoConfig();
    const bugs = [];
    for (const id of ids) {
      const bug = bugFor(id);
      if (!bug) continue;
      const existing = cfg.missing.length ? null : await findExisting(cfg, bug);
      bugs.push({ id, title: bug.title, severity: bug.severity, status: bug.status, tags: bug.tags, endpoints: bug.endpoints, reproSteps: bug.reproSteps, systemInfo: bug.systemInfo, existing: existing?.id ? existing : null, checkError: existing?.error ?? '' });
    }
    json(res, { configured: !cfg.missing.length, missing: cfg.missing, orgUrl: cfg.orgUrl, project: cfg.project, type: cfg.type, areaPath: cfg.areaPath, iterationPath: cfg.iterationPath, priority: 2, bugs });
  } else if (req.method === 'POST' && url.pathname === '/api/bug-delete') {
    // Deletes a bug this page created (to the ADO Recycle Bin). The page asks the user to confirm first.
    const { workItemId } = JSON.parse((await readBody(req)) || '{}');
    const cfg = adoConfig();
    if (cfg.missing.length) return json(res, { error: `Set ${cfg.missing.join(', ')} in .env first.` }, 400);
    const out = await deleteFromAdo(cfg, Number(workItemId));
    json(res, out, out.error ? 400 : 200);
  } else if (url.pathname === '/bug') {
    // The page that shows one defect as it will be published and creates it on request.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(__dirname, 'bug.html')));
  } else if (req.method === 'POST' && url.pathname === '/api/bug-create') {
    // Creates the bugs the user confirmed. A test that already has an open bug is skipped unless `force` is set.
    const { items = [], force = false } = JSON.parse((await readBody(req)) || '{}');
    const cfg = adoConfig();
    if (cfg.missing.length) return json(res, { error: `Set ${cfg.missing.join(', ')} in .env first.` }, 400);
    const results = [];
    for (const { id, title } of items) {
      const bug = bugFor(id);
      if (!bug) { results.push({ id, error: 'This test is not in the current run.' }); continue; }
      const existing = force ? null : await findExisting(cfg, bug);
      if (existing?.error) { results.push({ id, error: existing.error }); continue; }
      if (existing) { results.push({ id, skipped: true, ...existing }); continue; }
      results.push({ id, ...(await createInAdo(cfg, bug, (title || '').trim().slice(0, 250))) });
    }
    json(res, { results });
  } else if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(__dirname, 'dashboard.html')));
  } else {
    res.writeHead(404); res.end('Not found');
  }
}).listen(PORT, () => {
  const address = `http://localhost:${PORT}/`;
  const open = address + 'runner';
  console.log(`Dashboard: ${address}\nNow run the suite in another terminal: npm test`);
  if (!process.env.NO_OPEN && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', open], { detached: true, stdio: 'ignore' }).unref();
}).on('error', (err) => { console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (is the dashboard already running?)` : err); process.exit(1); });
