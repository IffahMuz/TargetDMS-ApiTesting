import { test, expect, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import { config, tokenPath } from '../../src/config';
import { IDS } from '../../src/get-calls/types';
import { pace } from '../../src/pace';

test.beforeEach(pace);

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
const isClientError = (status: number) => status >= 400 && status < 500;

// These tests assert the CORRECT behaviour for bad input. They currently FAIL because the API answers
// with a 5xx instead of a clean 4xx. They stay red on purpose until the defects are fixed, so the report keeps flagging them.
// Root causes found in the backend source (TargetDMS.Backend, `test` branch):
//   - GetReceipt: the token is Base64-decoded with no try/catch; a FormatException falls through to the generic 500.
//   - Wholegoods: CurrentOwnerId defaults to 0, no validator rule rejects it, and the upstream Everest call returns 500.
//   - Wholegood/Detail: an unknown id gets an empty upstream response; ReadFromJsonAsync then throws a JsonException (500).
//   - GetInventory: no upper bound on pageNumber; far pages make the upstream query time out (504).
test.describe('Known server defects (5xx instead of 4xx)', () => {
  test('GetReceipt with a malformed token should be a 4xx, not 500 [known defect]', async ({ request }) => {
    const res = await request.get('/api/v1/Notification/GetReceipt?token=abc', { timeout: config.timeoutMs });
    expect(isClientError(res.status()), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(true);
  });

  test('Wholegoods without a real owner should be a 4xx, not 500 [known defect]', async ({ request }) => {
    const res = await request.get(`/api/v1/Inventory/Wholegoods/${IDS.dealerGuid}?pageNumber=1&pageSize=10`, { headers, timeout: config.timeoutMs });
    expect(isClientError(res.status()), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(true);
  });

  test('Wholegood detail for an unknown id should be a 404, not 500 [known defect]', async ({ request }) => {
    const res = await request.get(`/api/v1/Inventory/Wholegood/Detail/${IDS.dealerGuid}?InventoryWgId=NO-SUCH-UNIT`, { headers, timeout: config.timeoutMs });
    expect(isClientError(res.status()), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(true);
  });

  // Evidence on dealer 888166: condition "" -> 8972 items, "New" -> 7299, "Used" -> 0. The 1673 items that are not New
  // are never returned by the "Used" filter. Wholegoods show the same gap (WG: "" -> 1950, "New" -> 301, "Used" -> 0).
  // The backend only forwards `condition` to Everest unchanged, so the filter is applied upstream.
  test('GetInventory condition "Used" should return the items that are not New [known defect]', async ({ request }) => {
    const total = async (condition: string) => {
      const res = await request.post('/api/v1/Inventory/GetInventory', {
        headers,
        data: { dealerId: String(IDS.dealerId), itemType: '', search: '', mfrCode: '', availability: '', categoryId: '', condition, modelCode: '', tag: '', pageNumber: 0, pageSize: 1 },
        timeout: config.timeoutMs,
      });
      expect(config.passStatuses, `HTTP ${res.status()} for condition "${condition}"`).toContain(res.status());
      return (await json(res)).data.totalCount as number;
    };
    const [all, fresh, used] = [await total(''), await total('New'), await total('Used')];
    expect(used, `Used=${used}, New=${fresh}, all=${all}: Used should not be empty`).toBeGreaterThan(0);
    expect(used + fresh, `Used (${used}) + New (${fresh}) should equal all (${all})`).toBe(all);
  });

  // Deleting a tag removes it from the tag list and from the part's tagDetails, but the assignment row stays behind:
  // GetInventory with tag=<deleted id> still returns the item until Tags/Remove is called with the deleted id.
  test('Deleting a tag should clear its inventory assignments [known defect]', async ({ request }) => {
    const guid = IDS.dealerGuid;
    const filter = (tag: string) => request.post('/api/v1/Inventory/GetInventory', {
      headers,
      data: { dealerId: String(IDS.dealerId), itemType: '', search: '', mfrCode: '', availability: '', categoryId: '', condition: 'New', modelCode: '', tag, pageNumber: 0, pageSize: 10 },
      timeout: config.timeoutMs,
    });
    const created = await json(await request.post(`/api/v1/Dealer/Tag/${guid}`, {
      headers, data: { tagId: 0, name: `AUTOMATION-stale-${Date.now()}`, color: '#111111', isActive: true, category: 'Inventory' }, timeout: config.timeoutMs,
    }));
    const tagId = created.data.tagId as number;
    const part = { inventoryPartId: '****CARD FEE' };
    try {
      await request.post(`/api/v1/Dealer/Tags/Assign/${guid}`, { headers, data: { tagIds: [tagId], inventoryParts: [part] }, timeout: config.timeoutMs });
      expect((await json(await filter(String(tagId)))).data.totalCount, 'assignment should be visible before delete').toBe(1);
      const del = await request.delete(`/api/v1/Dealer/Tag/${guid}/${tagId}`, { headers, timeout: config.timeoutMs });
      expect(config.passStatuses).toContain(del.status());
      const after = (await json(await filter(String(tagId)))).data.totalCount;
      expect(after, `deleted tag ${tagId} still matches ${after} inventory item(s)`).toBe(0);
    } finally {
      await request.post(`/api/v1/Dealer/Tags/Remove/${guid}`, { headers, data: { tagIds: [tagId], inventoryParts: [part] }, timeout: config.timeoutMs });
      await request.delete(`/api/v1/Dealer/Tag/${guid}/${tagId}`, { headers, timeout: config.timeoutMs });
    }
  });

  // Swagger/validator (SaveDealerTagRequestValidator): "IsActive cannot be set to false. Use the delete tag endpoint".
  // The deployed API accepts isActive=false with 200 and stores it.
  test('Saving a tag with isActive=false should be rejected with 400 [known defect]', async ({ request }) => {
    const guid = IDS.dealerGuid;
    const created = await json(await request.post(`/api/v1/Dealer/Tag/${guid}`, {
      headers, data: { tagId: 0, name: `AUTOMATION-inactive-${Date.now()}`, color: '#222222', isActive: true, category: 'Public' }, timeout: config.timeoutMs,
    }));
    const tagId = created.data.tagId as number;
    try {
      const res = await request.post(`/api/v1/Dealer/Tag/${guid}`, {
        headers, data: { tagId, name: `AUTOMATION-inactive-upd-${Date.now()}`, color: '#222222', isActive: false, category: 'Public' }, timeout: config.timeoutMs,
      });
      expect(res.status(), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(400);
    } finally {
      await request.delete(`/api/v1/Dealer/Tag/${guid}/${tagId}`, { headers, timeout: config.timeoutMs });
    }
  });

  // POST User/RevokeToken answers 200 / true, but the token keeps working: GET /User still returns 200 for at least 40 seconds,
  // Auth/ValidateToken still says true, and the matching refresh token still issues new tokens. The backend returns
  // `IsSuccessStatusCode` from the identity server and revokes with an access-token hint only.
  test('A revoked access token should stop working [known defect]', async ({ request }) => {
    test.skip(!config.username || !config.password, 'API_USERNAME / API_PASSWORD are not set');
    const login = await json(await request.post('/api/v1/Auth/Login', {
      data: { dmsDealerId: config.dmsDealerId || undefined, userName: config.username, password: config.password }, timeout: config.timeoutMs,
    }));
    const own = login.data.accessToken as string;
    const revoke = await request.post('/api/v1/User/RevokeToken', { headers: { Authorization: `Bearer ${own}` }, timeout: config.timeoutMs });
    expect(config.passStatuses).toContain(revoke.status());
    await new Promise((r) => setTimeout(r, 5000));
    const after = await request.get(`/api/v1/Customer/Categories/${IDS.dealerGuid}`, { headers: { Authorization: `Bearer ${own}` }, timeout: config.timeoutMs });
    expect(after.status(), 'a revoked token should be rejected with 401').toBe(401);
  });

  // Order/All answers 500 "The JSON value could not be converted to System.Int32. Path: $[0].TotalCount" as soon as the query
  // matches at least one order (CustomerId=17395 has orders). Queries that match nothing return 200 with an empty list, so the
  // plain list test passes only because its filter matches no rows. The TagIds filter hits the same failure.
  test('Order/All should return a customer\'s orders, not 500 [known defect]', async ({ request }) => {
    const res = await request.get(`/api/v1/Order/All/${IDS.dealerGuid}?CustomerId=${IDS.customerId}&PageNumber=1&PageSize=5`, { headers, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `HTTP ${res.status()}: ${JSON.stringify(body).slice(0, 200)}`).toContain(res.status());
    expect(body.data.orders.length).toBeGreaterThan(0);
  });

  test('Order/All with TagIds should return the tagged order [known defect]', async ({ request }) => {
    const guid = IDS.dealerGuid;
    const raw = JSON.parse(require('fs').readFileSync(require('path').resolve(__dirname, '..', '..', 'testdata', 'order-create.json'), 'utf8').split('{{NOW}}').join(new Date().toISOString().slice(0, 19)));
    raw.notes = `AUTOMATION-${Date.now()}`;
    const created = await json(await request.post(`/api/v1/Order/${guid}`, { headers, data: raw, timeout: config.timeoutMs }));
    const orderId = created.data.orderId as number;
    let tagId = 0;
    let invoiceGuid = '';
    try {
      invoiceGuid = (await json(await request.get(`/api/v1/Order/${guid}?OrderId=${orderId}`, { headers, timeout: config.timeoutMs }))).data.invoices[0].invoiceGuid;
      tagId = (await json(await request.post(`/api/v1/Dealer/Tag/${guid}`, {
        headers, data: { tagId: 0, name: `AUTOMATION-orderfilter-${Date.now()}`, color: '#FF8800', isActive: true, category: 'Order' }, timeout: config.timeoutMs,
      }))).data.tagId;
      await request.post(`/api/v1/Dealer/Tags/Assign/${guid}`, { headers, data: { tagIds: [tagId], invoices: [{ invoiceGuid }] }, timeout: config.timeoutMs });
      const res = await request.get(`/api/v1/Order/All/${guid}?TagIds=${tagId}`, { headers, timeout: config.timeoutMs });
      const body = await json(res);
      expect(config.passStatuses, `HTTP ${res.status()}: ${JSON.stringify(body).slice(0, 200)}`).toContain(res.status());
      expect(body.data.orders.map((o: any) => o.orderId)).toContain(orderId);
    } finally {
      if (tagId) {
        await request.post(`/api/v1/Dealer/Tags/Remove/${guid}`, { headers, data: { tagIds: [tagId], invoices: [{ invoiceGuid }] }, timeout: config.timeoutMs });
        await request.delete(`/api/v1/Dealer/Tag/${guid}/${tagId}`, { headers, timeout: config.timeoutMs });
      }
      await request.delete(`/api/v1/Order/${guid}?orderId=${orderId}`, { headers, timeout: config.timeoutMs });
    }
  });

  test('GetInventory far past the last page should return an empty list, not time out [known defect]', async ({ request }) => {
    const res = await request.post('/api/v1/Inventory/GetInventory', {
      headers,
      data: { dealerId: String(IDS.dealerId), itemType: '', search: '', mfrCode: '', availability: '', categoryId: '', condition: 'New', modelCode: '', tag: '', pageNumber: 1000, pageSize: 25 },
      timeout: config.timeoutMs,
    });
    expect(config.passStatuses, `HTTP ${res.status()}`).toContain(res.status());
    expect((await json(res)).data.inventory).toEqual([]);
  });
});
