import { expect, request as pwRequest, APIResponse } from '@playwright/test';
import { test } from '../../src/fixtures';
import * as fs from 'fs';
import * as path from 'path';
import { config, tokenPath } from '../../src/config';
import { loadTestBody } from '../../src/testdata';
import { pace } from '../../src/pace';

test.beforeEach(pace);

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const guid = config.dealerGuid;
const orderUrl = `/api/v1/Order/${guid}`;
const tagUrl = `/api/v1/Dealer/Tag/${guid}`;
const assignUrl = `/api/v1/Dealer/Tags/Assign/${guid}`;
const removeUrl = `/api/v1/Dealer/Tags/Remove/${guid}`;
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
const ok = (res: APIResponse) => config.passStatuses.includes(res.status());

function orderBody(marker: string) {
  const body = loadTestBody("order-create.json");
  body.notes = marker;
  body.poNumber = 'AUTO-TAG';
  return body;
}

// Tags on an order's invoice (tag category "Order"). Creates its own order and tag and cleans both up.
// Note: filtering with Order/All?TagIds= is covered in tests/defects because Order/All currently returns 500 whenever it has rows.
test.describe.serial('Flow: tag an order invoice -> assign -> remove -> clean up', () => {
  const marker = `AUTOMATION-${Date.now()}`;
  let orderId = 0;
  let invoiceGuid = '';
  let tagId = 0;
  let assigned = false;

  test('1. Setup: create an order and an Order-category tag', async ({ request }) => {
    const created = await json(await request.post(orderUrl, { headers, data: orderBody(marker), timeout: config.timeoutMs }));
    orderId = Number(created?.data?.orderId ?? 0);
    expect(orderId, `order not created: ${JSON.stringify(created).slice(0, 200)}`).toBeGreaterThan(0);
    const order = await json(await request.get(`${orderUrl}?OrderId=${orderId}`, { headers, timeout: config.timeoutMs }));
    invoiceGuid = order.data.invoices[0].invoiceGuid;
    expect(invoiceGuid).toMatch(/^[0-9a-f-]{36}$/i);
    const tag = await json(await request.post(tagUrl, {
      headers,
      data: { tagId: 0, name: `AUTOMATION-order-${Date.now()}`, description: 'order tag test', color: '#FF8800', isActive: true, category: 'Order' },
      timeout: config.timeoutMs,
    }));
    tagId = Number(tag?.data?.tagId ?? 0);
    expect(tagId, `tag not created: ${JSON.stringify(tag).slice(0, 200)}`).toBeGreaterThan(0);
    expect(tag.data.category).toBe('Order');
  });

  test('2. Assign the tag to the invoice returns assignedCount 1', async ({ request }) => {
    test.skip(!tagId || !invoiceGuid, 'setup failed');
    const res = await request.post(assignUrl, { headers, data: { tagIds: [tagId], invoices: [{ invoiceGuid }] }, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `assign: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`).toContain(res.status());
    expect(body.data.assignedCount).toBe(1);
    assigned = true;
  });

  test('3. Assigning the same tag again assigns 0', async ({ request }) => {
    test.skip(!assigned, 'tag was not assigned');
    const res = await request.post(assignUrl, { headers, data: { tagIds: [tagId], invoices: [{ invoiceGuid }] }, timeout: config.timeoutMs });
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    expect((await json(res)).data.assignedCount).toBe(0);
  });

  test('4. Assigning to an invoice that does not exist assigns 0 (no error)', async ({ request }) => {
    test.skip(!tagId, 'setup failed');
    const res = await request.post(assignUrl, { headers, data: { tagIds: [tagId], invoices: [{ invoiceGuid: '00000000-0000-0000-0000-000000000001' }] }, timeout: config.timeoutMs });
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    expect((await json(res)).data.assignedCount).toBe(0);
  });

  test('5. Remove the tag from the invoice returns removedCount 1', async ({ request }) => {
    test.skip(!assigned, 'tag was not assigned');
    const res = await request.post(removeUrl, { headers, data: { tagIds: [tagId], invoices: [{ invoiceGuid }] }, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `remove: HTTP ${res.status()}`).toContain(res.status());
    expect(body.data.removedCount).toBe(1);
    assigned = false;
  });

  test('6. Removing it again removes 0', async ({ request }) => {
    test.skip(!tagId || !invoiceGuid, 'setup failed');
    const res = await request.post(removeUrl, { headers, data: { tagIds: [tagId], invoices: [{ invoiceGuid }] }, timeout: config.timeoutMs });
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    expect((await json(res)).data.removedCount).toBe(0);
  });

  test('7. Cleanup: delete the tag and the order', async ({ request }) => {
    test.skip(!tagId, 'setup failed');
    const delTag = await request.delete(`${tagUrl}/${tagId}`, { headers, timeout: config.timeoutMs });
    expect(ok(delTag), `delete tag: HTTP ${delTag.status()}`).toBe(true);
    tagId = 0;
    const delOrder = await request.delete(`${orderUrl}?orderId=${orderId}`, { headers, timeout: config.timeoutMs });
    expect(ok(delOrder), `delete order: HTTP ${delOrder.status()}`).toBe(true);
    orderId = 0;
  });

  test.afterAll(async () => {
    if (!tagId && !orderId) return;
    const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
    if (tagId) {
      if (invoiceGuid) await ctx.post(removeUrl, { headers, data: { tagIds: [tagId], invoices: [{ invoiceGuid }] } });
      await ctx.delete(`${tagUrl}/${tagId}`, { headers });
    }
    if (orderId) await ctx.delete(`${orderUrl}?orderId=${orderId}`, { headers });
    await ctx.dispose();
    console.log(`Cleanup: order ${orderId || '-'} and tag ${tagId || '-'} removed`);
  });
});
