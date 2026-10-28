/** Shared by build-detail-report.js and dashboard.js: where run data lives, and matching a request to a Swagger endpoint. */
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const root = path.resolve(__dirname, '..');
const workDir = process.env.WORK_DIR ? path.resolve(process.env.WORK_DIR) : path.join(os.tmpdir(), 'targetdms-api-tests');
const METHODS = ['get', 'post', 'put', 'delete', 'patch'];

/** Every path+method in the spec, with a regex that matches concrete URLs of that path template. */
function loadEndpoints(spec) {
  const endpoints = [];
  for (const [p, item] of Object.entries(spec.paths ?? {})) {
    for (const m of METHODS) {
      const op = item[m];
      if (!op) continue;
      const regex = new RegExp('^' + p.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+') + '/?$', 'i');
      endpoints.push({
        key: `${m.toUpperCase()} ${p}`, method: m.toUpperCase(), path: p, tag: op.tags?.[0] ?? 'Untagged', summary: op.summary ?? '',
        regex, literal: p.replace(/\{[^}]+\}/g, '').length, // more literal characters = more specific template
      });
    }
  }
  return endpoints;
}

/** The most specific endpoint whose path template matches this request, or undefined. */
function endpointFor(endpoints, method, url) {
  const pathOnly = url.replace(/^https?:\/\/[^/]+/i, '').split('?')[0];
  return endpoints.filter((e) => e.method === method && e.regex.test(pathOnly)).sort((a, b) => b.literal - a.literal)[0];
}

module.exports = { root, workDir, loadEndpoints, endpointFor };
