import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import { config, tokenPath } from '../../src/config';
import { IDS } from '../../src/get-calls/types';
import { PostCall } from '../../src/post-calls/types';
import { pace } from '../../src/pace';

test.beforeEach(pace);

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));

function buildUrl(call: PostCall): string {
  const params: Record<string, string | number> = { dealerGuid: IDS.dealerGuid, ...call.pathParams };
  const p = call.path.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in params)) throw new Error(`No value for {${k}} in ${call.path}`);
    return encodeURIComponent(String(params[k]));
  });
  const q = typeof call.query === 'function' ? call.query({ token }) : call.query;
  const qs = new URLSearchParams(Object.entries(q ?? {}).map(([k, v]) => [k, String(v)])).toString();
  return qs ? `${p}?${qs}` : p;
}

/** One explicit POST test per call: expected status (default 200/201/204), then the call's own response checks. */
export function runPostCalls(area: string, calls: PostCall[]) {
  test.describe(`POST ${area}`, () => {
    for (const call of calls) {
      test(`${call.name} - POST ${call.path}`, async ({ request }, testInfo) => {
        const url = buildUrl(call);
        const expected = call.expectStatus ?? config.passStatuses;
        testInfo.annotations.push(
          { type: 'method', description: 'POST' },
          { type: 'path', description: `${call.path}  (${call.name})` },
          { type: 'tag', description: area },
          { type: 'url', description: url },
        );
        const started = Date.now();
        let status = 0;
        let body: any = {};
        let text = '';
        try {
          const res = await request.post(url, {
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            data: call.body as object,
            timeout: config.timeoutMs,
          });
          status = res.status();
          text = await res.text();
          try { body = JSON.parse(text); } catch { body = {}; }
        } catch (err) {
          const reason = `Request error: ${(err as Error).message.split('\n')[0]}`;
          testInfo.annotations.push({ type: 'status', description: '0' }, { type: 'reason', description: reason }, { type: 'duration', description: String(Date.now() - started) });
          throw new Error(reason);
        }
        testInfo.annotations.push({ type: 'status', description: String(status) }, { type: 'duration', description: String(Date.now() - started) });

        try {
          expect(expected, `HTTP ${status}`).toContain(status);
          if (config.passStatuses.includes(status)) {
            expect(body.success ?? body.Success, `success flag: ${text.slice(0, 200)}`).toBe(true);
            call.check(body.data ?? body.Data);
          } else {
            call.check(body);
          }
        } catch (err) {
          const detail = (err as Error).message.split('\n')[0];
          const reason = expected.includes(status)
            ? `HTTP ${status} as expected but check failed: ${detail}`
            : `Expected ${expected.join('/')} but got ${status}: ${(body.message ?? body.Message ?? text).toString().slice(0, 300)}`;
          testInfo.annotations.push({ type: 'reason', description: reason });
          throw err;
        }
      });
    }
  });
}
