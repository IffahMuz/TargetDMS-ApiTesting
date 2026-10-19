import { expect } from '@playwright/test';
import { test } from '../../../src/fixtures';
import { pace } from '../../../src/pace';
import { cashPayment, checkout, json } from '../../../src/warranty-helpers';

test.beforeEach(pace);

// Checkout bodies that must be rejected by request validation BEFORE anything happens. They use an order id that does not
// exist, so nothing can be checked out even if a rule were missing.
const NO_SUCH_ORDER = 99999999;
const wo = { orderId: NO_SUCH_ORDER, invoiceId: 1, invoiceGuid: '', jobId: 1 };

test.describe('Checkout: bad requests are refused before anything happens', () => {
  const rejected = async (request: any, over: Record<string, unknown>, expectedText: string) => {
    const res = await checkout(request, NO_SUCH_ORDER, over);
    const text = JSON.stringify(await json(res));
    expect(res.status(), text.slice(0, 250)).toBe(400);
    expect(text).toContain(expectedText);
  };

  test('Order number 0 is refused', async ({ request }) => {
    const res = await checkout(request, 0);
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('OrderId must be greater than 0');
  });

  test('An unknown order source is refused', async ({ request }) => {
    const res = await checkout(request, NO_SUCH_ORDER, { orderSource: 'NotASource' });
    expect(res.status()).toBe(400);
  });

  test('An unknown payment action is refused', async ({ request }) => {
    const res = await checkout(request, NO_SUCH_ORDER, { paymentAction: 'GiveEverything' });
    expect(res.status()).toBe(400);
  });

  test('Taking a deposit without any payment is refused', async ({ request }) => {
    await rejected(request, { takeDeposit: true, payments: [] }, 'At least one payment is required when taking a deposit');
  });

  test('Billing only the warrantor without any claim numbers is refused', async ({ request }) => {
    await rejected(request, { onlyWarrantors: true }, 'WarrantyClaimIds are required when OnlyWarrantors is true');
  });

  test('Billing only the warrantor with an empty claim list is refused', async ({ request }) => {
    await rejected(request, { onlyWarrantors: true, warrantyClaimIds: [] }, 'At least one WarrantyClaimId is required when OnlyWarrantors is true');
  });

  test('A claim number of 0 is refused', async ({ request }) => {
    await rejected(request, { onlyWarrantors: true, warrantyClaimIds: [0] }, 'WarrantyClaimId must be greater than 0');
  });

  test('A negative claim number is refused', async ({ request }) => {
    await rejected(request, { onlyWarrantors: false, warrantyClaimIds: [-5] }, 'WarrantyClaimId must be greater than 0');
  });

  test('A payment with no payment type is refused', async ({ request }) => {
    await rejected(request, { payments: [cashPayment(wo, 1, { paymentType: '' })] }, 'PaymentType is required');
  });
});
