/**
 * The hamburger menu at the top left of every page (runner, module pages, live dashboard, Report Analysis, bug page).
 * It opens a side panel with the pages, every module (the open one highlighted) and the saved runs of the last week.
 * Loaded with <script src="/nav.js" defer>; it builds everything itself and uses the page's own colour tokens.
 */
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const here = new URL(location.href);
  const curModule = here.pathname === '/' ? here.searchParams.get('module') : null;

  const css = `
  .nv-burger { position:fixed; top:16px; left:16px; z-index:50; width:40px; height:40px; border-radius:10px; border:1px solid var(--line); background:var(--card); color:var(--ink);
    display:flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,.12); }
  .nv-burger:hover { background:var(--infobg); }
  .nv-shade { position:fixed; inset:0; background:rgba(8,12,18,.45); z-index:60; opacity:0; pointer-events:none; transition:opacity .18s; }
  .nv-panel { position:fixed; top:0; left:0; bottom:0; width:320px; max-width:86vw; z-index:61; background:var(--card); color:var(--ink); border-right:1px solid var(--line);
    box-shadow:6px 0 24px rgba(0,0,0,.25); transform:translateX(-102%); transition:transform .2s ease; display:flex; flex-direction:column; }
  .nv-open .nv-shade { opacity:1; pointer-events:auto; } .nv-open .nv-panel { transform:none; }
  .nv-head { display:flex; align-items:center; justify-content:space-between; padding:16px 16px 10px; }
  .nv-head b { font-size:16px; }
  .nv-body { overflow-y:auto; padding:0 10px 20px; }
  .nv-panel:focus { outline:none; }
  .nv-body { flex:1; }
  /* Light / dark switch at the bottom of the panel. */
  .nv-foot { border-top:1px solid var(--line); padding:12px 10px 16px; }
  /* Dark | Light pill: the chosen one is filled with the app's button blue, the other is plain text. */
  .nv-seg { display:inline-flex; gap:4px; padding:4px; border-radius:12px; border:1px solid var(--line); background:var(--bg); }
  .nv-seg button { border:1px solid transparent; background:none; color:var(--mute); font:inherit; font-weight:600; padding:6px 16px; border-radius:8px; cursor:pointer; }
  .nv-seg button:hover { color:var(--ink); }
  .nv-seg button[aria-checked="true"] { background:var(--btn); border-color:var(--btnb); color:#fff; }
  /* The folding headings look like the page links above them (same size, weight and colour), with an arrow and a count. */
  .nv-fold > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; color:var(--ink); user-select:none; }
  .nv-fold > summary::-webkit-details-marker { display:none; }
  .nv-fold > summary::after { content:""; width:6px; height:6px; margin-left:4px; border-right:2px solid var(--mute); border-bottom:2px solid var(--mute); transform:rotate(-45deg); transition:transform .15s; }
  .nv-fold[open] > summary::after { transform:rotate(45deg); }
  .nv-fold > summary:hover { background:var(--infobg); }
  .nv-count { margin-left:auto; color:var(--mute); font-size:12px; }
  /* Items inside Modules / Saved runs: indented under their heading, in a softer colour than the main items. */
  .nv-fold > div { margin:2px 0 6px 18px; padding-left:8px; }
  .nv-fold > div .nv-link { color:#3a4655; }
  .nv-fold > div .nv-link.on { color:var(--info); }
  @media (prefers-color-scheme: dark) { .nv-fold > div .nv-link { color:#b3bcc8; } .nv-fold > div .nv-link.on { color:var(--info); } }

  /* Scrollbars in the project's colours, for light and dark mode (every page that loads this menu). */
  * { scrollbar-width:thin; scrollbar-color:color-mix(in srgb, var(--mute) 45%, transparent) transparent; }
  ::-webkit-scrollbar { width:10px; height:10px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:color-mix(in srgb, var(--mute) 45%, transparent); border-radius:999px; border:2px solid transparent; background-clip:padding-box; }
  ::-webkit-scrollbar-thumb:hover { background:var(--mute); border:2px solid transparent; background-clip:padding-box; }
  ::-webkit-scrollbar-corner { background:transparent; }
  .nv-link { display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; text-align:left; padding:8px 10px; border-radius:8px; color:var(--ink);
    text-decoration:none; background:none; border:0; font:inherit; cursor:pointer; }
  .nv-link:hover { background:var(--infobg); }
  .nv-link.on { background:var(--infobg); color:var(--info); font-weight:700; }
  .nv-link small { color:var(--mute); font-size:11px; white-space:nowrap; }
  .nv-run { flex-direction:column; align-items:flex-start; gap:2px; }
  .nv-run span { font-weight:500; } .nv-run small { white-space:normal; }
  .nv-empty, .nv-msg { color:var(--mute); font-size:12px; padding:4px 10px; }
  .nv-msg.bad { color:var(--bad); }
  /* On narrower windows the page reaches the left edge: make room so the button never covers the title. */
  @media (max-width:1460px) { .wrap { padding-left:72px !important; } }
  @media (max-width:760px) { .nv-burger { top:10px; left:10px; } .wrap { padding-left:62px !important; } }`;

  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
  const root = document.createElement('div');
  root.innerHTML = `
    <button class="nv-burger" type="button" aria-label="Open the menu" aria-expanded="false" aria-controls="nv-panel">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
    <div class="nv-shade"></div>
    <nav class="nv-panel" id="nv-panel" aria-label="Menu" aria-hidden="true" tabindex="-1">
      <div class="nv-head"><b>Integration Tests</b></div>
      <div class="nv-body">
        <a class="nv-link${here.pathname === '/runner' ? ' on' : ''}" href="/runner" title="Integration Tests Live Runner: every module in boxes">Home</a>
        <a class="nv-link${here.pathname === '/report' ? ' on' : ''}" href="/report">Report Analysis</a>
        <a class="nv-link${curModule === 'all' && here.searchParams.get('tab') === 'coverage' ? ' on' : ''}" href="/?module=all&amp;tab=coverage" title="Endpoint coverage of the whole suite, with a row per module">Coverage</a>
        <details class="nv-fold"><summary>Modules <span class="nv-count" id="nv-modcount"></span></summary><div id="nv-mods"><div class="nv-empty">Loading...</div></div></details>
        <details class="nv-fold"><summary>Saved runs (last week) <span class="nv-count" id="nv-runcount"></span></summary><div id="nv-runs"><div class="nv-empty">Loading...</div></div></details>
        <div class="nv-msg" id="nv-msg" hidden></div>
      </div>
      <div class="nv-foot">
        <div class="nv-seg" role="radiogroup" aria-label="Colour mode">
          <button type="button" role="radio" data-mode="dark" aria-checked="false">Dark</button>
          <button type="button" role="radio" data-mode="light" aria-checked="false">Light</button>
        </div>
      </div>
    </nav>`;
  document.body.appendChild(root);

  // ---- light / dark mode -------------------------------------------------------------------------------------------
  // Every page styles dark mode with @media (prefers-color-scheme: dark). The toggle switches those rules on ("all") or off
  // ("not all") on this page, and the choice is kept in this browser so every page opens in it. Until it is used, the
  // pages follow Windows' own light/dark setting.
  const DARK_QUERY = /prefers-color-scheme:\s*dark/;
  const original = new WeakMap();
  const systemDark = () => matchMedia('(prefers-color-scheme: dark)').matches;
  let memo = null;   // used when the browser blocks storage: the switch still works on this page
  const saved = () => { try { return localStorage.getItem('theme') ?? memo; } catch { return memo; } };
  const save = (v) => { memo = v; try { localStorage.setItem('theme', v); } catch { /* storage blocked */ } };
  const isDark = () => (saved() ? saved() === 'dark' : systemDark());
  function applyTheme() {
    const choice = saved();
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }   // cross-origin sheets (Google Fonts) cannot be read
      for (const rule of rules) {
        if (!(rule instanceof CSSMediaRule)) continue;
        if (!original.has(rule)) { if (!DARK_QUERY.test(rule.media.mediaText)) continue; original.set(rule, rule.media.mediaText); }
        rule.media.mediaText = !choice ? original.get(rule) : original.get(rule).replace(/\(\s*prefers-color-scheme:\s*dark\s*\)/, choice === 'dark' ? 'all' : 'not all');
      }
    }
    document.documentElement.style.colorScheme = isDark() ? 'dark' : 'light';   // form controls and scrollbars follow too
    root.querySelectorAll('.nv-seg button').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.mode === 'dark') === isDark())));
  }
  root.querySelector('.nv-seg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]'); if (!b) return;
    save(b.dataset.mode);
    applyTheme();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  applyTheme();

  // Modules and Saved runs start folded; clicking a heading opens it. Clicking anywhere outside the panel (or Esc) closes the menu.
  const burger = root.querySelector('.nv-burger'), panel = root.querySelector('.nv-panel');
  let loaded = false;
  const setOpen = (open) => {
    root.classList.toggle('nv-open', open);
    burger.setAttribute('aria-expanded', String(open)); panel.setAttribute('aria-hidden', String(!open));
    if (open) { if (!loaded) { loaded = true; fill(); } panel.focus(); } else burger.focus();
  };
  burger.addEventListener('click', () => setOpen(true));
  root.querySelector('.nv-shade').addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && root.classList.contains('nv-open')) setOpen(false); });

  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

  async function fill() {
    try {
      const { modules } = await (await fetch('/api/modules', { cache: 'no-store' })).json();
      root.querySelector('#nv-modcount').textContent = modules.length;
      root.querySelector('#nv-mods').innerHTML = modules.map((m) =>
        `<a class="nv-link${m.id === curModule ? ' on' : ''}" href="/?module=${encodeURIComponent(m.id)}" title="${esc(m.description)}">${esc(m.name)}${m.finalizes ? '<small>checks out</small>' : ''}</a>`).join('');
    } catch { root.querySelector('#nv-mods').innerHTML = '<div class="nv-empty">Could not load the modules.</div>'; }
    try {
      const { runs } = await (await fetch('/api/report-runs', { cache: 'no-store' })).json();
      root.querySelector('#nv-runcount').textContent = runs.length;
      root.querySelector('#nv-runs').innerHTML = runs.length ? runs.map((r) =>
        `<button class="nv-link nv-run" type="button" data-file="${esc(r.file)}"><span>${esc(r.name)}</span><small>${esc(when(r.startedAt))} - ${r.passed} passed, ${r.failed} failed, ${r.defect} defects, ${r.skipped} skipped</small></button>`).join('')
        : '<div class="nv-empty">No saved runs in the last week.</div>';
    } catch { root.querySelector('#nv-runs').innerHTML = '<div class="nv-empty">Could not load the saved runs.</div>'; }
  }

  // A saved run opens on the live dashboard (the same as choosing it in the Saved runs list there).
  root.querySelector('#nv-runs').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-file]'); if (!b) return;
    const msg = root.querySelector('#nv-msg');
    const r = await fetch('/api/load', { method: 'POST', body: JSON.stringify({ file: b.dataset.file }) }).catch((err) => ({ ok: false, json: async () => ({ error: String(err) }) }));
    if (!r.ok) { msg.textContent = (await r.json().catch(() => ({}))).error || 'Could not open that run.'; msg.className = 'nv-msg bad'; msg.hidden = false; return; }
    if (here.pathname === '/' && !curModule) setOpen(false); else location.href = '/';
  });
})();
