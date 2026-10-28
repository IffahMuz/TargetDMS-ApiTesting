import * as path from 'path';
import type { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';

const URL = `http://localhost:${process.env.DASHBOARD_PORT ?? 9000}/event`;

/** Sends each test's start and result to the live dashboard (scripts/dashboard.js). Does nothing when the dashboard is not running. */
export default class LiveReporter implements Reporter {
  private root = '';
  private chain: Promise<void> = Promise.resolve();
  private online = true;

  onBegin(config: FullConfig, suite: Suite) {
    this.root = config.rootDir;
    this.send({ type: 'begin', tests: suite.allTests().map((t) => this.describe(t)) });
  }

  onTestBegin(test: TestCase) {
    this.send({ type: 'start', id: test.id });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const attachment = result.attachments.find((a) => a.name === 'http-exchanges');
    this.send({
      type: 'end',
      test: this.describe(test),
      status: result.status,
      ms: result.duration,
      error: result.error?.message?.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 3000) ?? '',
      skipReason: test.annotations.find((a) => a.type === 'skip')?.description ?? '',
      exchanges: attachment?.body ? JSON.parse(attachment.body.toString('utf8')) : [],
    });
  }

  async onEnd(_result: FullResult) {
    this.send({ type: 'finish' });
    await this.chain;
  }

  private describe(test: TestCase) {
    return {
      id: test.id,
      title: test.title,
      group: test.titlePath().slice(3, -1).join(' > '),
      file: path.relative(this.root, test.location.file).replace(/\\/g, '/'),
      line: test.location.line,
      knownDefect: /known defect/i.test(test.title),
    };
  }

  /** Events are posted one at a time so the dashboard sees them in order; the first connection failure switches posting off. */
  private send(event: object) {
    if (!this.online) return;
    this.chain = this.chain.then(async () => {
      if (!this.online) return;
      try {
        await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(3000) });
      } catch {
        this.online = false;
      }
    });
  }
}
