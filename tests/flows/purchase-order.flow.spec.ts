import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { guid, headers, json } from '../../src/warranty-helpers';

test.beforeEach(pace);

const receive = (request: any, purchaseOrderId: number, items: unknown) =>
  request.put(`/api/v1/PurchaseOrder/Receive/${guid}/${purchaseOrderId}`, { headers, data: items, timeout: config.timeoutMs });

// Receiving stock on a purchase order is permanent and cannot be undone, and this API cannot create a purchase order.
// So every request here uses an item id that cannot exist (NO_ITEM): nothing is received and nothing changes.
// Failing-input behaviour (which currently comes back as vague 502s or is accepted) is recorded in tests/defects.
const NO_ITEM = 999999999;
const missingItem = { itemId: NO_ITEM, receivedQty: 0, backOrderQty: 0, productType: 'P' };

test.describe.serial('Purchase order receive: requests for items that do not exist change nothing', () => {
  let poId = 0;
  let before: any[] = [];

  test('1. Find an open purchase order and note its lines', async ({ request }) => {
    const list = (await json(await request.get(`/api/v1/PurchaseOrder/${guid}?PageNumber=1&PageSize=50`, { headers, timeout: config.timeoutMs }))).data;
    const open = list.items.find((p: any) => p.purchaseOrderStatus === 'O' && p.items > 0);
    test.skip(!open, 'This dealer has no open purchase order.');
    poId = open.purchaseOrderId;
    before = (await json(await request.get(`/api/v1/PurchaseOrder/Detail/${guid}/${poId}`, { headers, timeout: config.timeoutMs }))).data;
    expect(before.length).toBeGreaterThan(0);
  });

  test('2. Receiving an item that does not exist updates nothing and names the missing item', async ({ request }) => {
    test.skip(!poId, 'no purchase order');
    const res = await receive(request, poId, [missingItem]);
    const body = await json(res);
    expect(config.passStatuses, JSON.stringify(body).slice(0, 200)).toContain(res.status());
    expect(body.data).toEqual({ updatedCount: 0, notFoundItemIds: [NO_ITEM] });
  });

  test('3. The purchase order lines are exactly as before', async ({ request }) => {
    test.skip(!poId, 'no purchase order');
    const after = (await json(await request.get(`/api/v1/PurchaseOrder/Detail/${guid}/${poId}`, { headers, timeout: config.timeoutMs }))).data;
    expect(after).toEqual(before);
  });

  test('4. A purchase order id of 0 is rejected with 400', async ({ request }) => {
    const res = await receive(request, 0, [missingItem]);
    expect(res.status(), JSON.stringify(await json(res)).slice(0, 200)).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('Purchase Order ID must be greater than 0');
  });
});
