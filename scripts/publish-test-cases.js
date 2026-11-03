/**
 * Publishes every Playwright test as a Test Case in the Azure DevOps test plan and adds it to the suite of its runner module.
 *   node scripts/publish-test-cases.js            preview only: writes the preview file, creates nothing
 *   node scripts/publish-test-cases.js --go       creates the cases that are not in the map file yet
 *   node scripts/publish-test-cases.js --go --limit 3
 * The map file (testdata/ado-test-case-map.json) remembers which test is which work item, so a second run only adds new tests.
 * Settings come from .env (ADO_ORG_URL, ADO_PROJECT, ADO_AREA_PATH, ADO_PAT); the token is never printed.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { MODULES } = require('./modules');

const root = path.join(__dirname, '..');
const MAP_FILE = path.join(root, 'testdata', 'ado-test-case-map.json');
const PREVIEW_FILE = path.join(root, 'testdata', 'ado-test-case-preview.json');
const PLAN_ID = Number(process.env.ADO_PLAN_ID || 185673);
const org = (process.env.ADO_ORG_URL || '').replace(/\/$/, '');
const project = process.env.ADO_PROJECT;
const area = process.env.ADO_AREA_PATH || project;
const auth = 'Basic ' + Buffer.from(':' + (process.env.ADO_PAT || '')).toString('base64');
const args = process.argv.slice(2);
const go = args.includes('--go');
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;

// Suite id of each runner module (suite names equal the module names on the runner page).
const SUITES = {
  get: 185675, login: 185676, customers: 185677, orders: 185678, inspections: 185679, locations: 185680, deposits: 185681,
  'checkout-payments': 185682, warranty: 185683, 'warranty-checkout': 185684, inventory: 185685, purchase: 185686,
  receipts: 185687, 'dealer-user': 185688, 'other-endpoints': 185689, defects: 185690,
};

/** Generated checks live in two shared files; their describe name says which module they belong to. */
const GENERATED = { 'POST Customer': 'customers', 'POST Dealer': 'dealer-user', 'POST User': 'dealer-user', 'POST Inventory': 'inventory', 'POST InventoryWrite': 'inventory', 'POST Notification': 'receipts', 'POST Transaction': 'receipts' };

function listTests() {
  const r = spawnSync('npx', ['playwright', 'test', '--list'], { cwd: root, shell: true, encoding: 'utf8', env: { ...process.env, LIST_ONLY: 'true' }, maxBuffer: 1 << 26 });
  const tests = [];
  for (const raw of r.stdout.split(/\r?\n/)) {
    const m = raw.match(/^\s{2}(\S.*?):(\d+):\d+ › (.*)$/);
    if (!m) continue;
    const parts = m[3].split(' › ');
    tests.push({ file: m[1].replace(/\\/g, '/'), line: Number(m[2]), groups: parts.slice(0, -1), title: parts[parts.length - 1] });
  }
  return tests;
}

/** Modules a test belongs to: by file, then by the module's title filter; shared generated files by describe name. */
function modulesOf(t) {
  const full = 'tests/' + t.file;
  if (t.file === 'post/run-post-calls.ts') return [GENERATED[t.groups[0]]].filter(Boolean);
  if (t.file === 'get/run-get-calls.ts' || t.file === 'api.spec.ts') return ['get'];
  if (t.file === 'flows/order-flow.ts') return ['orders'];
  const out = [];
  for (const mod of MODULES) {
    if (mod.id === 'all' || !SUITES[mod.id]) continue;
    if (!mod.files.some((f) => full === f || full.startsWith(f + '/'))) continue;
    // The warranty checkout module names the whole folder, but only the three checkout files are its own.
    if (mod.id === 'warranty-checkout' && !/\/checkout-(customer|warrantor)/.test(full)) continue;
    if (mod.grep && !new RegExp(mod.grep).test(t.groups.concat(t.title).join(' '))) continue;
    out.push(mod.id);
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const stepsXml = (steps) => `<steps id="0" last="${steps.length}">${steps.map(([a, e], i) =>
  `<step id="${i + 2}" type="ValidateStep"><parameterizedString isformatted="true">${esc(`<DIV><P>${esc(a)}</P></DIV>`)}</parameterizedString><parameterizedString isformatted="true">${esc(`<DIV><P>${esc(e)}</P></DIV>`)}</parameterizedString><description/></step>`).join('')}</steps>`;

/** Steps come from the test title, which states the correct behavior the test checks. */
function buildCase(t, mods) {
  const clean = t.title.replace(/ \[known defect\]$/, '').replace(/^\d+[a-z]?\.\s*/, '');
  const known = / \[known defect\]$/.test(t.title);
  const call = clean.match(/ - ((?:GET|POST|PUT|DELETE|PATCH) \S+)$/);
  const what = call ? clean.slice(0, call.index) : clean;
  const steps = [
    ['Log in once with the test account and keep the bearer token (the suite makes one login per run).', 'A valid token is returned.'],
    [call ? `Send ${call[1]} for this case: ${what}.` : `Run this check against the TargetDMS API: ${clean}.`, known ? `${what}. This is a known server defect: the API still behaves wrongly, so the test fails until it is fixed.` : `${what}.`],
  ];
  const group = t.groups.join(' / ');
  const description = `<div>Automated Playwright API test.<br>Spec: tests/${esc(t.file)}:${t.line}<br>Group: ${esc(group)}<br>Test: ${esc(t.title)}<br>Run it from the runner page (module: ${esc(mods.join(', '))}).</div>`;
  const tags = ['api-automation', ...mods, ...(known ? ['known-defect'] : [])].join('; ');
  return { title: (call ? clean : `${clean}`).slice(0, 250), steps, description, tags, priority: known ? 1 : 2 };
}

const keyOf = (t) => `${t.file}|${t.groups.join(' > ')}|${t.title}`;

async function api(method, url, body, contentType = 'application/json') {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { method, headers: { Authorization: auth, 'Content-Type': contentType, Accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * attempt)); continue; }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${url.split('?')[0]} -> ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }
  throw new Error(`${method} ${url.split('?')[0]} kept failing`);
}

