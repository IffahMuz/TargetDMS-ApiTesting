import { expect } from '@playwright/test';
import { test } from '../../../src/fixtures';
import { pace } from '../../../src/pace';
import { checkoutParams } from '../../../src/warranty-rules';
import { addPart, cashPayment, checkout, claimsOf, createClaim, createWorkOrder, getOrder, invoicesOf, json, WorkOrder, PART_PRICE } from '../../../src/warranty-helpers';

test.beforeEach(pace);

// "Customer only": the customer pays for the ordinary items now and the warranty items are left on the order for later.
// Afterwards only warranty items remain, so the warrantor can be billed ("Warrantor only") to finish the order.
// This really checks the order out and leaves one finalized work order behind (accepted on the test dealer).
test.describe.serial('Checkout: the customer pays now, then the warrantor is billed for the rest', () => {
  // Off by default: a real checkout finalizes an order and uses stock. Run with RUN_CHECKOUT=true when you want these.
  test.skip(process.env.RUN_CHECKOUT !== 'true', 'Real checkouts are switched off. Set RUN_CHECKOUT=true to run them.');

  let wo: WorkOrder;
  let claimId = '';

  test('1. Start with one part under warranty and one normal part', async ({ request }) => {
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    claimId = await createClaim(request, wo, 'CO');
    await addPart(request, wo, claimId);
    await addPart(request, wo);
    expect((await getOrder(request, wo.orderId)).invoices[0].invoiceAmount).toBeCloseTo(PART_PRICE, 2);
  });

  test('2. The customer pays cash for the normal part and checkout works', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    const res = await checkout(request, wo.orderId, { ...checkoutParams('CustomerOnly', []), paymentAction: 'LeaveAsDeposit', payments: [cashPayment(wo, PART_PRICE)] });
    const body = await json(res);
    expect(res.status(), JSON.stringify(body).slice(0, 300)).toBe(200);
    expect(body.message).toContain('Order checkout completed successfully');
  });

  test('3. The order stays open: one paid customer invoice, and an open invoice still holding the warranty part', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    expect((await getOrder(request, wo.orderId)).orderStatusId).toBe('InProgress');
    const invoices = await invoicesOf(request, wo.orderId);
    expect(invoices).toHaveLength(2);
    const paid = invoices.find((i) => i.invoiceStatusId === 'Closed')!;
    const open = invoices.find((i) => i.invoiceStatusId === 'Open')!;
    expect(paid.invoiceParts.map((p: any) => p.moreInfo ?? null)).toEqual([null]);
    expect(paid.payments.map((p: any) => Math.abs(p.amount))).toEqual([PART_PRICE]);
    expect(open.invoiceAmount, 'nothing left for the customer to pay').toBe(0);
    expect(open.invoiceParts).toHaveLength(1);
    expect(JSON.parse(open.invoiceParts[0].moreInfo)).toEqual({ WarrantyClaimId: claimId });
  });

  test('4. The warranty claim is untouched and still there', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    expect((await claimsOf(request, wo.orderId)).map((c) => c.warrantyClaimId)).toEqual([claimId]);
  });

  test('5. Only the warranty part is left, so billing the warrantor finishes the order', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    const res = await checkout(request, wo.orderId, checkoutParams('WarrantorOnly', [Number(claimId)]));
    const body = await json(res);
    expect(res.status(), JSON.stringify(body).slice(0, 300)).toBe(200);
    expect(body.data.orderStatusId).toBe('Finalized');
    const invoices = await invoicesOf(request, wo.orderId);
    expect(invoices).toHaveLength(2);
    expect(invoices.every((i) => i.invoiceStatusId === 'Closed')).toBe(true);
    expect(invoices.filter((i) => i.isWarranty)).toHaveLength(1);
  });
});
