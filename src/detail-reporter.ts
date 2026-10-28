import * as fs from 'fs';
import * as path from 'path';
import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { workDir } from './config';

/** Collects every test with its result, skip reason and recorded requests into <workDir>/run-data.json (read by scripts/build-detail-report.js). */
export default class DetailReporter implements Reporter {
  private tests: unknown[] = [];
  private started = new Date();
  private root = '';

  onBegin(config: FullConfig) {
    this.root = config.rootDir;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const attachment = result.attachments.find((a) => a.name === 'http-exchanges');
    const skipNote = test.annotations.find((a) => a.type === 'skip')?.description;
    const message = result.error?.message?.replace(/\u001b\[[0-9;]*m/g, '') ?? '';
    this.tests.push({
      file: path.relative(this.root, test.location.file).replace(/\\/g, '/'),
      line: test.location.line,
      group: test.titlePath().slice(3, -1).join(' > '),
      title: test.title,
      outcome: result.status === 'skipped' ? 'skipped' : result.status === 'passed' ? 'passed' : 'failed',
      status: result.status,
      knownDefect: /known defect/i.test(test.title),
      durationMs: result.duration,
      error: message.slice(0, 3000),
      skipReason: result.status === 'skipped' ? skipNote ?? '' : '',
      annotations: test.annotations.filter((a) => a.type !== 'skip').map((a) => ({ type: a.type, description: a.description ?? '' })),
      exchanges: attachment?.body ? JSON.parse(attachment.body.toString('utf8')) : [],
    });
  }

  onEnd(_result: FullResult) {
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'run-data.json'), JSON.stringify({ startedAt: this.started.toISOString(), finishedAt: new Date().toISOString(), tests: this.tests }));
  }
}
