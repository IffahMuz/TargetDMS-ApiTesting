import { expect, APIResponse } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';

test.beforeEach(pace);

const api = '/api/v1';
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
const bearer = (t: string) => ({ Authorization: `Bearer ${t}`, Accept: 'application/json' });

// This flow does its OWN login so that revoking a token never touches the token the rest of the suite uses.
// Rate limit note: Auth/* and User/* paths allow only 5 calls per 3 minutes per IP and path (LOW_THROUGHPUT_POLICY).
// This flow stays well under that: 1 login, 2 validate, 2 refresh, 2 revoke, 1 /User.
test.describe.serial('Flow: login -> use token -> validate -> refresh -> revoke', () => {
  let accessToken = '';
  let refreshToken = '';
  let refreshedToken = '';

  test.beforeAll(() => {
    test.skip(!config.username || !config.password, 'API_USERNAME / API_PASSWORD are not set');
  });

  test('1. Login with valid credentials returns an access token and a refresh token', async ({ request }) => {
    const res = await request.post(`${api}/Auth/Login`, {
      data: { dmsDealerId: config.dmsDealerId || undefined, userName: config.username, password: config.password },
      timeout: config.timeoutMs,
    });
    const body = await json(res);
    expect(config.passStatuses, `HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`).toContain(res.status());
    expect(body.success).toBe(true);
    ({ accessToken, refreshToken } = body.data);
    expect(accessToken.split('.')).toHaveLength(3); // a JWT
    expect(refreshToken.length).toBeGreaterThan(10);
    expect(body.data.tokenType).toBe('Bearer');
    expect(body.data.expiresIn).toBe(3600);
  });

  test('2. The access token opens a protected endpoint and identifies the Admin user', async ({ request }) => {
    test.skip(!accessToken, 'no login');
    const res = await request.get(`${api}/User`, { headers: bearer(accessToken), timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `HTTP ${res.status()}`).toContain(res.status());
    expect(body.data.userName).toBe('Admin');
    expect(body.data.dealerId).toBe(config.dealerId);
  });

  test('3. A protected endpoint without a token is rejected with 401', async ({ request }) => {
    const res = await request.get(`${api}/Customer/Categories/${config.dealerGuid}`, { timeout: config.timeoutMs });
    expect(res.status()).toBe(401);
  });

  test('4. Validate a real token returns true, a made-up token returns false', async ({ request }) => {
    test.skip(!accessToken, 'no login');
    const good = await json(await request.post(`${api}/Auth/ValidateToken`, { data: { token: accessToken }, timeout: config.timeoutMs }));
    expect(good.data).toBe(true);
    const bad = await json(await request.post(`${api}/Auth/ValidateToken`, { data: { token: 'not-a-real-token' }, timeout: config.timeoutMs }));
    expect(bad.data).toBe(false);
  });

  test('5. Refresh token returns a new access token that works', async ({ request }) => {
    test.skip(!refreshToken, 'no login');
    const res = await request.post(`${api}/Auth/RefreshToken`, { data: { token: refreshToken }, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`).toContain(res.status());
    refreshedToken = body.data.accessToken;
    expect(refreshedToken.split('.')).toHaveLength(3);
    expect(refreshedToken).not.toBe(accessToken);
    const me = await request.get(`${api}/Customer/Categories/${config.dealerGuid}`, { headers: bearer(refreshedToken), timeout: config.timeoutMs });
    expect(me.status()).toBe(200);
  });

  test('6. Refresh with a made-up refresh token is rejected', async ({ request }) => {
    const res = await request.post(`${api}/Auth/RefreshToken`, { data: { token: 'not-a-real-refresh-token' }, timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
  });

  test('7. Revoke the refreshed token returns success', async ({ request }) => {
    test.skip(!refreshedToken, 'no refreshed token');
    test.skip(config.skipRevoke, 'SKIP_TOKEN_REVOKE=true');
    const res = await request.post(`${api}/User/RevokeToken`, { headers: bearer(refreshedToken), timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `HTTP ${res.status()}`).toContain(res.status());
    expect(body.data).toBe(true);
  });

  test('8. Revoke without a token is rejected with 401', async ({ request }) => {
    const res = await request.post(`${api}/User/RevokeToken`, { timeout: config.timeoutMs });
    expect(res.status()).toBe(401);
  });
});

// Validation that never reaches the identity server, so it cannot lock the account.
test.describe('Login validation', () => {
  test('Login without a username is rejected with 400', async ({ request }) => {
    const res = await request.post(`${api}/Auth/Login`, { data: { dmsDealerId: config.dmsDealerId || undefined, password: 'x' }, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res)).toLowerCase()).toContain('username');
  });

  test('Refresh with an empty token is rejected with 400', async ({ request }) => {
    const res = await request.post(`${api}/Auth/RefreshToken`, { data: { token: '' }, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
  });
});
