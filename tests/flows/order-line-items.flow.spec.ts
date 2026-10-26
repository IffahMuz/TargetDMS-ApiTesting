import { expect, request as pwRequest } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { createWorkOrder, getOrder, guid, headers, PART_PRICE, WorkOrder } from '../../src/warranty-helpers';
import { firstJobCode, firstMiscItem, laborBody, miscBody, partBody, removeAllLines, saveLine } from '../../src/line-item-helpers';

test.beforeEach(pace);

// Adding, changing and removing the three kinds of order lines (part, labor, miscellaneous) on a work order of our own.
// Nothing is checked out, so no stock is used. Everything is removed at the end.
test.describe.serial('Order lines: add a part, labor and a miscellaneous charge, change them, then remove them', () => {
  let wo: WorkOrder;
  let part: any;
  let labor: any;
  let misc: any;
  let jobCode: { jobCode: string; description: string };
  let miscItem: { description: string; moreInfo: string };
  // Some dealers (10543) add a $0 SHOP SUPPLIES labor line to every new work order by themselves; it is not one of ours.
  const ownLabors = (inv: any): any[] => inv.invoiceLabors.filter((l: any) => l.description !== 'SHOP SUPPLIES');
  const invoice = async (request: any) => (await getOrder(request, wo.orderId)).invoices[0];

  test('1. Start with a new work order that has no lines and costs nothing', async ({ request }) => {
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    jobCode = await firstJobCode(request);
    miscItem = await firstMiscItem(request);
    const inv = await invoice(request);
    expect(inv.invoiceParts).toHaveLength(0);
    expect(ownLabors(inv)).toHaveLength(0);
    expect(inv.invoiceMiscs).toHaveLength(0);
    expect(inv.invoiceAmount).toBe(0);
  });

  test('2. Adding a part works and the order total becomes the part price', async ({ request }) => {
    test.skip(!wo, 'setup failed');
    const res = await saveLine(request, 'Parts', partBody(wo));
    expect(config.passStatuses, JSON.stringify(res.body).slice(0, 250)).toContain(res.status);
    expect(res.body.message).toContain('Part saved successfully');
    part = res.body.data.part;
    expect(part.invoicePartId).toBeGreaterThan(0);
    expect(res.body.data.subTotal).toBeCloseTo(PART_PRICE, 2);
    expect((await invoice(request)).invoiceAmount).toBeCloseTo(PART_PRICE, 2);
  });

  test('3. Adding one hour of labor at $50 raises the total by $50', async ({ request }) => {
    test.skip(!part, 'no part');
    const res = await saveLine(request, 'Labor', laborBody(wo, jobCode));
    expect(config.passStatuses, JSON.stringify(res.body).slice(0, 250)).toContain(res.status);
    labor = res.body.data.labor;
    expect(labor).toMatchObject({ billedHours: 1, rate: 50, total: 50, laborCode: jobCode.jobCode });
    expect(res.body.data.subTotal).toBeCloseTo(PART_PRICE + 50, 2);
  });

  test('4. Adding a $5 miscellaneous charge raises the total by $5', async ({ request }) => {
    test.skip(!part, 'no part');
    const res = await saveLine(request, 'Miscellaneous', miscBody(wo, miscItem));
    expect(config.passStatuses, JSON.stringify(res.body).slice(0, 250)).toContain(res.status);
    misc = res.body.data.misc;
    expect(misc.invoiceMiscId).toBeGreaterThan(0);
    expect(res.body.data.subTotal).toBeCloseTo(PART_PRICE + 55, 2);
  });

  test('5. The order shows all three lines and the right total', async ({ request }) => {
    test.skip(!misc, 'no misc');
    const inv = await invoice(request);
    expect(inv.invoiceParts).toHaveLength(1);
    expect(ownLabors(inv)).toHaveLength(1);
    expect(inv.invoiceMiscs).toHaveLength(1);
    expect(inv.invoiceAmount).toBeCloseTo(PART_PRICE + 55, 2);
  });

  test('6. Changing the quantity, hours and charge updates each line and the total', async ({ request }) => {
    test.skip(!misc, 'no misc');
    const p = await saveLine(request, 'Parts', partBody(wo, { invoicePartId: part.invoicePartId, invoicePartGuid: part.invoicePartGuid, quantitySold: 3 }));
    const l = await saveLine(request, 'Labor', laborBody(wo, jobCode, { invoiceLaborId: labor.invoiceLaborId, invoiceLaborGuid: labor.invoiceLaborGuid, billedHours: 2, total: 100 }));
    const m = await saveLine(request, 'Miscellaneous', miscBody(wo, miscItem, { invoiceMiscId: misc.invoiceMiscId, invoiceMiscGuid: misc.invoiceMiscGuid, quantitySold: 2 }));
    for (const r of [p, l, m]) expect(config.passStatuses, JSON.stringify(r.body).slice(0, 200)).toContain(r.status);
    const inv = await invoice(request);
    expect(inv.invoiceParts).toHaveLength(1); // changed in place, not added again
    expect(inv.invoiceParts[0].quantitySold).toBe(3);
    expect(ownLabors(inv)[0].billedHours).toBe(2);
    expect(inv.invoiceMiscs[0].quantitySold).toBe(2);
    expect(inv.invoiceAmount).toBeCloseTo(3 * PART_PRICE + 100 + 2 * 5, 2);
  });

  test('7. A description with script tags is refused and no line is added', async ({ request }) => {
    test.skip(!part, 'no part');
    const res = await saveLine(request, 'Parts', partBody(wo, { description: '<script>alert(1)</script>' }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('unsafe');
    expect((await invoice(request)).invoiceParts).toHaveLength(1);
  });

  test('8. Extra information longer than 1000 characters is refused', async ({ request }) => {
    test.skip(!part, 'no part');
    const res = await saveLine(request, 'Parts', partBody(wo, { moreInfo: 'x'.repeat(1001) }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('MoreInfo cannot exceed 1000 characters');
  });

  test('9. A description longer than 2000 characters is refused', async ({ request }) => {
    test.skip(!part, 'no part');
    const res = await saveLine(request, 'Parts', partBody(wo, { description: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('Description cannot exceed 2000 characters');
  });

  test('10. Removing the lines the way the web app does leaves an empty order that costs nothing', async ({ request }) => {
    test.skip(!misc, 'no misc');
    await removeAllLines(request, wo.orderId);
    const inv = await invoice(request);
    expect(inv.invoiceParts).toHaveLength(0);
    expect(ownLabors(inv)).toHaveLength(0);
    expect(inv.invoiceMiscs).toHaveLength(0);
    expect(inv.invoiceAmount).toBe(0);
  });

  test('11. Clean up: delete the work order', async ({ request }) => {
    test.skip(!wo, 'setup failed');
    const res = await request.delete(`/api/v1/Order/${guid}?orderId=${wo.orderId}`, { headers, timeout: config.timeoutMs });
    expect(config.passStatuses, `HTTP ${res.status()}`).toContain(res.status());
    wo = undefined as unknown as WorkOrder;
  });

  test.afterAll(async () => {
    if (!wo) return;
    const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
    await ctx.delete(`/api/v1/Order/${guid}?orderId=${wo.orderId}`, { headers });
    await ctx.dispose();
  });
});
