import { test, expect, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import { config, tokenPath } from '../../src/config';
import { IDS } from '../../src/get-calls/types';
import { pace } from '../../src/pace';

test.beforeEach(pace);

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const base = '/api/v1/Notification';
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));

// GetReceiptLink returns a link carrying a signed token; GetReceipt (public, no auth) turns that token into the receipt HTML.
// Neither call sends an email or text. The order must exist and belong to the logged-in dealer.
test.describe.serial('Flow: receipt link -> receipt', () => {
  let receiptToken = '';

  test('1. POST GetReceiptLink returns a link containing a token', async ({ request }) => {
    const order = await json(await request.get(`/api/v1/Order/${IDS.dealerGuid}?OrderId=${IDS.orderId}`, { headers, timeout: config.timeoutMs }));
    expect(order.success, 'order lookup failed').toBe(true);
    const res = await request.post(`${base}/GetReceiptLink`, {
      headers,
      data: {
        dmsDealerId: 199301001,
        dealerId: IDS.dealerId,
        orderId: IDS.orderId,
        customerId: order.data.customerId,
        invoiceId: order.data.invoices[0].invoiceId,
      },
      timeout: config.timeoutMs,
    });
    const body = await json(res);
    expect(config.passStatuses, `HTTP ${res.status()} ${JSON.stringify(body).slice(0, 300)}`).toContain(res.status());
    expect(body.data).toContain('/receipt?token=');
    receiptToken = new URL(body.data).searchParams.get('token') ?? '';
    expect(receiptToken.length).toBeGreaterThan(20);
  });

  test('2. GET GetReceipt with that token returns the receipt HTML (no auth header needed)', async ({ playwright }) => {
    test.skip(!receiptToken, 'no receipt token');
    const anonymous = await playwright.request.newContext({ baseURL: config.baseUrl });
    const res = await anonymous.get(`${base}/GetReceipt?token=${encodeURIComponent(receiptToken)}`, { timeout: config.timeoutMs });
    const body = await json(res);
    await anonymous.dispose();
    expect(config.passStatuses, `HTTP ${res.status()}`).toContain(res.status());
    expect(body.success).toBe(true);
    expect(body.data).toContain('<html');
    expect(body.data).toContain(String(IDS.orderId));
  });

  test('3. GET GetReceipt without a token is rejected with 400', async ({ request }) => {
    const res = await request.get(`${base}/GetReceipt`, { timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('token');
  });

  test('4. GetReceiptLink for another dealer is forbidden (403)', async ({ request }) => {
    const res = await request.post(`${base}/GetReceiptLink`, {
      headers,
      data: { dmsDealerId: 1, dealerId: 1, orderId: 1, customerId: 1, invoiceId: 1 },
      timeout: config.timeoutMs,
    });
    expect(res.status()).toBe(403);
  });
});
