/**
 * Turns a failed test of the dashboard (a known defect or an unexpected failure) into an Azure DevOps Bug and creates it.
 * The bug carries: a generated title, what was expected and what happened, numbered steps to reproduce, every request with its payload and response,
 * the environment and the session (run) details, and the endpoints involved. Tokens and passwords are removed from everything that is sent.
 *
 * Configuration (read from .env on every call, so no restart is needed):
 *   ADO_ORG_URL         https://dev.azure.com/<organization>
 *   ADO_PROJECT         the project the bugs go to
 *   ADO_PAT             personal access token with the Work Items (Read & write) scope; stays on this machine
 *   ADO_WORK_ITEM_TYPE  optional, default Bug
 *   ADO_AREA_PATH / ADO_ITERATION_PATH / ADO_ASSIGNED_TO   optional
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const dotenv = require('dotenv');
const { root } = require('./lib');

const MAX_EXCHANGES = 12;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The .env file is read again on every call. */
function env() {
  const file = path.join(root, '.env');
  return { ...process.env, ...(fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : {}) };
}

function adoConfig() {
  const e = env();
  const cfg = {
    orgUrl: (e.ADO_ORG_URL ?? '').replace(/\/+$/, ''), project: e.ADO_PROJECT ?? '', pat: e.ADO_PAT ?? '', type: e.ADO_WORK_ITEM_TYPE || 'Bug',
    areaPath: e.ADO_AREA_PATH ?? '', iterationPath: e.ADO_ITERATION_PATH ?? '', assignedTo: e.ADO_ASSIGNED_TO ?? '',
  };
  const missing = [['ADO_ORG_URL', cfg.orgUrl], ['ADO_PROJECT', cfg.project], ['ADO_PAT', cfg.pat]].filter(([, v]) => !v).map(([k]) => k);
  return { ...cfg, missing };
}

// ---- cleaning what is sent ------------------------------------------------------------------------------------------
/** Removes secrets from a payload or response before it leaves this machine. */
function redact(text) {
  return String(text ?? '')
    .replace(/("(?:access_?token|refresh_?token|id_?token|token|password|secret|api_?key|authorization|client_?secret)"\s*:\s*)"[^"]*"/gi, '$1"<redacted>"')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{20,}/g, 'Bearer <redacted>')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '<redacted jwt>');
}

const stripApi = (p) => p.replace(/^\/api\/v\d+/i, '');
const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const pathOf = (url) => stripApi(String(url).replace(/^https?:\/\/[^/]+/i, '').split('?')[0]).replace(GUID, '{guid}');
/** "POST /Inspection/Session/{dealerGuid}": the Swagger template when the request was matched to one, otherwise the path with ids masked. */
const labelOf = (x) => (x.endpoint ? x.endpoint.replace(/^(\w+) \/api\/v\d+/i, '$1 ') : `${x.method} ${pathOf(x.url)}`);

/** "NEG-07 reading an order ... is a 404, not a 502 [known defect]" -> "reading an order ... is a 404, not a 502". */
function cleanTitle(title) {
  return title.replace(/\s*\[known defect\]\s*/gi, ' ').replace(/^\s*\d+\.\s+/, '').replace(/^\s*[A-Z]+(?:-[A-Z]+)*-\d+\s+/, '').replace(/\s+/g, ' ').trim();
}

/**
 * The request the failure is about. Tests clean up after themselves (a DELETE at the end), so the last request is usually not the one:
 * take the first request with the status the error talks about, otherwise the first one that failed, otherwise the first one that is not a DELETE.
 */
