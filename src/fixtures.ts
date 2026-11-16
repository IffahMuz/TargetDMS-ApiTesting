import * as fs from 'fs';
import * as path from 'path';
import { test as base, APIRequestContext, APIResponse } from '@playwright/test';
import { cacheDir, config, tokenPath } from './config';

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

/**
 * The suite's login token can stop working part way through a long run (seen 15 minutes into "Everything", long before it
 * expires), which turned every later call into a 401. When a call made with the suite's own token gets a 401, the suite logs in
 * again ONCE and repeats the call with the new token; later calls that still carry the old token are switched to the new one.
 * State lives in files because Playwright restarts the worker process after a failed test.
 * Safeguards for the shared test account (it locks after repeated logins): never more than one login per 5 minutes, and after a
 * failed login no further attempt in this run. Set RELOGIN_ON_401=false to turn this off. Global setup clears the state per run.
 */
export const reloginPath = path.join(cacheDir, 'relogin.json');
const RELOGIN_GAP_MS = 5 * 60_000;
interface TokenFile { token: string; previous?: string[] }
interface ReloginState { lastAttempt?: number; failed?: boolean; count?: number }

const readJson = <T>(file: string, fallback: T): T => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const suiteTokens = () => readJson<TokenFile>(tokenPath, { token: '' });

function bearerOf(options: any): { key: string; token: string } | undefined {
  const headers = options?.headers ?? {};
  const key = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
  const m = key ? /^Bearer\s+(.+)$/i.exec(String(headers[key])) : null;
  return key && m ? { key, token: m[1] } : undefined;
}

/** The call's arguments with the bearer token replaced. */
function withToken(args: unknown[], key: string, token: string): unknown[] {
  const options: any = args[1] ?? {};
  return [args[0], { ...options, headers: { ...options.headers, [key]: `Bearer ${token}` } }, ...args.slice(2)];
}

/** Logs in again once and returns the new token, or '' when that is not allowed or did not work. */
async function relogin(ctx: APIRequestContext, deadToken: string): Promise<string> {
  if (process.env.RELOGIN_ON_401 === 'false' || !config.username || !config.password) return '';
  const current = suiteTokens();
  if (current.token && current.token !== deadToken) return current.token;       // already replaced by an earlier re-login
  const state = readJson<ReloginState>(reloginPath, {});
  if (state.failed || (state.lastAttempt && Date.now() - state.lastAttempt < RELOGIN_GAP_MS)) return '';
  fs.writeFileSync(reloginPath, JSON.stringify({ ...state, lastAttempt: Date.now() }));
  await waitForRoom();
  const res = await ctx.post('/api/v1/Auth/Login', {
    data: { dmsDealerId: config.dmsDealerId || undefined, userName: config.username, password: config.password }, timeout: config.timeoutMs,
  }).catch(() => undefined);
  const body: any = res ? await res.json().catch(() => ({})) : {};
  const token: string = body?.data?.accessToken ?? body?.Data?.AccessToken ?? '';
  if (!token) {
    fs.writeFileSync(reloginPath, JSON.stringify({ ...state, lastAttempt: Date.now(), failed: true }));
    console.warn(`The suite's token stopped working and logging in again failed (HTTP ${res?.status() ?? 'no answer'}); no further login attempts in this run.`);
    return '';
  }
  fs.writeFileSync(tokenPath, JSON.stringify({ token, previous: [...(current.previous ?? []), deadToken] }));
  fs.writeFileSync(reloginPath, JSON.stringify({ lastAttempt: Date.now(), failed: false, count: (state.count ?? 0) + 1 }));
  console.log('The suite\'s token stopped working (401); logged in again once and carried on.');
  return token;
}

export const throttled = (request: APIRequestContext, log?: Exchange[]): APIRequestContext =>
  new Proxy(request, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof prop === 'string' && METHODS.has(prop) && typeof value === 'function') {
        return async (...args: unknown[]) => {
          await waitForRoom();
          const started = Date.now();
          // A call still carrying a token the suite has since replaced gets the current one.
          const bearer = bearerOf(args[1]);
          const tokens = bearer ? suiteTokens() : undefined;
          let suiteCall = !!bearer && !!tokens && (bearer.token === tokens.token || !!tokens.previous?.includes(bearer.token));
          if (bearer && tokens && suiteCall && bearer.token !== tokens.token && tokens.token) args = withToken(args, bearer.key, tokens.token);
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
            if (res.status() === 401 && suiteCall && bearer) {
              const fresh = await relogin(target, bearerOf(args[1])!.token);
              if (fresh) {
                suiteCall = false;
                args = withToken(args, bearer.key, fresh);
                await waitForRoom();
                res = await value.apply(target, args);
              }
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
