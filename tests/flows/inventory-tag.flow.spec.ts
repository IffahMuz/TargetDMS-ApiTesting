import { expect, request as pwRequest, APIResponse } from '@playwright/test';
import { test } from '../../src/fixtures';
import * as fs from 'fs';
import { config, tokenPath } from '../../src/config';
import { IDS } from '../../src/get-calls/types';
import { pace } from '../../src/pace';
import { DATA } from '../../src/testdata';

test.beforeEach(pace);

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const guid = config.dealerGuid;
const tagUrl = `/api/v1/Dealer/Tag/${guid}`;
const assignUrl = `/api/v1/Dealer/Tags/Assign/${guid}`;
const removeUrl = `/api/v1/Dealer/Tags/Remove/${guid}`;
const inventoryUrl = '/api/v1/Inventory/GetInventory';
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
const ok = (res: APIResponse) => config.passStatuses.includes(res.status());

const searchBody = (extra: Record<string, unknown>) => ({
  dealerId: String(IDS.dealerId), itemType: '', search: '', mfrCode: '', availability: '', categoryId: '',
  condition: 'New', modelCode: '', tag: '', pageNumber: 0, pageSize: 10, ...extra,
});

// Tags on inventory parts: assign -> filter and tagDetails in GetInventory -> remove.
// Reversible: tags are removed from the part and deleted at the end (also in afterAll if a step fails).
test.describe.serial('Flow: tag an inventory part -> find it in GetInventory -> untag', () => {
  const stamp = Date.now();
  let partId = '';
  let tagA = 0;
  let tagB = 0;
  let assignedA = false;
  let assignedB = false;

  const inventory = async (request: any, extra: Record<string, unknown>) =>
    json(await request.post(inventoryUrl, { headers, data: searchBody(extra), timeout: config.timeoutMs }));
  const createTag = async (request: any, label: string) => {
    const res = await request.post(tagUrl, {
      headers,
      data: { tagId: 0, name: `AUTOMATION-${label}-${stamp}`, description: 'inventory tag test', color: '#123456', isActive: true, category: 'Inventory' },
      timeout: config.timeoutMs,
    });
    const body = await json(res);
    expect(ok(res), `create tag: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`).toBe(true);
    return body.data.tagId as number;
  };

  test('1. Setup: pick a part and create two Inventory-category tags', async ({ request }) => {
    const body = await inventory(request, { search: DATA.searchPart.search });
    expect(body.data.inventory.length, 'test part not found').toBeGreaterThan(0);
    partId = body.data.inventory[0].inventoryPartId;
    expect(partId).toBeTruthy();
    tagA = await createTag(request, 'A');
    tagB = await createTag(request, 'B');
    expect(tagA).toBeGreaterThan(0);
    expect(tagB).toBeGreaterThan(0);
  });

  test('2. Assign tag A to the part returns assignedCount 1', async ({ request }) => {
    test.skip(!partId, 'setup failed');
    const res = await request.post(assignUrl, { headers, data: { tagIds: [tagA], inventoryParts: [{ inventoryPartId: partId }] }, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `assign: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`).toContain(res.status());
    expect(body.data.assignedCount).toBe(1);
    assignedA = true;
  });

  test('3. GetInventory tag filter returns the part and tagDetails lists the tag', async ({ request }) => {
    test.skip(!assignedA, 'tag was not assigned');
    const body = await inventory(request, { tag: String(tagA) });
    expect(body.data.totalCount).toBe(1);
    const item = body.data.inventory[0];
    expect(item.inventoryPartId).toBe(partId);
    expect(item.tagDetails).toEqual([expect.objectContaining({ tagId: tagA, name: `AUTOMATION-A-${stamp}`, color: '#123456' })]);
  });

  test('4. Assigning the same tag again assigns 0 and does not duplicate it', async ({ request }) => {
    test.skip(!assignedA, 'tag was not assigned');
    const res = await request.post(assignUrl, { headers, data: { tagIds: [tagA], inventoryParts: [{ inventoryPartId: partId }] }, timeout: config.timeoutMs });
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    expect((await json(res)).data.assignedCount).toBe(0);
    const body = await inventory(request, { search: DATA.searchPart.search });
    expect(body.data.inventory[0].tagDetails.filter((t: any) => t.tagId === tagA)).toHaveLength(1);
  });

  test('5. Two tags on one part: comma-joined filter finds it and tagDetails lists both', async ({ request }) => {
    test.skip(!assignedA, 'tag was not assigned');
    const res = await request.post(assignUrl, { headers, data: { tagIds: [tagB], inventoryParts: [{ inventoryPartId: partId }] }, timeout: config.timeoutMs });
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    assignedB = true;
    const body = await inventory(request, { tag: `${tagA},${tagB}` });
    expect(body.data.totalCount).toBe(1);
    expect(body.data.inventory[0].tagDetails.map((t: any) => t.tagId).sort()).toEqual([tagA, tagB].sort());
  });

  test('6. Remove tag A returns removedCount 1; it no longer matches the filter', async ({ request }) => {
    test.skip(!assignedA, 'tag was not assigned');
    const res = await request.post(removeUrl, { headers, data: { tagIds: [tagA], inventoryParts: [{ inventoryPartId: partId }] }, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `remove: HTTP ${res.status()}`).toContain(res.status());
    expect(body.data.removedCount).toBe(1);
    assignedA = false;
    expect((await inventory(request, { tag: String(tagA) })).data.totalCount).toBe(0);
    const part = (await inventory(request, { search: DATA.searchPart.search })).data.inventory[0];
    expect(part.tagDetails.map((t: any) => t.tagId)).not.toContain(tagA);
    expect(part.tagDetails.map((t: any) => t.tagId)).toContain(tagB);
  });

  test('7. Removing it again removes 0', async ({ request }) => {
    test.skip(!tagA, 'setup failed');
    const res = await request.post(removeUrl, { headers, data: { tagIds: [tagA], inventoryParts: [{ inventoryPartId: partId }] }, timeout: config.timeoutMs });
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    expect((await json(res)).data.removedCount).toBe(0);
  });

  test('8. Cleanup: remove tag B and delete both tags; the part is untagged again', async ({ request }) => {
    test.skip(!tagA, 'setup failed');
    const res = await request.post(removeUrl, { headers, data: { tagIds: [tagB], inventoryParts: [{ inventoryPartId: partId }] }, timeout: config.timeoutMs });
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    assignedB = false;
    for (const id of [tagA, tagB]) {
      const del = await request.delete(`${tagUrl}/${id}`, { headers, timeout: config.timeoutMs });
      expect(ok(del), `delete tag ${id}: HTTP ${del.status()}`).toBe(true);
    }
    const part = (await inventory(request, { search: DATA.searchPart.search })).data.inventory[0];
    expect(part.tagDetails ?? []).toEqual([]);
    tagA = 0;
    tagB = 0;
  });

  test.afterAll(async () => {
    if (!tagA && !tagB) return;
    const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
    for (const id of [tagA, tagB].filter(Boolean)) {
      await ctx.post(removeUrl, { headers, data: { tagIds: [id], inventoryParts: [{ inventoryPartId: partId }] } });
      const res = await ctx.delete(`${tagUrl}/${id}`, { headers });
      console.log(`Cleanup: tag ${id} removed from part and deleted: HTTP ${res.status()}`);
    }
    await ctx.dispose();
    void assignedB;
  });
});

// Validation for the tag assign/remove requests (nothing is changed).
test.describe('Tag assign validation (inventory targets)', () => {
  test('Assign with no tag ids is rejected with 400', async ({ request }) => {
    const res = await request.post(assignUrl, { headers, data: { tagIds: [], inventoryParts: [{ inventoryPartId: DATA.searchPart.inventoryPartId }] }, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('At least one TagId is required');
  });

  test('Assign with no targets is rejected with 400', async ({ request }) => {
    const res = await request.post(assignUrl, { headers, data: { tagIds: [1] }, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('At least one of Invoices, InventoryParts, InventoryWGs, InventoryModels, or Customers is required');
  });

  test('Assign with an empty part id is rejected with 400', async ({ request }) => {
    const res = await request.post(assignUrl, { headers, data: { tagIds: [1], inventoryParts: [{ inventoryPartId: '' }] }, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('InventoryPartId is required');
  });

  test('Assign with customerId 0 is rejected with 400', async ({ request }) => {
    const res = await request.post(assignUrl, { headers, data: { tagIds: [1], customers: [{ customerId: 0 }] }, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('CustomerId must be greater than 0');
  });

  test('Remove with no targets is rejected with 400', async ({ request }) => {
    const res = await request.post(removeUrl, { headers, data: { tagIds: [1] }, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
  });

  test('Assign an unknown tag id is rejected (not a success status)', async ({ request }) => {
    const res = await request.post(assignUrl, { headers, data: { tagIds: [99999999], inventoryParts: [{ inventoryPartId: DATA.searchPart.inventoryPartId }] }, timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('tags not found');
  });
});