function culprit(t) {
  const seen = String(t.error ?? '').replace(/\u001b\[[0-9;]*m/g, '').match(/\bHTTP (\d{3})\b|Received:\s*(\d{3})\b/);
  const status = Number(seen?.[1] ?? seen?.[2] ?? 0);
  return (status && t.exchanges.find((x) => x.status === status)) || t.exchanges.find((x) => x.error || x.status >= 400) || t.exchanges.find((x) => x.method !== 'DELETE') || t.exchanges[0];
}

const firstLine = (error) => String(error ?? '').replace(/\u001b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean)[0]?.replace(/^Error:\s*/, '') ?? '';

function expectedActual(error) {
  const clean = String(error ?? '').replace(/\u001b\[[0-9;]*m/g, '');
  const expected = clean.match(/^\s*Expected(?: string| pattern)?:\s*(.+)$/m)?.[1]?.trim();
  const received = clean.match(/^\s*Received(?: string)?:\s*(.+)$/m)?.[1]?.trim();
  return { expected, received };
}

function runCommand(t) {
  const file = t.file.replace(/^tests[\\/]/, 'tests/').replace(/\\/g, '/');
  const serialStep = /^\s*\d+\.\s/.test(t.title);
  // a step of a serial flow needs the steps before it: run the whole flow
  const grep = (serialStep ? t.group : t.title).replace(/["\\]/g, '.').replace(/[()[\]{}*+?^$|]/g, '.');
  return `npx playwright test ${file}${grep ? ` -g "${grep}"` : ''}`;
}

const tagHash = (t) => crypto.createHash('sha1').update(`${t.file}|${t.title}`).digest('hex').slice(0, 10);

// ---- the bug --------------------------------------------------------------------------------------------------------
function environmentInfo(run) {
  let commit = '';
  try { commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* not a git checkout */ }
  let playwright = '';
  try { playwright = require(path.join(root, 'node_modules', '@playwright', 'test', 'package.json')).version; } catch { /* not installed here */ }
  const e = env();
  return [
    ['API base URL', e.API_BASE_URL], ['Dealer (location) id', e.DEALER_ID], ['Dealer GUID', e.DEALER_GUID], ['DMS location id', e.LOCATION_DMS_ID],
    ['Test user', e.API_USERNAME], ['Test customer id', e.TEST_CUSTOMER_ID],
    ['Suite commit', commit], ['Playwright', playwright], ['Node.js', process.version], ['Machine OS', `${os.type()} ${os.release()} (${os.arch()})`], ['Machine name', os.hostname()],
    ['Time zone', Intl.DateTimeFormat().resolvedOptions().timeZone],
  ].filter(([, v]) => v);
}

const table = (rows) => `<table border="1" cellpadding="4" cellspacing="0">${rows.map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table>`;
const pre = (text) => `<pre>${esc(text)}</pre>`;

function sessionInfo(t, run, index, total, runFile) {
  const took = run.finishedAt && run.startedAt ? `${Math.round((new Date(run.finishedAt) - new Date(run.startedAt)) / 1000)} s` : 'still running';
  return [
    ['Run started', run.startedAt], ['Run finished', run.finishedAt || '(not finished)'], ['Run status', run.status], ['Run took', took], ['Saved run file', runFile],
    ['Test position in the run', `${index} of ${total}`], ['Test started', t.startedAt], ['Test duration', `${t.ms} ms`], ['Test file', `${t.file}:${t.line}`], ['Test group', t.group],
  ].filter(([, v]) => v);
}

/** Builds the bug (title, fields and HTML sections) for one dashboard test. `endpointInfo(key)` returns the Swagger summary and tag of an endpoint. */
function buildBug(t, run, extra = {}) {
  const { index = 0, total = 0, runFile = '', endpointInfo = () => undefined } = extra;
  const isDefect = t.status === 'defect';
  const bad = culprit(t);
  const label = bad ? labelOf(bad) : (t.group || t.file);
  const clean = cleanTitle(t.title);
  const title = `[Automated API ${isDefect ? 'Defect' : 'Failure'}] ${label} - ${clean}`.slice(0, 250);
  const { expected, received } = expectedActual(t.error);
  const hasServerError = t.exchanges.some((x) => x.status >= 500);
  const severity = hasServerError || !isDefect ? '2 - High' : '3 - Medium';
  const endpoints = [...new Set(t.endpoints.length ? t.endpoints : t.exchanges.map(labelOf))];
  const tag = `AutoTest-${tagHash(t)}`;

  const steps = [];
  steps.push(`Open the test environment ${esc(env().API_BASE_URL ?? '')} with an API client (Postman, curl). Log in once with POST /api/v1/Auth/Login as the test user and use the returned access token as <code>Authorization: Bearer &lt;token&gt;</code> on every request below (the token is not included in this bug).`);
  if (/^\s*\d+\.\s/.test(t.title)) steps.push(`This is ${esc(t.title.match(/^\s*\d+/)[0].trim())} of a flow named "${esc(t.group)}": the earlier steps of that flow create the data the request below uses, so repeat them first (or run the flow, see "Run it again").`);
  const shown = t.exchanges.slice(0, MAX_EXCHANGES);
  shown.forEach((x, i) => {
    const body = x.request === undefined ? '' : ` with this body:${pre(redact(x.request))}`;
    const cleanup = x.method === 'DELETE' && bad && x !== bad && t.exchanges.indexOf(x) > t.exchanges.indexOf(bad) ? ' (clean-up the test does afterwards; not needed to reproduce)' : '';
    steps.push(`Send <b>${esc(x.method)} ${esc(x.url)}</b>${esc(cleanup)}${body}Observe: ${x.error ? `no response (${esc(x.error)})` : `<b>HTTP ${x.status}</b> in ${x.ms} ms`}`);
  });
  if (t.exchanges.length > shown.length) steps.push(`(${t.exchanges.length - shown.length} further requests of this test are left out; see the run in the dashboard.)`);

  const exchanges = shown.map((x, i) => `<h4>${i + 1}. ${esc(x.method)} ${esc(x.url)} - ${x.error ? 'ERROR' : 'HTTP ' + x.status} (${x.ms} ms)</h4>` +
    `<b>Request payload</b>${pre(x.request === undefined ? '(no body)' : redact(x.request))}<b>Response</b>${pre(x.error ? x.error : x.response === undefined || x.response === '' ? '(empty body)' : redact(x.response))}`).join('');

  const endpointRows = endpoints.map((key) => {
    const info = endpointInfo(key);
    return `<li><b>${esc(key)}</b>${info ? ` - ${esc(info.tag)}${info.summary ? ': ' + esc(info.summary) : ''}` : ''}</li>`;
  }).join('');

  const reproSteps =
    `<h3>Summary</h3><p>${esc(clean)}</p>` +
    `<p>${isDefect ? 'The test asserts the correct behaviour and fails until the server is fixed (a known server defect).' : 'The test failed unexpectedly: it is not a known defect, so it needs to be looked at.'}</p>` +
    `<h3>Expected</h3><p>${esc(clean)}${expected ? `<br>Expected value: <b>${esc(expected)}</b>` : ''}</p>` +
    `<h3>Actual</h3><p>${esc(firstLine(t.error) || 'The test failed.')}${received ? `<br>Received: <b>${esc(received)}</b>` : ''}</p>` +
    `<h3>Steps to reproduce</h3><ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>` +
    `<h3>Endpoints involved</h3><ul>${endpointRows || '<li>(none recorded)</li>'}</ul>` +
    `<h3>Requests, payloads and responses</h3>${exchanges || '<p>No requests were recorded for this test.</p>'}` +
    `<h3>Assertion error</h3>${pre(redact(String(t.error ?? '').replace(/\u001b\[[0-9;]*m/g, '')) || '(none)')}` +
    `<h3>Run it again</h3>${pre(runCommand(t))}`;

  const systemInfo = `<h3>Environment</h3>${table(environmentInfo(run))}<h3>Session</h3>${table(sessionInfo(t, run, index, total, runFile))}`;

  return {
    id: t.id, title, severity, status: isDefect ? 'defect' : 'failed', tag, endpoints, reproSteps, systemInfo,
    tags: ['api-automation', isDefect ? 'known-defect' : 'test-failure', tag],
  };
}

// ---- Azure DevOps ---------------------------------------------------------------------------------------------------
async function ado(cfg, method, urlPath, body, contentType = 'application/json') {
  const res = await fetch(`${cfg.orgUrl}/${encodeURIComponent(cfg.project)}/_apis/${urlPath}`, {
    method, headers: { Authorization: 'Basic ' + Buffer.from(':' + cfg.pat).toString('base64'), 'Content-Type': contentType, Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { /* an HTML sign-in page means the PAT or the URL is wrong */ }
  return { status: res.status, json, text };
}

const workItemUrl = (cfg, id) => `${cfg.orgUrl}/${encodeURIComponent(cfg.project)}/_workitems/edit/${id}`;

/** An open work item that carries this bug's tag (the same test already reported), or null. */
async function findExisting(cfg, bug) {
  const wiql = { query: `SELECT [System.Id], [System.State] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Tags] CONTAINS '${bug.tag}' AND [System.State] NOT IN ('Closed','Done','Removed','Resolved') ORDER BY [System.Id] DESC` };
  const res = await ado(cfg, 'POST', 'wit/wiql?api-version=7.1', wiql);
  if (res.status !== 200) return { error: `Azure DevOps answered HTTP ${res.status} to the duplicate check${res.json?.message ? ': ' + res.json.message : ''}` };
  const hit = res.json?.workItems?.[0];
  return hit ? { id: hit.id, url: workItemUrl(cfg, hit.id) } : null;
}

async function createInAdo(cfg, bug, title) {
  const patch = (withSeverity) => [
    { op: 'add', path: '/fields/System.Title', value: title || bug.title },
    { op: 'add', path: '/fields/Microsoft.VSTS.TCM.ReproSteps', value: bug.reproSteps },
    { op: 'add', path: '/fields/Microsoft.VSTS.TCM.SystemInfo', value: bug.systemInfo },
    { op: 'add', path: '/fields/System.Tags', value: bug.tags.join('; ') },
    ...(withSeverity ? [{ op: 'add', path: '/fields/Microsoft.VSTS.Common.Severity', value: bug.severity }, { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: 2 }] : []),
    ...(cfg.areaPath ? [{ op: 'add', path: '/fields/System.AreaPath', value: cfg.areaPath }] : []),
    ...(cfg.iterationPath ? [{ op: 'add', path: '/fields/System.IterationPath', value: cfg.iterationPath }] : []),
    ...(cfg.assignedTo ? [{ op: 'add', path: '/fields/System.AssignedTo', value: cfg.assignedTo }] : []),
  ];
  const url = `wit/workitems/$${encodeURIComponent(cfg.type)}?api-version=7.1`;
  let res = await ado(cfg, 'POST', url, patch(true), 'application/json-patch+json');
  // some process templates have no Severity/Priority on the type: try again without them
  if (res.status === 400 && /Severity|Priority/i.test(res.text)) res = await ado(cfg, 'POST', url, patch(false), 'application/json-patch+json');
  if (res.status !== 200 && res.status !== 201) return { error: `Azure DevOps answered HTTP ${res.status}${res.json?.message ? ': ' + res.json.message : res.status === 203 || res.status === 401 ? ' (the ADO_PAT or ADO_ORG_URL is wrong)' : ''}` };
  return { id: res.json.id, url: workItemUrl(cfg, res.json.id) };
}

/**
 * Deletes a work item this tool created. It goes to the Azure DevOps Recycle Bin (it can be restored from there); it is never destroyed permanently.
 * Only a Bug carrying an AutoTest- tag is deleted, so the button cannot be used on someone else's work item.
 */
async function deleteFromAdo(cfg, id) {
  if (!Number.isInteger(id) || id <= 0) return { error: 'No work item id was given.' };
  const found = await ado(cfg, 'GET', `wit/workitems/${id}?fields=System.Tags,System.WorkItemType&api-version=7.1`);
  if (found.status === 404) return { error: `Work item #${id} does not exist (it may already be deleted).` };
  if (found.status !== 200) return { error: `Azure DevOps answered HTTP ${found.status} when looking up #${id}${found.json?.message ? ': ' + found.json.message : ''}` };
  const tags = String(found.json?.fields?.['System.Tags'] ?? '');
  if (found.json?.fields?.['System.WorkItemType'] !== cfg.type || !/(^|;\s*)AutoTest-[0-9a-f]+/.test(tags)) return { error: `Work item #${id} is not a ${cfg.type} created by this tool (it has no AutoTest tag), so it is not deleted here.` };
  const res = await ado(cfg, 'DELETE', `wit/workitems/${id}?api-version=7.1`);
  if (res.status !== 200) return { error: `Azure DevOps answered HTTP ${res.status} when deleting #${id}${res.json?.message ? ': ' + res.json.message : ''}` };
  return { id, recycled: true };
}

module.exports = { adoConfig, buildBug, findExisting, createInAdo, deleteFromAdo, redact, cleanTitle };
