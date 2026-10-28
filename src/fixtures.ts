import { test as base, APIRequestContext, APIResponse } from '@playwright/test';

/**
 * The API allows 100 requests per 3 minutes per user (150 per IP). Tests make several requests each, so pacing by test is not
 * enough. This `test` replaces Playwright's own: every call made through the `request` fixture waits for room in a sliding
 * window, and a 429 answer is retried once after the window clears. Set REQUEST_BUDGET=0 to turn the throttle off.
 * Every call is also recorded (secrets removed) and attached to the test for the detailed report.
 */
const WINDOW_MS = 180_000;
const BUDGET = Number(process.env.REQUEST_BUDGET ?? 80);
const stamps: number[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForRoom(): Promise<void> {
  if (BUDGET <= 0) return;
  for (;;) {
    const now = Date.now();
    while (stamps.length && now - stamps[0] > WINDOW_MS) stamps.shift();
    if (stamps.length < BUDGET) {
      stamps.push(now);
      return;
    }
    await sleep(stamps[0] + WINDOW_MS - now + 250);
  }
}

const METHODS = new Set(['get', 'post', 'put', 'delete', 'patch', 'head', 'fetch']);

/** One request/response pair, kept for the detailed report (src/detail-reporter.ts). */
export interface Exchange {
  method: string;
  url: string;
  requestBody?: unknown;
  status: number;
  responseBody?: unknown;
  durationMs: number;
  error?: string;
}

const SECRET = /pass(word)?|accesstoken|refreshtoken|^token$/i;
const MAX_BODY = 20_000;

/** Copies a value with secrets (passwords, tokens) replaced, so the report can be shared. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, SECRET.test(k) ? '***' : redact(v)]));
  }
  return value;
}

function shrink(value: unknown): unknown {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text !== undefined && text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}... (truncated, ${text.length} characters)` : value;
}

async function responseBody(res: APIResponse): Promise<unknown> {
  const text = await res.text().catch(() => '');
  try { return shrink(redact(JSON.parse(text))); } catch { return shrink(text); }
}

export const throttled = (request: APIRequestContext, log?: Exchange[]): APIRequestContext =>
  new Proxy(request, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof prop === 'string' && METHODS.has(prop) && typeof value === 'function') {
        return async (...args: unknown[]) => {
          await waitForRoom();
          const started = Date.now();
          const options: any = args[1] ?? {};
          const entry: Exchange = {
            method: (prop === 'fetch' ? String(options.method ?? 'GET') : prop).toUpperCase(),
            url: String(args[0]).replace(/([?&]token=)[^&]*/i, '$1***'),
            requestBody: options.data === undefined ? undefined : shrink(redact(options.data)),
            status: 0,
            durationMs: 0,
          };
          try {
            let res = await value.apply(target, args);
            if (res.status() === 429 && BUDGET > 0) {
              await sleep(WINDOW_MS + 5_000);
              await waitForRoom();
              res = await value.apply(target, args);
            }
            entry.status = res.status();
            entry.responseBody = await responseBody(res);
            return res;
          } catch (err) {
            entry.error = (err as Error).message.split('\n')[0];
            throw err;
          } finally {
            entry.durationMs = Date.now() - started;
            log?.push(entry);
          }
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

export const test = base.extend({
  request: async ({ request }, use, testInfo) => {
    const log: Exchange[] = [];
    await use(throttled(request, log));
    if (log.length) await testInfo.attach('http-exchanges', { body: JSON.stringify(log), contentType: 'application/json' });
  },
});
