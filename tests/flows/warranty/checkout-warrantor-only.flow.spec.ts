import { expect } from '@playwright/test';
import { test } from '../../../src/fixtures';
import { pace } from '../../../src/pace';
import { checkoutParams } from '../../../src/warranty-rules';
import { addPart, checkout, claimsOf, createClaim, createWorkOrder, getOrder, invoicesOf, json, WorkOrder } from '../../../src/warranty-helpers';

test.beforeEach(pace);

// "Warrantor only": every item on the order is under warranty, so the warrantor is billed and the customer pays nothing.
// This really checks the order out. It leaves one finalized work order behind (accepted on the test dealer).
test.describe.serial('Checkout: bill the warrantor only (every item is under warranty)', () => {
  // Off by default: a real checkout finalizes an order and uses stock. Run with RUN_CHECKOUT=true when you want these.
  test.skip(process.env.RUN_CHECKOUT !== 'true', 'Real checkouts are switched off. Set RUN_CHECKOUT=true to run them.');

  let wo: WorkOrder;
  let claimId = '';

  test('1. Start with a work order whose only part is covered by a warranty claim', async ({ request }) => {
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    claimId = await createClaim(request, wo, 'WO');
    await addPart(request, wo, claimId);
    const invoice = (await getOrder(request, wo.orderId)).invoices[0];
    expect(invoice.invoiceAmount, 'customer owes nothing').toBe(0);
  });

  test('2. Checking out and billing only the warrantor works', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    const res = await checkout(request, wo.orderId, checkoutParams('WarrantorOnly', [Number(claimId)]));
    const body = await json(res);
    expect(res.status(), JSON.stringify(body).slice(0, 300)).toBe(200);
    expect(body.message).toContain('Order checkout completed successfully');
    expect(body.data.orderStatusId).toBe('Finalized');
  });

  test('3. The order is finished and has one closed warranty invoice with the part on it', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    expect((await getOrder(request, wo.orderId)).orderStatusId).toBe('Finalized');
    const invoices = await invoicesOf(request, wo.orderId);
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ invoiceStatusId: 'Closed', isWarranty: true });
    expect(invoices[0].invoiceParts).toHaveLength(1);
    expect(JSON.parse(invoices[0].invoiceParts[0].moreInfo)).toEqual({ WarrantyClaimId: claimId });
    expect(invoices[0].payments ?? []).toEqual([]); // the customer paid nothing
  });

  test('4. The claim is still on the work order', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    expect((await claimsOf(request, wo.orderId)).map((c) => c.warrantyClaimId)).toEqual([claimId]);
  });

  test('5. Checking out the same order a second time is refused', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    const res = await checkout(request, wo.orderId, checkoutParams('WarrantorOnly', [Number(claimId)]));
    expect([200, 201, 204]).not.toContain(res.status());
  });
});
