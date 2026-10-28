import * as fs from 'fs';
import * as path from 'path';
import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';

interface Row {
  method: string;
  path: string;
  tag: string;
  url: string;
  status: string;
  durationMs: string;
  /** DEFECT = a test written to fail until a known server defect is fixed (purple); FAIL = an unexpected failure (red). */
  result: 'PASS' | 'DEFECT' | 'FAIL' | 'SKIP';
  reason: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const csv = (s: string) => `"${s.replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

/** Writes reports/api-report.html, .csv and .json listing every API with pass/fail and the reason. */
export default class SummaryReporter implements Reporter {
  private rows: Row[] = [];
  private started = new Date();

  onTestEnd(test: TestCase, result: TestResult) {
    const ann = (type: string) => test.annotations.find((a) => a.type === type)?.description ?? '';
    const passed = result.status === 'passed';
    const err = result.error?.message?.split('\n')[0] ?? '';
    this.rows.push({
      method: ann('method') || 'FLOW',
      path: ann('path') || test.titlePath().slice(-2).join(' > '),
      tag: ann('tag') || 'Flow',
      url: ann('url'),
      status: ann('status') || '-',
      durationMs: ann('duration') || String(result.duration),
      result: passed ? 'PASS' : result.status === 'skipped' ? 'SKIP' : /known defect/i.test(test.title) ? 'DEFECT' : 'FAIL',
      reason: passed ? '' : ann('reason') || err || result.status,
    });
  }

  onEnd(_result: FullResult) {
    const dir = path.resolve(__dirname, '..', 'reports');
    fs.mkdirSync(dir, { recursive: true });
    const rank = { FAIL: 0, DEFECT: 1, SKIP: 2, PASS: 3 };
    this.rows.sort((a, b) => (a.result === b.result ? a.path.localeCompare(b.path) : rank[a.result] - rank[b.result]));
    const pass = this.rows.filter((r) => r.result === 'PASS').length;
    const defect = this.rows.filter((r) => r.result === 'DEFECT').length;
    const skip = this.rows.filter((r) => r.result === 'SKIP').length;
    const fail = this.rows.length - pass - defect - skip;

    fs.writeFileSync(path.join(dir, 'api-report.json'), JSON.stringify({ pass, defect, skip, fail, rows: this.rows }, null, 2));
    fs.writeFileSync(
      path.join(dir, 'api-report.csv'),
      ['Result,Method,Path,Tag,Status,DurationMs,Reason']
        .concat(this.rows.map((r) => [r.result, r.method, r.path, r.tag, r.status, r.durationMs, csv(r.reason)].join(',')))
        .join('\n'),
    );

    const body = this.rows
      .map(
        (r) => `<tr class="${r.result.toLowerCase()}"><td>${r.result === 'DEFECT' ? 'KNOWN DEFECT' : r.result}</td><td>${r.method}</td><td>${esc(r.path)}</td><td>${esc(r.tag)}</td><td>${r.status}</td><td>${r.durationMs} ms</td><td>${esc(r.reason)}</td></tr>`,
      )
      .join('\n');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>API Test Report</title>
<style>
body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#222}
.cards span{display:inline-block;padding:10px 18px;margin-right:10px;border-radius:6px;color:#fff;font-weight:600}
.total{background:#555}.p{background:#2e7d32}.d{background:#7a3db8}.s{background:#a15c00}.f{background:#c62828}
table{border-collapse:collapse;width:100%;margin-top:18px;font-size:13px}
th,td{border:1px solid #ddd;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f3f3f3}tr.fail{background:#fdecea}tr.defect{background:#f1e8fb}tr.skip{background:#fff4e0}tr.pass td:first-child{color:#2e7d32;font-weight:600}
tr.fail td:first-child{color:#c62828;font-weight:600}tr.defect td:first-child{color:#7a3db8;font-weight:600}tr.skip td:first-child{color:#a15c00;font-weight:600}td:last-child{word-break:break-word;max-width:520px}
</style></head><body>
<h2>API Automation Report</h2>
<p>Run started ${this.started.toLocaleString()}</p>
<div class="cards"><span class="total">Total ${this.rows.length}</span><span class="p">Passed ${pass}</span><span class="d">Known defects ${defect}</span><span class="s">Skipped ${skip}</span><span class="f">Failed ${fail}</span></div>
<table><thead><tr><th>Result</th><th>Method</th><th>Endpoint</th><th>Tag</th><th>Status</th><th>Time</th><th>Failure reason</th></tr></thead><tbody>
${body}
</tbody></table></body></html>`;
    fs.writeFileSync(path.join(dir, 'api-report.html'), html);
    console.log(`\nAPI summary: ${pass} passed, ${defect} known defects, ${skip} skipped, ${fail} failed -> ${path.join(dir, 'api-report.html')}`);
  }
}
