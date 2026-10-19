import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { guid, headers, json } from '../../src/warranty-helpers';

test.beforeEach(pace);

const counts = `/api/v1/Inventory/Count/${guid}`;
const detail = (countId: number, qs = 'PageNumber=1&PageSize=5') => `/api/v1/Inventory/Count/Detail/${guid}/${countId}?${qs}`;
const update = (request: any, countId: number, items: unknown) => request.put(`${counts}/${countId}`, { headers, data: items, timeout: config.timeoutMs });
// An id that cannot exist, so no request below can change real data.
const NO_COUNT = 99999999;
const NO_ITEM = 999999999;

// Inventory counts can only be listed, read and updated through this API (there is no way to create one), and this dealer currently has none.
// So the update flow below runs only when a count exists; the other tests use ids that cannot exist and change nothing.
test.describe.serial('Inventory count: change one counted item and put it back', () => {
  let countId = 0;
  let original: { itemId: number; quantity: number; binLocation: string } | undefined;

  test('1. Find a count that has items (skipped when the dealer has no counts)', async ({ request }) => {
    const list = (await json(await request.get(`${counts}?PageNumber=1&PageSize=50`, { headers, timeout: config.timeoutMs }))).data;
    const withItems = list.items.find((c: any) => c.items > 0);
    test.skip(!withItems, 'This dealer has no inventory counts, and the API cannot create one.');
    countId = withItems.countId;
    const first = (await json(await request.get(detail(countId, 'PageNumber=1&PageSize=1'), { headers, timeout: config.timeoutMs }))).data.items[0];
    original = { itemId: first.itemId, quantity: first.quantity, binLocation: first.binLocation ?? '' };
  });

  test('2. Changing the quantity and bin location of one item updates exactly one item', async ({ request }) => {
    test.skip(!original, 'no count to use');
    const res = await update(request, countId, [{ itemId: original!.itemId, quantity: original!.quantity + 1, binLocation: 'AUTOMATION' }]);
    const body = await json(res);
    expect(config.passStatuses, JSON.stringify(body).slice(0, 250)).toContain(res.status());
    expect(body.data).toEqual({ updatedCount: 1, notFoundItemIds: [] });
  });

  test('3. The count shows the new quantity and bin location', async ({ request }) => {
    test.skip(!original, 'no count to use');
    const items = (await json(await request.get(detail(countId, 'PageNumber=1&PageSize=100'), { headers, timeout: config.timeoutMs }))).data.items;
    expect(items.find((i: any) => i.itemId === original!.itemId)).toMatchObject({ quantity: original!.quantity + 1, binLocation: 'AUTOMATION' });
  });

  test('4. Put the original quantity and bin location back', async ({ request }) => {
    test.skip(!original, 'no count to use');
    const res = await update(request, countId, [{ itemId: original!.itemId, quantity: original!.quantity, binLocation: original!.binLocation }]);
    expect(config.passStatuses).toContain(res.status());
    const items = (await json(await request.get(detail(countId, 'PageNumber=1&PageSize=100'), { headers, timeout: config.timeoutMs }))).data.items;
    expect(items.find((i: any) => i.itemId === original!.itemId)).toMatchObject({ quantity: original!.quantity, binLocation: original!.binLocation });
  });

  test.afterAll(async ({ request }) => {
    // If a step failed after the change, try to restore the original values.
    if (original && countId) await update(request, countId, [{ itemId: original.itemId, quantity: original.quantity, binLocation: original.binLocation }]);
  });
});

test.describe('Inventory count: reading and bad requests', () => {
  test('The count list has the paging fields and a list of counts', async ({ request }) => {
    const body = await json(await request.get(`${counts}?PageNumber=1&PageSize=10`, { headers, timeout: config.timeoutMs }));
    expect(body.data).toMatchObject({ pageNumber: 1, pageSize: 10 });
    expect(body.data.totalCount).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(body.data.items)).toBe(true);
  });

  test('A count that does not exist shows an empty page, not an error', async ({ request }) => {
    const body = await json(await request.get(detail(NO_COUNT), { headers, timeout: config.timeoutMs }));
    expect(body.data).toMatchObject({ totalCount: 0, items: [] });
  });

  test('Page number 0 is refused for the list and for a count', async ({ request }) => {
    const list = await request.get(`${counts}?PageNumber=0&PageSize=5`, { headers, timeout: config.timeoutMs });
    const one = await request.get(detail(1, 'PageNumber=0&PageSize=5'), { headers, timeout: config.timeoutMs });
    expect(list.status()).toBe(400);
    expect(one.status()).toBe(400);
    expect(JSON.stringify(await json(list))).toContain('PageNumber must be greater than 0');
  });

  test('A page size over 100 is refused', async ({ request }) => {
    const res = await request.get(`${counts}?PageNumber=1&PageSize=101`, { headers, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('PageSize must not exceed 100');
  });

  test('Updating a count that does not exist changes nothing and reports the item as not found', async ({ request }) => {
    const res = await update(request, NO_COUNT, [{ itemId: NO_ITEM, quantity: 1, binLocation: 'AUTO' }]);
    const body = await json(res);
    expect(config.passStatuses, JSON.stringify(body).slice(0, 200)).toContain(res.status());
    expect(body.data).toEqual({ updatedCount: 0, notFoundItemIds: [NO_ITEM] });
  });

  test('Updating count number 0 is refused', async ({ request }) => {
    const res = await update(request, 0, [{ itemId: NO_ITEM, quantity: 1, binLocation: 'A' }]);
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('Count ID must be greater than 0');
  });

  test('An empty update list is refused', async ({ request }) => {
    const res = await update(request, NO_COUNT, []);
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('At least one inventory count line item is required');
  });

  test('An item number of 0 is refused', async ({ request }) => {
    const res = await update(request, NO_COUNT, [{ itemId: 0, quantity: 1, binLocation: 'A' }]);
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('itemId must be greater than 0');
  });

  test('A negative quantity is refused', async ({ request }) => {
    const res = await update(request, NO_COUNT, [{ itemId: NO_ITEM, quantity: -1, binLocation: 'A' }]);
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('quantity cannot be negative');
  });
});
