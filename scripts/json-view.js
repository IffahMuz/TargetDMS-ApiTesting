/**
 * Pretty, coloured JSON for request and response payloads. Used by the live dashboard (served as /json-view.js, global
 * `JsonView`) and by the static detail report (required from Node). Text that is not JSON, or JSON that was cut short because
 * it was too long, is still coloured as far as it goes and never changed in content.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JsonView = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /** The text indented with 2 spaces when it is JSON; otherwise as it is. */
  function pretty(text) {
    if (text === undefined || text === null) return '';
    if (typeof text !== 'string') return JSON.stringify(text, null, 2);
    const t = text.trim();
    if (!/^[[{]/.test(t)) return text;
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return text; }
  }

  const TOKEN = /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"\n])*")(\s*:)?|\b(true|false)\b|\b(null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|([{}[\],])/g;

  /** HTML for the text, with keys, strings, numbers, booleans and null wrapped in classes (jk, js, jn, jb, jz, jp). */
  function html(text) {
    const src = pretty(text);
    let out = '', last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(src))) {
      out += esc(src.slice(last, m.index));
      if (m[1]) out += m[2] ? `<span class="jk">${esc(m[1])}</span><span class="jp">${esc(m[2])}</span>` : `<span class="js">${esc(m[1])}</span>`;
      else if (m[3]) out += `<span class="jb">${m[3]}</span>`;
      else if (m[4]) out += `<span class="jz">${m[4]}</span>`;
      else if (m[5]) out += `<span class="jn">${m[5]}</span>`;
      else out += `<span class="jp">${esc(m[6])}</span>`;
      last = TOKEN.lastIndex;
    }
    return out + esc(src.slice(last));
  }

  /** Token colours for light and dark themes; `scope` is the CSS selector of the block that holds the JSON. */
  const css = (scope = '.json') => `
${scope} .jk { color:#0b5cad; } ${scope} .js { color:#1a7f4b; } ${scope} .jn { color:#b45309; } ${scope} .jb { color:#7a3db8; font-weight:600; }
${scope} .jz { color:#7a3db8; font-style:italic; } ${scope} .jp { color:#7b8494; }
@media (prefers-color-scheme: dark) {
  ${scope} .jk { color:#8ab4ff; } ${scope} .js { color:#7ee2a8; } ${scope} .jn { color:#f5b85a; } ${scope} .jb, ${scope} .jz { color:#d2a8ff; } ${scope} .jp { color:#8b95a5; }
}`;

  return { pretty, html, css };
});
