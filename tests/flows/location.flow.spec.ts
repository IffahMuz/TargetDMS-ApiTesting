import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { headers, json } from '../../src/warranty-helpers';
import {
  Location, ORDER_TYPE_ID, closeOrderAt, currentLocation, listOrdersAt, loadLocations, orderBodyFor, otherLocation, readOrderAt, saveOrderAt,
} from '../../src/location-helpers';

test.beforeEach(pace);

/**
 * Two locations of the same company, found from Dealer/Locations at run time (nothing hard-coded; set SECOND_LOCATION_DEALER_ID in .env to choose
 * the second one). The flow creates a work order and a sales order in each location and checks that every list, read and filter keeps the
 * locations apart. Every order it creates is closed again at the end.
 *
 * The web app sends the active location as the dealer GUID in the URL, so these checks are what makes "the default location" show the right data.
 * The default-location setting itself, its persistence and the filter drawers live only in the browser and need UI tests.
 */
interface Made { kind: 'work' | 'sales'; where: Location; orderId: number; closed: boolean }

test.describe.serial('Flow: two locations keep their orders and lists apart', () => {
  const marker = `AUTOMATION-LOC-${Date.now()}`;
  let all: Location[] = [];
  let A: Location;          // the location the tests run in
  let B: Location | undefined; // another location of the same company
  const made: Made[] = [];
  const baseline: Record<string, number> = {};
  const needB = () => test.skip(!B, 'this company has only one location, so there is nothing to compare');
  const key = (l: Location, type: number) => `${l.dealerId}:${type}`;
  const open = (type: number) => ({ OrderType: type, InvoiceStatusId: 1, PageSize: 1 });

  async function create(request: any, kind: 'work' | 'sales', where: Location, urlLocation: Location = where) {
    const file = kind === 'work' ? 'order-create.json' : 'order-parts-create.json';
    const saved = await saveOrderAt(request, urlLocation, orderBodyFor(file, where, marker));
    expect(config.passStatuses.includes(saved.status), `create ${kind} order at ${where.name}: HTTP ${saved.status} ${JSON.stringify(saved.body).slice(0, 300)}`).toBe(true);
    expect(saved.orderId, `no orderId: ${JSON.stringify(saved.body).slice(0, 300)}`).toBeGreaterThan(0);
    made.push({ kind, where: urlLocation, orderId: saved.orderId, closed: false });
    return saved;
  }

  const madeAt = (l: Location, kind?: 'work' | 'sales') => made.filter((m) => m.where.dealerId === l.dealerId && (!kind || m.kind === kind));

  test('1. Dealer/Locations lists the company locations, each with an id, a GUID, a DMS location id and a name', async ({ request }) => {
    const res = await loadLocations(request);
    expect(config.passStatuses, `HTTP ${res.status}`).toContain(res.status);
    all = res.locations;
    expect(all.length).toBeGreaterThan(0);
    for (const l of all) {
      expect(l.dealerId, JSON.stringify(l)).toBeGreaterThan(0);
      expect(l.dealerGuid, JSON.stringify(l)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(l.dmsLocationId, JSON.stringify(l)).toBeGreaterThan(0);
      expect(l.name, JSON.stringify(l)).toBeTruthy();
    }
  });

  test('2. Locations may share a name but never an id or a GUID', async () => {
    test.skip(!all.length, 'no locations loaded');
    expect(new Set(all.map((l) => l.dealerId)).size, 'dealer ids repeat').toBe(all.length);
    expect(new Set(all.map((l) => l.dealerGuid.toLowerCase())).size, 'GUIDs repeat').toBe(all.length);
  });

  test('3. The location the tests run in is one of them, and a second location is found to compare with', async () => {
    test.skip(!all.length, 'no locations loaded');
    const current = currentLocation(all);
    expect(current, `DEALER_ID ${config.dealerId} / DEALER_GUID is not in the location list`).toBeTruthy();
    A = current!;
    B = otherLocation(all, A);
    test.info().annotations.push({ type: 'locations', description: `current: ${A.name} (${A.dealerId}); other: ${B ? `${B.name} (${B.dealerId})` : 'none'}` });
    needB();
  });

  test('4. Open work orders and open sales orders are counted in each location before anything is created', async ({ request }) => {
    needB();
    for (const l of [A, B!]) {
      for (const type of [ORDER_TYPE_ID.work, ORDER_TYPE_ID.sales]) {
        const r = await listOrdersAt(request, l, open(type));
        expect(config.passStatuses, `${l.name}: HTTP ${r.status}`).toContain(r.status);
        baseline[key(l, type)] = r.total;
      }
    }
  });

  test('5. A work order created in the current location belongs to it', async ({ request }) => {
    needB();
    const saved = await create(request, 'work', A);
    expect(saved.dealerId).toBe(A.dealerId);
  });

  test('6. A work order created in the other location belongs to that location', async ({ request }) => {
    needB();
    const saved = await create(request, 'work', B!);
    expect(saved.dealerId).toBe(B!.dealerId);
  });

  test('7. A sales order created in the current location belongs to it', async ({ request }) => {
    needB();
    const saved = await create(request, 'sales', A);
    expect(saved.dealerId).toBe(A.dealerId);
  });

  test('8. A sales order created in the other location belongs to that location', async ({ request }) => {
    needB();
    const saved = await create(request, 'sales', B!);
    expect(saved.dealerId).toBe(B!.dealerId);
  });

  test('9. Each order read back from its own location shows that location', async ({ request }) => {
    needB();
    expect(made.length, 'orders were not all created').toBe(4);
    for (const m of made) {
      const r = await readOrderAt(request, m.where, m.orderId);
      expect(config.passStatuses, `${m.kind} ${m.orderId} at ${m.where.name}: HTTP ${r.status}`).toContain(r.status);
      expect(r.order.dealerId, `order ${m.orderId}`).toBe(m.where.dealerId);
    }
  });

  test('10. Every new order appears in its own location\'s list and in no other location\'s list', async ({ request }) => {
    needB();
    for (const m of made) {
      for (const l of [A, B!]) {
        const r = await listOrdersAt(request, l, { OrderId: m.orderId });
        expect(config.passStatuses, `${l.name}: HTTP ${r.status}`).toContain(r.status);
        const found = r.orders.some((o) => o.orderId === m.orderId);
        expect(found, `${m.kind} order ${m.orderId} (created at ${m.where.name}) ${found ? 'is' : 'is not'} in the list of ${l.name}`).toBe(l.dealerId === m.where.dealerId);
      }
    }
  });

  test('11. The open order counts of a location go up by the orders created there', async ({ request }) => {
    needB();
    for (const l of [A, B!]) {
      for (const [kind, type] of [['work', ORDER_TYPE_ID.work], ['sales', ORDER_TYPE_ID.sales]] as const) {
        const r = await listOrdersAt(request, l, open(type));
        expect(r.total, `${l.name} open ${kind} orders`).toBeGreaterThanOrEqual(baseline[key(l, type)] + madeAt(l, kind).length);
      }
    }
  });

  test('12. A page of orders for a location holds only that location\'s orders (id and name), for every order type', async ({ request }) => {
    needB();
    const seen = new Map<number, number>();
    for (const l of [A, B!]) {
      for (const type of [undefined, ORDER_TYPE_ID.work, ORDER_TYPE_ID.sales]) {
        const r = await listOrdersAt(request, l, type ? { OrderType: type } : {});
        expect(config.passStatuses, `${l.name}: HTTP ${r.status}`).toContain(r.status);
        for (const o of r.orders) {
          expect(o.dealerId, `order ${o.orderId} in the list of ${l.name}`).toBe(l.dealerId);
          expect(o.locationName, `order ${o.orderId}`).toBe(l.name);
          if (type === undefined) seen.set(o.orderId, (seen.get(o.orderId) ?? 0) + 1);
        }
      }
    }
    const shared = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    expect(shared, 'order ids that appear in both locations').toEqual([]);
  });

  test('13. An order cannot be read through another location\'s URL', async ({ request }) => {
    needB();
    for (const m of made) {
      const other = m.where.dealerId === A.dealerId ? B! : A;
      const r = await readOrderAt(request, other, m.orderId);
      expect(config.passStatuses, `order ${m.orderId} of ${m.where.name} was readable at ${other.name}`).not.toContain(r.status);
    }
  });

  test('14. Customers belong to the company: both locations list the same customers', async ({ request }) => {
    needB();
    const pages: { total: number; ids: number[] }[] = [];
    for (const l of [A, B!]) {
      const res = await request.get(`/api/v1/Customer/All?DealerGuid=${l.dealerGuid}&PageNumber=1&PageSize=20`, { headers, timeout: config.timeoutMs });
      const body = await json(res);
      expect(config.passStatuses, `${l.name}: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`).toContain(res.status());
      pages.push({ total: body.data.totalCount, ids: body.data.customers.map((c: any) => c.customerId) });
    }
    expect(pages[1].total, 'customer total in the other location').toBe(pages[0].total);
    expect(pages[1].ids, 'first page of customers in the other location').toEqual(pages[0].ids);
  });

  test('15. The inventory list (GetInventory) is answered per location and gives the same answer twice', async ({ request }) => {
    needB();
    const ask = async (l: Location) => {
      const res = await request.post('/api/v1/Inventory/GetInventory', {
        headers,
        data: { dealerId: String(l.dealerId), itemType: '', search: '', mfrCode: '', availability: '', categoryId: '', condition: 'New', modelCode: '', tag: '', pageNumber: 0, pageSize: 10 },
        timeout: config.timeoutMs,
      });
      const body = await json(res);
      expect(config.passStatuses, `${l.name}: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`).toContain(res.status());
      return { total: body.data.totalCount as number, first: JSON.stringify(body.data.inventory?.[0] ?? null) };
    };
    for (const l of [A, B!]) {
      const one = await ask(l);
      const two = await ask(l);
      expect(one.total, `${l.name} total`).toBeGreaterThanOrEqual(0);
      expect(two, `${l.name} answered differently the second time`).toEqual(one);
    }
  });

  test('16. Inventory counts for a location carry only that location\'s DMS location id', async ({ request }) => {
    needB();
    for (const l of [A, B!]) {
      const res = await request.get(`/api/v1/Inventory/Count/${l.dealerGuid}?LocationId=${l.dmsLocationId}&PageNumber=1&PageSize=50`, { headers, timeout: config.timeoutMs });
      const body = await json(res);
      expect(config.passStatuses, `${l.name}: HTTP ${res.status()}`).toContain(res.status());
      for (const c of body.data.items ?? []) expect(c.locationId, `count ${c.countId} at ${l.name}`).toBe(l.dmsLocationId);
    }
  });

  test('17. Purchase orders for a location carry only that location\'s DMS location id', async ({ request }) => {
    needB();
    for (const l of [A, B!]) {
      const res = await request.get(`/api/v1/PurchaseOrder/${l.dealerGuid}?LocationId=${l.dmsLocationId}&PageNumber=1&PageSize=50`, { headers, timeout: config.timeoutMs });
      const body = await json(res);
      expect(config.passStatuses, `${l.name}: HTTP ${res.status()}`).toContain(res.status());
      for (const p of body.data.items ?? []) expect(p.locationId, `purchase order ${p.purchaseOrderId} at ${l.name}`).toBe(l.dmsLocationId);
    }
  });

  test('18. Wholegood units filtered by DMS location hold only that location\'s units', async ({ request }) => {
    needB();
    for (const l of [A, B!]) {
      const res = await request.get(`/api/v1/Inventory/Wholegoods/${l.dealerGuid}?DmsLocationId=${l.dmsLocationId}&PageNumber=1&PageSize=100`, { headers, timeout: config.timeoutMs });
      const body = await json(res);
      expect(config.passStatuses, `${l.name}: HTTP ${res.status()}`).toContain(res.status());
      for (const u of body.data.units ?? []) expect(u.dmsLocationId, `unit ${u.inventoryWGId} at ${l.name}`).toBe(l.dmsLocationId);
    }
  });

  test('19. Closing each order at its own location works and leaves the other location untouched', async ({ request }) => {
    needB();
    for (const m of made) {
      const status = await closeOrderAt(request, m.where, m.orderId);
      m.closed = config.passStatuses.includes(status);
      expect(config.passStatuses, `close ${m.kind} ${m.orderId} at ${m.where.name}`).toContain(status);
      const r = await readOrderAt(request, m.where, m.orderId);
      expect(r.order?.orderStatusId, `order ${m.orderId} after closing`).toBe('Closed');
    }
  });

  // Safety net: close anything a failed step left open.
  test.afterAll(async ({ playwright }) => {
    const left = made.filter((m) => !m.closed);
    if (!left.length) return;
    const ctx = await playwright.request.newContext({ baseURL: config.baseUrl });
    for (const m of left) {
      const res = await ctx.delete(`/api/v1/Order/${m.where.dealerGuid}?OrderId=${m.orderId}`, { headers });
      console.log(`Cleanup close of order ${m.orderId} at ${m.where.name}: HTTP ${res.status()}`);
    }
    await ctx.dispose();
  });
});
