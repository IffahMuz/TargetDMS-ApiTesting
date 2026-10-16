import { test, expect, request as pwRequest, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import { config, tokenPath } from '../../src/config';
import { IDS } from '../../src/get-calls/types';
import { pace } from '../../src/pace';

test.beforeEach(pace);

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const guid = config.dealerGuid;
const tagUrl = `/api/v1/Dealer/Tag/${guid}`;
const listUrl = `/api/v1/Dealer/Tags/${guid}`;
const assignUrl = `/api/v1/Dealer/Tags/Assign/${guid}`;
const removeUrl = `/api/v1/Dealer/Tags/Remove/${guid}`;
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
const ok = (res: APIResponse) => config.passStatuses.includes(res.status());

// Flow for the dealer tag APIs. Tags are reversible: delete removes the tag, remove un-assigns it.
test.describe.serial('Flow: tag create -> list -> update -> assign -> remove -> delete', () => {
  const name = `AUTOMATION-${Date.now()}`;
  let tagId = 0;
  let assigned = false;
  let deleted = false;
  const target = { tagIds: [] as number[], customers: [{ customerId: IDS.customerId }] };

  const search = (request: any, text: string) =>
    request.get(`${listUrl}?PageNumber=1&PageSize=10&Search=${encodeURIComponent(text)}`, { headers, timeout: config.timeoutMs });

  test('1. POST create tag returns 200/201/204 and a tag id', async ({ request }) => {
    const res = await request.post(tagUrl, {
      headers,
      data: { tagId: 0, name, description: 'automation test tag', color: '#FF0000', isActive: true, category: 'Customer' },
      timeout: config.timeoutMs,
    });
    const body = await json(res);
    tagId = Number(body?.data?.tagId ?? 0);
    expect(config.passStatuses, `create: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 300)}`).toContain(res.status());
    expect(tagId, 'no tagId returned').toBeGreaterThan(0);
    expect(body.data.name).toBe(name);
    expect(body.data.category).toBe('Customer');
    target.tagIds = [tagId];
  });

  test('2. GET tags search finds the new tag', async ({ request }) => {
    test.skip(!tagId, 'tag was not created');
    const body = await json(await search(request, name));
    expect(body.data.totalCount).toBe(1);
    expect(body.data.items[0].tagId).toBe(tagId);
    expect(body.data.items[0].color).toBe('#FF0000');
  });

  test('3. POST update tag changes name, color and description', async ({ request }) => {
    test.skip(!tagId, 'tag was not created');
    const res = await request.post(tagUrl, {
      headers,
      data: { tagId, name: `${name}-upd`, description: 'updated', color: '#00FF00', isActive: true, category: 'Customer' },
      timeout: config.timeoutMs,
    });
    expect(ok(res), `update: HTTP ${res.status()}`).toBe(true);
    const body = await json(await search(request, `${name}-upd`));
    expect(body.data.totalCount).toBe(1);
    expect(body.data.items[0]).toMatchObject({ tagId, color: '#00FF00', description: 'updated' });
  });

  test('4. POST assign tag to a customer returns assignedCount 1', async ({ request }) => {
    test.skip(!tagId, 'tag was not created');
    const res = await request.post(assignUrl, { headers, data: target, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `assign: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 300)}`).toContain(res.status());
    expect(body.data.assignedCount).toBe(1);
    assigned = true;
  });

  test('5. Assigning the same tag again is accepted but assigns 0', async ({ request }) => {
    test.skip(!assigned, 'tag was not assigned');
    const res = await request.post(assignUrl, { headers, data: target, timeout: config.timeoutMs });
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    expect((await json(res)).data.assignedCount).toBe(0);
  });

  test('6. POST remove tag from the customer returns removedCount 1', async ({ request }) => {
    test.skip(!assigned, 'tag was not assigned');
    const res = await request.post(removeUrl, { headers, data: target, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `remove: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 300)}`).toContain(res.status());
    expect(body.data.removedCount).toBe(1);
    assigned = false;
  });

  test('7. Removing it again is accepted but removes 0', async ({ request }) => {
    test.skip(!tagId, 'tag was not created');
    const res = await request.post(removeUrl, { headers, data: target, timeout: config.timeoutMs });
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    expect((await json(res)).data.removedCount).toBe(0);
  });

  test('8. DELETE tag returns 200/201/204 and it disappears from the list', async ({ request }) => {
    test.skip(!tagId, 'tag was not created');
    const res = await request.delete(`${tagUrl}/${tagId}`, { headers, timeout: config.timeoutMs });
    deleted = ok(res);
    expect(config.passStatuses, `delete: HTTP ${res.status()} ${(await res.text()).slice(0, 300)}`).toContain(res.status());
    const body = await json(await search(request, name));
    expect(body.data.totalCount).toBe(0);
    expect(body.data.items).toEqual([]);
  });

  test.afterAll(async () => {
    if (!tagId || deleted) return;
    const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
    if (assigned) await ctx.post(removeUrl, { headers, data: target });
    const res = await ctx.delete(`${tagUrl}/${tagId}`, { headers });
    await ctx.dispose();
    console.log(`Cleanup delete of tag ${tagId}: HTTP ${res.status()}`);
  });
});

// Independent validation checks (no data is created).
test.describe('Tag API validation', () => {
  test('Create without name and color is rejected with 400', async ({ request }) => {
    const res = await request.post(tagUrl, { headers, data: { tagId: 0, description: 'x' }, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    const text = JSON.stringify(await json(res));
    expect(text).toContain('Name is required');
    expect(text).toContain('Color is required');
  });

  test('Delete an unknown tag id is rejected (not a success status)', async ({ request }) => {
    const res = await request.delete(`${tagUrl}/99999999`, { headers, timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('not found');
  });

  test('List with pageNumber 0 is rejected (paging is 1-based)', async ({ request }) => {
    const res = await request.get(`${listUrl}?PageNumber=0&PageSize=10`, { headers, timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('PageNumber must be greater than 0');
  });

  test('Assign with no tag ids is rejected', async ({ request }) => {
    const res = await request.post(assignUrl, { headers, data: { tagIds: [], customers: [{ customerId: IDS.customerId }] }, timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
  });
});
