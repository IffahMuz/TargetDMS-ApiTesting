import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import { config, tokenPath } from '../src/config';
import { loadOperations } from '../src/operations';

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const operations = loadOperations();

// One test per Swagger operation. Every test asserts the status is 200, 201 or 204.
for (const op of operations) {
  test(`${op.method} ${op.path}`, async ({ request }, testInfo) => {
    const url = op.url.replace('%7B%7BTOKEN%7D%7D', encodeURIComponent(token));
    testInfo.annotations.push(
      { type: 'method', description: op.method },
      { type: 'path', description: op.path },
      { type: 'tag', description: op.tag },
      { type: 'url', description: op.url },
    );

    const started = Date.now();
    let status = 0;
    let bodyText = '';
    try {
      const res = await request.fetch(url, {
        method: op.method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        data: op.hasBody ? (op.body as object) : undefined,
        timeout: config.timeoutMs,
      });
      status = res.status();
      bodyText = (await res.text()).slice(0, 500);
    } catch (err) {
      const reason = `Request error: ${(err as Error).message.split('\n')[0]}`;
      testInfo.annotations.push({ type: 'status', description: '0' }, { type: 'reason', description: reason });
      testInfo.annotations.push({ type: 'duration', description: String(Date.now() - started) });
      throw new Error(reason);
    }

    testInfo.annotations.push(
      { type: 'status', description: String(status) },
      { type: 'duration', description: String(Date.now() - started) },
    );
    if (!config.passStatuses.includes(status)) {
      const reason = `Expected ${config.passStatuses.join('/')} but got ${status}${bodyText ? `: ${bodyText}` : ''}`;
      testInfo.annotations.push({ type: 'reason', description: reason });
    }
    expect(config.passStatuses, `Unexpected status ${status} for ${op.id}`).toContain(status);
  });
}