async function createCase(t, c, mods) {
  const ops = [
    ['System.Title', c.title], ['System.AreaPath', area], ['Microsoft.VSTS.TCM.Steps', stepsXml(c.steps)], ['System.Description', c.description],
    ['Microsoft.VSTS.Common.Priority', c.priority], ['System.Tags', c.tags], ['Microsoft.VSTS.TCM.AutomatedTestName', `tests/${t.file} › ${t.groups.concat(t.title).join(' › ')}`.slice(0, 250)],
    ['Microsoft.VSTS.TCM.AutomatedTestStorage', `tests/${t.file}`], ['Microsoft.VSTS.TCM.AutomatedTestType', 'Playwright'],
  ].map(([p, v]) => ({ op: 'add', path: '/fields/' + p, value: v }));
  const wi = await api('POST', `${org}/${encodeURIComponent(project)}/_apis/wit/workitems/$Test%20Case?api-version=7.1`, ops, 'application/json-patch+json');
  return wi.id;
}

async function main() {
  const tests = listTests();
  const map = fs.existsSync(MAP_FILE) ? JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) : {};
  const rows = tests.map((t) => { const mods = modulesOf(t); return { t, mods, c: buildCase(t, mods), key: keyOf(t) }; });
  const unmapped = rows.filter((r) => !r.mods.length);
  const perSuite = {};
  rows.forEach((r) => r.mods.forEach((m) => { perSuite[m] = (perSuite[m] || 0) + 1; }));
  fs.mkdirSync(path.dirname(PREVIEW_FILE), { recursive: true });
  fs.writeFileSync(PREVIEW_FILE, JSON.stringify(rows.map((r) => ({ key: r.key, modules: r.mods, title: r.c.title, priority: r.c.priority, tags: r.c.tags, steps: r.c.steps, spec: `tests/${r.t.file}:${r.t.line}` })), null, 1));
  console.log(`${tests.length} tests listed, ${unmapped.length} without a module, ${rows.filter((r) => map[r.key]).length} already in ADO`);
  console.log(perSuite);
  if (unmapped.length) console.log('unmapped:', unmapped.slice(0, 5).map((r) => r.key));
  if (!go) return;
  if (!org || !project || !process.env.ADO_PAT) throw new Error('ADO_ORG_URL, ADO_PROJECT and ADO_PAT must be set in .env');

  let created = 0;
  for (const r of rows) {
    if (!r.mods.length || (map[r.key] && map[r.key].id)) continue;
    if (created >= limit) break;
    const id = await createCase(r.t, r.c, r.mods);
    map[r.key] = { id, title: r.c.title, suites: [] };
    created++;
    if (created % 10 === 0) { fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1)); process.stdout.write(`created ${created}\r`); }
  }
  fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1));
  console.log(`created ${created} test cases`);

  // Add each case to the suites of its modules, one call per suite. Needs a token with Test Management write;
  // without --suites the cases are only created and the suites are filled through the Azure DevOps connector.
  if (!args.includes('--suites')) return;
  const bySuite = {};
  for (const r of rows) {
    const e = map[r.key];
    if (!e || !e.id) continue;
    for (const m of r.mods) if (!e.suites.includes(m)) (bySuite[m] = bySuite[m] || []).push(r.key);
  }
  for (const [mod, keys] of Object.entries(bySuite)) {
    for (let i = 0; i < keys.length; i += 100) {
      const chunk = keys.slice(i, i + 100);
      await api('POST', `${org}/${encodeURIComponent(project)}/_apis/testplan/Plans/${PLAN_ID}/Suites/${SUITES[mod]}/TestCase?api-version=7.1`, chunk.map((k) => ({ workItem: { id: map[k].id } })));
      chunk.forEach((k) => map[k].suites.push(mod));
      fs.writeFileSync(MAP_FILE, JSON.stringify(map, null, 1));
    }
    console.log(`suite ${mod}: ${keys.length} added`);
  }
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
