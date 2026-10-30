import * as fs from 'fs';
import { request } from '@playwright/test';
import { cacheDir, config, specPath, tokenPath } from './config';

/** Downloads the Swagger spec and obtains a Bearer token before any test runs. */
export default async function globalSetup() {
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!config.baseUrl) throw new Error('API_BASE_URL is not set (see .env.example)');

  const missing = (['dealerGuid', 'dealerId', 'locationDmsId', 'customerId'] as const).filter((k) => !config[k]);
  if (missing.length) throw new Error(`Dealer settings missing in .env (see .env.example): ${missing.join(', ')}`);

  const basic: Record<string, string> = config.swaggerUser
    ? { Authorization: 'Basic ' + Buffer.from(`${config.swaggerUser}:${config.swaggerPassword}`).toString('base64') }
    : {};
  const ctx = await request.newContext({ baseURL: config.baseUrl, extraHTTPHeaders: basic, timeout: config.timeoutMs });

  const specRes = await ctx.get('/swagger/v1/swagger.json');
  if (!specRes.ok()) throw new Error(`Could not download swagger spec: HTTP ${specRes.status()}`);
  fs.writeFileSync(specPath, JSON.stringify(await specRes.json()));

  let token = config.staticToken;
  // REUSE_TOKEN=true (set by the module runner when the saved token is still valid): use API_TOKEN as it is and make no login call at all.
  const reuse = process.env.REUSE_TOKEN === 'true' && !!token;
  if (config.username && config.password && !reuse) {
    const doLogin = () => ctx.post('/api/v1/Auth/Login', {
      data: { dmsDealerId: config.dmsDealerId || undefined, userName: config.username, password: config.password },
    });
    let res = await doLogin();
    if (res.status() === 429) {
      // Auth endpoints allow 5 calls per 3 minutes per IP; wait for the window to clear and retry once.
      console.log('Login rate-limited (429); waiting 185s before retrying once...');
      await new Promise((r) => setTimeout(r, 185000));
      res = await doLogin();
    }
    const json: any = await res.json().catch(() => ({}));
    token = json?.data?.accessToken ?? json?.Data?.AccessToken ?? token;
    if (!token) throw new Error(`Login failed: HTTP ${res.status()} ${json?.message ?? json?.Message ?? ''}`);
  }
  if (!token) throw new Error('No credentials: set API_USERNAME/API_PASSWORD or API_TOKEN in .env');

  fs.writeFileSync(tokenPath, JSON.stringify({ token }));
  await ctx.dispose();
}
