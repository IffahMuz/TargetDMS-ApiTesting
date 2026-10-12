import { test, expect, request as pwRequest, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { config, tokenPath } from '../../src/config';

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const orderUrl = `/api/v1/Order/${config.dealerGuid}`;

const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
const pick = (o: any, key: string) => o?.[key] ?? o?.[key[0].toUpperCase() + key.slice(1)];

function buildBody(file: string, marker: string) {
  const now = new Date().toISOString().slice(0, 19);
  const raw = fs.readFileSync(path.resolve(__dirname, '..', '..', 'testdata', file), 'utf8');
  const body = JSON.parse(raw.split('{{NOW}}').join(now));
  body.notes = marker; // makes automation orders easy to spot
  body.poNumber = marker.slice(0, 20);
  return body;
}

/**
 * Registers a serial create -> get -> delete -> verify-closed flow for one order body.
 * `expectInGet` are strings that must appear in the GET response (e.g. the part number).
 */
export function defineOrderFlow(title: string, bodyFile: string, expectInGet: string[] = []) {
  test.describe.serial(`Flow: ${title}`, () => {
    const marker = `AUTOMATION-${Date.now()}`;
    let orderId = 0;
    let deleted = false;

    test('1. POST create order returns 200/201/204 and an order id', async ({ request }) => {
      const res = await request.post(orderUrl, { headers, data: buildBody(bodyFile, marker), timeout: config.timeoutMs });
      const body = await json(res);
      orderId = Number(pick(pick(body, 'data'), 'orderId') ?? 0);
      expect(config.passStatuses, `create: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 400)}`).toContain(res.status());
      expect(orderId, `no orderId in response: ${JSON.stringify(body).slice(0, 400)}`).toBeGreaterThan(0);
    });

    test('2. GET the created order returns the same order and its line items', async ({ request }) => {
      test.skip(!orderId, 'order was not created');
      const res = await request.get(`${orderUrl}?orderId=${orderId}`, { headers, timeout: config.timeoutMs });
      const body = await json(res);
      const text = JSON.stringify(body);
      expect(config.passStatuses, `get: HTTP ${res.status()} ${text.slice(0, 400)}`).toContain(res.status());
      expect(text).toContain(String(orderId));
      for (const needle of expectInGet) expect(text, `GET response should contain "${needle}"`).toContain(needle);
    });

    test('3. DELETE the order returns 200/201/204', async ({ request }) => {
      test.skip(!orderId, 'order was not created');
      const res = await request.delete(`${orderUrl}?orderId=${orderId}`, { headers, timeout: config.timeoutMs });
      deleted = config.passStatuses.includes(res.status());
      expect(config.passStatuses, `delete: HTTP ${res.status()} ${(await res.text()).slice(0, 400)}`).toContain(res.status());
    });

    test('4. GET after delete shows the order as Closed (API soft-deletes)', async ({ request }) => {
      test.skip(!orderId || !deleted, 'order was not deleted');
      const res = await request.get(`${orderUrl}?orderId=${orderId}`, { headers, timeout: config.timeoutMs });
      const body = await json(res);
      const status = pick(pick(body, 'data'), 'orderStatusId');
      // A hard delete (404/400) would also be acceptable.
      if (config.passStatuses.includes(res.status())) {
        expect(status, `order ${orderId} should be Closed after delete`).toBe('Closed');
      }
    });

    // Safety net: if a middle step failed, don't leave the test order behind.
    test.afterAll(async () => {
      if (orderId && !deleted) {
        const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
        const res = await ctx.delete(`${orderUrl}?orderId=${orderId}`, { headers });
        await ctx.dispose();
        console.log(`Cleanup delete of order ${orderId}: HTTP ${res.status()}`);
      }
    });
  });
}
