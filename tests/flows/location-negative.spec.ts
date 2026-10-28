import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import * as crypto from 'crypto';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { headers, json } from '../../src/warranty-helpers';
import { Location, currentLocation, loadLocations } from '../../src/location-helpers';

test.beforeEach(pace);

/**
 * Bad input to the location-scoped endpoints that the API already refuses correctly. These must keep passing (they guard the current behaviour).
 * The cases where the API answers wrongly (502 instead of 404, a body that names another location ...) live in tests/defects/server-defects.spec.ts and stay red.
 * Nothing here is hard-coded to a dealer: the location comes from Dealer/Locations at run time.
 */
test.describe('Location negative cases: bad input is refused', () => {
  let here: Location;
  const withGuid = (path: string) => path.replace('{guid}', here.dealerGuid);
  const text = async (res: any) => JSON.stringify(await json(res)).slice(0, 220);

  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: config.baseUrl });
    const res = await ctx.get(`/api/v1/Dealer/Locations/${config.dealerGuid}`, { headers });
    const locations = ((await res.json().catch(() => ({}))).data ?? []) as Location[];
    await ctx.dispose();
    here = currentLocation(locations) ?? ({ dealerId: config.dealerId, dealerGuid: config.dealerGuid, dmsLocationId: 0, name: 'current' } as Location);
  });

  // ---- the dealer GUID in the URL ----
  test('NEG-01 Dealer/Locations with a malformed GUID is a 400', async ({ request }) => {
    const res = await request.get('/api/v1/Dealer/Locations/not-a-guid', { headers, timeout: config.timeoutMs });
    expect(res.status(), await text(res)).toBe(400);
  });

  test('NEG-02 Order/All with a malformed GUID is a 400', async ({ request }) => {
    const res = await request.get('/api/v1/Order/All/not-a-guid?WithCount=true', { headers, timeout: config.timeoutMs });
    expect(res.status(), await text(res)).toBe(400);
  });

  test('NEG-06 Dealer/Locations with the all-zero GUID is refused with a 4xx', async ({ request }) => {
    const res = await request.get('/api/v1/Dealer/Locations/00000000-0000-0000-0000-000000000000', { headers, timeout: config.timeoutMs });
    expect(res.status(), await text(res)).toBeGreaterThanOrEqual(400);
    expect(res.status(), await text(res)).toBeLessThan(500);
  });

  test('NEG-08 Wholegoods and SalesReps for a GUID that does not exist are a 404', async ({ request }) => {
    const unknown = crypto.randomUUID();
    for (const path of [`/api/v1/Inventory/Wholegoods/${unknown}?PageNumber=1&PageSize=1`, `/api/v1/Dealer/SalesReps?DealerGuid=${unknown}`]) {
      const res = await request.get(path, { headers, timeout: config.timeoutMs });
      expect(res.status(), `${path.split('?')[0]}: ${await text(res)}`).toBe(404);
    }
  });

  test('NEG-18 An order posted to a GUID that does not exist is refused', async ({ request }) => {
    const res = await request.post(`/api/v1/Order/${crypto.randomUUID()}`, { headers, data: { dealerId: here.dealerId, orderId: 0 }, timeout: config.timeoutMs });
    expect(config.passStatuses, `HTTP ${res.status()}: ${await text(res)}`).not.toContain(res.status());
  });

  // ---- the login ----
  test('NEG-03 Locations, orders and customers without a token are a 401', async ({ request }) => {
    for (const path of [`/api/v1/Dealer/Locations/${here.dealerGuid}`, `/api/v1/Order/All/${here.dealerGuid}?WithCount=true`, `/api/v1/Customer/All?DealerGuid=${here.dealerGuid}&PageNumber=1&PageSize=1`]) {
      const res = await request.get(path, { timeout: config.timeoutMs });
      expect(res.status(), path.split('?')[0]).toBe(401);
    }
  });

  test('NEG-04 Locations and orders with a garbage token are a 401', async ({ request }) => {
    for (const path of [`/api/v1/Dealer/Locations/${here.dealerGuid}`, `/api/v1/Order/All/${here.dealerGuid}?WithCount=true`]) {
      const res = await request.get(path, { headers: { Authorization: 'Bearer abc.def.ghi' }, timeout: config.timeoutMs });
      expect(res.status(), path.split('?')[0]).toBe(401);
    }
  });

  // ---- the order id ----
  test('NEG-09 Reading an order with OrderId 0 is a 400', async ({ request }) => {
    const res = await request.get(withGuid('/api/v1/Order/{guid}?OrderId=0'), { headers, timeout: config.timeoutMs });
    expect(res.status(), await text(res)).toBe(400);
  });

  // ---- the location id parameters ----
  for (const [name, path, value] of [
    ['NEG-11 Inventory counts with LocationId abc', '/api/v1/Inventory/Count/{guid}?LocationId=abc', 400],
    ['NEG-12 Inventory counts with LocationId -1', '/api/v1/Inventory/Count/{guid}?LocationId=-1', 400],
    ['NEG-14 Purchase orders with LocationId abc', '/api/v1/PurchaseOrder/{guid}?LocationId=abc', 400],
    ['NEG-15 Wholegoods with DmsLocationId abc', '/api/v1/Inventory/Wholegoods/{guid}?DmsLocationId=abc', 400],
    ['NEG-17 Dealer configuration without Source', '/api/v1/Dealer/Configuration/{guid}?EntityName=Setup', 400],
  ] as [string, string, number][]) {
    test(`${name} is a ${value}`, async ({ request }) => {
      const res = await request.get(withGuid(path), { headers, timeout: config.timeoutMs });
      expect(res.status(), await text(res)).toBe(value);
    });
  }

  // ---- the Inventory tab ----
  test('NEG-21 The inventory list of a location only holds parts stocked at that location', async ({ request }) => {
    const { locations } = await loadLocations(request);
    const list = async (l: Location, search = '') => (await json(await request.post('/api/v1/Inventory/GetInventory', {
      headers, timeout: config.timeoutMs,
      data: { dealerId: String(l.dealerId), itemType: '', search, mfrCode: '', availability: '', categoryId: '', condition: 'New', modelCode: '', tag: '', pageNumber: 0, pageSize: 20 },
    }))).data;
    const other = locations.find((l) => l.dealerId !== here.dealerId);
    test.skip(!other, 'this company has only one location');
    const first = (await list(other!)).inventory?.[0];
    test.skip(!first, `${other!.name} has no inventory`);
    // searched at either location, every hit must name the location that was asked as one of its stocking locations
    for (const l of [other!, here]) {
      for (const item of (await list(l, first.partNumber)).inventory ?? []) {
        expect(item.otherLocation.map((o: any) => o.dealerId), `${item.inventoryPartId} asked at ${l.name}`).toContain(l.dealerId);
      }
    }
  });

  test('NEG-16 Wholegoods filtered by a DMS location no location has is an empty list', async ({ request }) => {
    const res = await request.get(withGuid('/api/v1/Inventory/Wholegoods/{guid}?DmsLocationId=999999&PageNumber=1&PageSize=5'), { headers, timeout: config.timeoutMs });
    expect(res.status(), await text(res)).toBe(200);
    const body = await json(res);
    expect(body.data.units, 'units').toEqual([]);
    expect(body.data.totalCount, 'totalCount').toBe(0);
  });
});
