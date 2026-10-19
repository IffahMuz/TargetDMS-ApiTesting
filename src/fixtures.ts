import { test as base, APIRequestContext } from '@playwright/test';

/**
 * The API allows 100 requests per 3 minutes per user (150 per IP). Tests make several requests each, so pacing by test is not
 * enough. This `test` replaces Playwright's own: every call made through the `request` fixture waits for room in a sliding
 * window, and a 429 answer is retried once after the window clears. Set REQUEST_BUDGET=0 to turn the throttle off.
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

export const throttled = (request: APIRequestContext): APIRequestContext =>
  new Proxy(request, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof prop === 'string' && METHODS.has(prop) && typeof value === 'function') {
        return async (...args: unknown[]) => {
          await waitForRoom();
          let res = await value.apply(target, args);
          if (res.status() === 429 && BUDGET > 0) {
            await sleep(WINDOW_MS + 5_000);
            await waitForRoom();
            res = await value.apply(target, args);
          }
          return res;
        };
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

export const test = base.extend({
  request: async ({ request }, use) => {
    await use(throttled(request));
  },
});
