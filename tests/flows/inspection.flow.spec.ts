import { test, expect, request as pwRequest, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { config, tokenPath } from '../../src/config';
import { pace } from '../../src/pace';

test.beforeEach(pace);

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const url = `/api/v1/Inspection/Session/${config.dealerGuid}`;
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));

test.describe.serial('Flow: inspection session create -> get -> delete', () => {
  let sessionId = '';
  let deleted = false;

  test('1. POST create inspection session returns 200/201/204 and a session id', async ({ request }) => {
    const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'testdata', 'inspection-session.json'), 'utf8'));
    const res = await request.post(url, { headers, data, timeout: config.timeoutMs });
    const body = await json(res);
    sessionId = body?.data?.inspectionSessionId ?? '';
    expect(config.passStatuses, `create: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 400)}`).toContain(res.status());
    expect(sessionId, `no inspectionSessionId in response: ${JSON.stringify(body).slice(0, 400)}`).toBeTruthy();
  });

  test('2. GET the session returns the same session with 2 results', async ({ request }) => {
    test.skip(!sessionId, 'session was not created');
    const res = await request.get(`${url}?inspectionSessionId=${sessionId}`, { headers, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `get: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 400)}`).toContain(res.status());
    expect(body.data.inspectionSessionId).toBe(sessionId);
    expect(body.data.results).toHaveLength(2);
  });

  test('3. DELETE the session returns 200/201/204', async ({ request }) => {
    test.skip(!sessionId, 'session was not created');
    const res = await request.delete(`${url}?inspectionSessionId=${sessionId}`, { headers, timeout: config.timeoutMs });
    deleted = config.passStatuses.includes(res.status());
    expect(config.passStatuses, `delete: HTTP ${res.status()} ${(await res.text()).slice(0, 400)}`).toContain(res.status());
  });

  test('4. GET after delete no longer finds the session', async ({ request }) => {
    test.skip(!deleted, 'session was not deleted');
    const res = await request.get(`${url}?inspectionSessionId=${sessionId}`, { headers, timeout: config.timeoutMs });
    expect(config.passStatuses, `session still returned after delete (HTTP ${res.status()})`).not.toContain(res.status());
  });

  test.afterAll(async () => {
    if (sessionId && !deleted) {
      const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
      const res = await ctx.delete(`${url}?inspectionSessionId=${sessionId}`, { headers });
      await ctx.dispose();
      console.log(`Cleanup delete of inspection session ${sessionId}: HTTP ${res.status()}`);
    }
  });
});
