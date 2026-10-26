import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { createWorkOrder, guid, headers, WorkOrder } from '../../src/warranty-helpers';
import { getOrder } from '../../src/warranty-helpers';
import { DATA } from '../../src/testdata';
import { removeAllLines, saveLine, wgBody, WG_UNAVAILABLE_UNIT, WG_PRICE } from '../../src/line-item-helpers';

test.beforeEach(pace);

// Wholegood (unit) order lines. A unit can be added to an order only when its status is Available (Sold, On Order and for-rent units
// have no inventory receipt and are refused). Adding a line only references the unit; nothing is checked out, so stock is untouched.
// The validation cases break exactly ONE length/format rule each, so they must be rejected before anything is saved.
test.describe('Order wholegood line: invalid values are rejected with 400', () => {
  let wo: WorkOrder;
  test.beforeAll(async ({ request }) => {
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
  });
  test.afterAll(async ({ request }) => {
    if (!wo) return;
    await request.delete(`/api/v1/Order/${guid}?orderId=${wo.orderId}`, { headers, timeout: config.timeoutMs });
  });

  const cases: [string, Record<string, unknown>, string][] = [
    ['a serial number over 100 characters', { serialNumber: 'S'.repeat(101) }, 'SerialNumber cannot exceed 100 characters'],
    ['a stock number over 50 characters', { stockNumber: 'N'.repeat(51) }, 'StockNumber cannot exceed 50 characters'],
    ['a meter reading over 20 characters', { meterReading: '1'.repeat(21) }, 'MeterReading cannot exceed 20 characters'],
    ['a received date that is not a date', { receivedDate: 'not-a-date' }, 'ReceivedDate must be a valid date'],
  ];
  for (const [what, over, message] of cases) {
    test(`Adding a wholegood with ${what} is rejected with 400`, async ({ request }) => {
      test.skip(!wo, 'setup failed');
      const res = await saveLine(request, 'Wholegoods', wgBody(wo, over));
      expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(400);
      expect(JSON.stringify(res.body)).toContain(message);
    });
  }
});

test.describe.serial('Order wholegood line: add an available unit, change it, remove it', () => {
  let wo: WorkOrder;
  let line: any;
  const invoice = async (request: any) => (await getOrder(request, wo.orderId)).invoices[0];

  test.beforeAll(async ({ request }) => {
    if (!DATA.unit.addable) return;
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
  });
  test.afterAll(async ({ request }) => {
    if (!wo) return;
    await request.delete(`/api/v1/Order/${guid}?orderId=${wo.orderId}`, { headers, timeout: config.timeoutMs });
  });

  test('1. Adding an available unit puts one wholegood line on the order and raises the total by its price', async ({ request }) => {
    test.skip(!DATA.unit.addable, 'this dealer has no available wholegood unit configured');
    const res = await saveLine(request, 'Wholegoods', wgBody(wo));
    expect(config.passStatuses, JSON.stringify(res.body).slice(0, 250)).toContain(res.status);
    line = res.body.data.wg;
    // The server picks the unit to allocate itself (another available unit of the same model can be returned), so only the model is checked.
    expect(line).toMatchObject({ manufacturerId: DATA.unit.manufacturerId, partNumber: DATA.unit.model, price: WG_PRICE });
    expect(line.invoiceWGId).toBeGreaterThan(0);
    expect(res.body.data.subTotal).toBeCloseTo(WG_PRICE, 2);
    const inv = await invoice(request);
    expect(inv.invoiceWGs).toHaveLength(1);
    expect(inv.invoiceAmount).toBeCloseTo(WG_PRICE, 2);
  });

  test('2. Saving the returned line again with a new price changes it in place and updates the total', async ({ request }) => {
    test.skip(!line, 'no wholegood line');
    const res = await saveLine(request, 'Wholegoods', { ...line, price: 120, suggestedRetailPrice: 120 });
    expect(config.passStatuses, JSON.stringify(res.body).slice(0, 250)).toContain(res.status);
    const inv = await invoice(request);
    expect(inv.invoiceWGs).toHaveLength(1);
    expect(inv.invoiceWGs[0].price).toBe(120);
    expect(inv.invoiceAmount).toBeCloseTo(120, 2);
  });

  test('3. Removing the lines the way the web app does (saving the order without them) leaves an order that costs nothing', async ({ request }) => {
    test.skip(!line, 'no wholegood line');
    await removeAllLines(request, wo.orderId);
    const inv = await invoice(request);
    expect(inv.invoiceWGs).toHaveLength(0);
    expect(inv.invoiceAmount).toBe(0);
  });
});

// A unit that is Sold or On Order has no inventory receipt, so it cannot be sold from stock. (The server answers 502 for it.)
test.describe('Order wholegood line: a unit that is not available is refused', () => {
  let wo: WorkOrder;
  test.beforeAll(async ({ request }) => {
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
  });
  test.afterAll(async ({ request }) => {
    if (!wo) return;
    await request.delete(`/api/v1/Order/${guid}?orderId=${wo.orderId}`, { headers, timeout: config.timeoutMs });
  });

  test('Adding a unit that is not available is not accepted and no line is added', async ({ request }) => {
    test.skip(!wo, 'setup failed');
    const res = await saveLine(request, 'Wholegoods', wgBody(wo, { ...WG_UNAVAILABLE_UNIT, partNumber: WG_UNAVAILABLE_UNIT.model }));
    expect(config.passStatuses, JSON.stringify(res.body).slice(0, 250)).not.toContain(res.status);
    expect((await getOrder(request, wo.orderId)).invoices[0].invoiceWGs).toHaveLength(0);
  });
});
