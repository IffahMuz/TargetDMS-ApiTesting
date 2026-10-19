import { expect } from '@playwright/test';
import { test } from '../../../src/fixtures';
import { pace } from '../../../src/pace';
import { checkoutParams } from '../../../src/warranty-rules';
import { addPart, cashPayment, checkout, createClaim, createWorkOrder, getOrder, invoicesOf, json, WorkOrder, PART_PRICE } from '../../../src/warranty-helpers';

test.beforeEach(pace);

// "Customer and warrantor": the order mixes warranty and ordinary items. The warranty items go to the warrantor and the customer
// pays for the rest. This really checks the order out and leaves one finalized work order behind (accepted on the test dealer).
test.describe.serial('Checkout: the customer and the warrantor both pay (mixed order)', () => {
  // Off by default: a real checkout finalizes an order and uses stock. Run with RUN_CHECKOUT=true when you want these.
  test.skip(process.env.RUN_CHECKOUT !== 'true', 'Real checkouts are switched off. Set RUN_CHECKOUT=true to run them.');

  let wo: WorkOrder;
  let claimId = '';

  test('1. Start with one part under warranty and one normal part; the customer owes only for the normal part', async ({ request }) => {
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    claimId = await createClaim(request, wo, 'CW');
    await addPart(request, wo, claimId);
    await addPart(request, wo);
    expect((await getOrder(request, wo.orderId)).invoices[0].invoiceAmount).toBeCloseTo(PART_PRICE, 2);
  });

  test('2. Taking a deposit while warranty claims are included is refused', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    const res = await checkout(request, wo.orderId, {
      ...checkoutParams('CustomerAndWarrantor', [Number(claimId)]), takeDeposit: true, paymentAction: 'LeaveAsDeposit', payments: [cashPayment(wo, 1)],
    });
    const body = await json(res);
    expect([200, 201, 204]).not.toContain(res.status());
    expect(JSON.stringify(body)).toContain('Warranty claims cannot be invoiced while taking deposits');
    expect((await getOrder(request, wo.orderId)).orderStatusId, 'nothing changed').toBe('InProgress');
  });

  test('3. A payment with unreadable payment details is refused and nothing changes', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    const res = await checkout(request, wo.orderId, {
      ...checkoutParams('CustomerAndWarrantor', [Number(claimId)]), paymentAction: 'LeaveAsDeposit',
      payments: [cashPayment(wo, PART_PRICE, { paymentInfo: 'plain text' })],
    });
    expect([200, 201, 204]).not.toContain(res.status());
    expect((await getOrder(request, wo.orderId)).orderStatusId).toBe('InProgress');
  });

  test('4. The customer pays cash for the normal part and the warrantor is billed for the warranty part', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    const res = await checkout(request, wo.orderId, {
      ...checkoutParams('CustomerAndWarrantor', [Number(claimId)]), paymentAction: 'LeaveAsDeposit', payments: [cashPayment(wo, PART_PRICE)],
    });
    const body = await json(res);
    expect(res.status(), JSON.stringify(body).slice(0, 300)).toBe(200);
    expect(body.data.orderStatusId).toBe('Finalized');
  });

  test('5. The order splits into a paid customer invoice and a warranty invoice, both closed', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    const invoices = await invoicesOf(request, wo.orderId);
    expect(invoices).toHaveLength(2);
    const customer = invoices.find((i) => !i.isWarranty)!;
    const warranty = invoices.find((i) => i.isWarranty)!;
    expect(customer).toMatchObject({ invoiceStatusId: 'Closed' });
    expect(customer.invoiceParts).toHaveLength(1);
    expect(customer.invoiceParts[0].moreInfo ?? null).toBeNull();
    expect(customer.payments.map((p: any) => Math.abs(p.amount))).toEqual([PART_PRICE]);
    expect(warranty).toMatchObject({ invoiceStatusId: 'Closed' });
    expect(warranty.invoiceParts).toHaveLength(1);
    expect(JSON.parse(warranty.invoiceParts[0].moreInfo)).toEqual({ WarrantyClaimId: claimId });
    expect(warranty.payments ?? [], 'the customer does not pay the warranty invoice').toEqual([]);
  });
});
