import * as fs from 'fs';
import { request } from '@playwright/test';
import { cacheDir, config, specPath, tokenPath } from './config';

/** Downloads the Swagger spec and obtains a Bearer token before any test runs. */
export default async function globalSetup() {
  fs.mkdirSync(cacheDir, { recursive: true });
  if (!config.baseUrl) throw new Error('API_BASE_URL is not set (see .env.example)');

  const basic: Record<string, string> = config.swaggerUser
    ? { Authorization: 'Basic ' + Buffer.from(`${config.swaggerUser}:${config.swaggerPassword}`).toString('base64') }
    : {};
  const ctx = await request.newContext({ baseURL: config.baseUrl, extraHTTPHeaders: basic, timeout: config.timeoutMs });

  const specRes = await ctx.get('/swagger/v1/swagger.json');
  if (!specRes.ok()) throw new Error(`Could not download swagger spec: HTTP ${specRes.status()}`);
  fs.writeFileSync(specPath, JSON.stringify(await specRes.json()));

  let token = config.staticToken;
  if (config.username && config.password) {
    const res = await ctx.post('/api/v1/Auth/Login', {
      data: { dmsDealerId: config.dmsDealerId || undefined, userName: config.username, password: config.password },
    });
    const json: any = await res.json().catch(() => ({}));
    token = json?.data?.accessToken ?? json?.Data?.AccessToken ?? token;
    if (!token) throw new Error(`Login failed: HTTP ${res.status()} ${json?.message ?? json?.Message ?? ''}`);
  }
  if (!token) throw new Error('No credentials: set API_USERNAME/API_PASSWORD or API_TOKEN in .env');

  fs.writeFileSync(tokenPath, JSON.stringify({ token }));
  await ctx.dispose();
}
