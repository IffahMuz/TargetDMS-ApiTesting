import { expect, request as pwRequest } from '@playwright/test';
import { test } from '../../../src/fixtures';
import { config } from '../../../src/config';
import { pace } from '../../../src/pace';
import { claimIdOf, enabledTargets, warrantyState, checkoutParams } from '../../../src/warranty-rules';
import { addPart, attachClaim, cleanUpOpenOrder, createClaim, createWorkOrder, getOrder, WorkOrder, PART_PRICE } from '../../../src/warranty-helpers';

test.beforeEach(pace);

// The Checkout button and its billing options are decided by the web app from each line item's moreInfo.WarrantyClaimId.
// This flow builds real orders in each state and checks the rule against the data the API returns. Nothing is checked out.
test.describe.serial('Checkout options: which billing choices does a work order offer?', () => {
  let wo: WorkOrder;
  let claimId = '';
  let claimedPart: any;
  let plainPart: any;
  const state = async (request: any) => {
    const invoice = (await getOrder(request, wo.orderId)).invoices[0];
    // Some dealers (10543) add a $0 SHOP SUPPLIES labor line to every new work order; it is not one of ours, so it is left out.
    const labors = invoice.invoiceLabors.filter((l: any) => l.description !== 'SHOP SUPPLIES');
    const items = [...invoice.invoiceParts, ...labors, ...invoice.invoiceMiscs, ...invoice.invoiceWGs];
    return { invoice, s: warrantyState(items), targets: enabledTargets(warrantyState(items)) };
  };

  test('1. A work order with one normal part has no warranty, so there is no Checkout button', async ({ request }) => {
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    plainPart = await addPart(request, wo);
    const { s, targets, invoice } = await state(request);
    expect(s.hasWarranty).toBe(false);
    expect(targets).toEqual([]);
    expect(invoice.invoiceAmount).toBeCloseTo(PART_PRICE, 2);
  });

  test('2. When the only part is put under warranty, the only choice is "Bill the warrantor only"', async ({ request }) => {
    test.skip(!wo, 'setup failed');
    claimId = await createClaim(request, wo, 'BO');
    claimedPart = await attachClaim(request, wo, plainPart, claimId);
    const { s, targets } = await state(request);
    expect(s.claimIds).toEqual([Number(claimId)]);
    expect(s.hasWarranty).toBe(true);
    expect(s.allWarrantied).toBe(true);
    expect(targets).toEqual(['WarrantorOnly']);
  });

  test('3. The customer is not charged for the part under warranty (the amount drops to zero)', async ({ request }) => {
    test.skip(!claimId, 'no claim');
    const { invoice } = await state(request);
    expect(invoice.invoiceAmount).toBe(0);
  });

  test('4. After adding a normal part, the order is mixed and all three choices appear', async ({ request }) => {
    test.skip(!claimId, 'no claim');
    await addPart(request, wo);
    const { s, targets, invoice } = await state(request);
    expect(s.hasWarranty).toBe(true);
    expect(s.allWarrantied).toBe(false);
    expect(targets).toEqual(['CustomerOnly', 'CustomerAndWarrantor', 'WarrantorOnly']);
    expect(invoice.invoiceAmount).toBeCloseTo(PART_PRICE, 2); // only the ordinary part is billed to the customer
  });

  test('5. The link between the part and its claim is saved and can be read back', async ({ request }) => {
    test.skip(!claimId, 'no claim');
    const { invoice } = await state(request);
    const stored = invoice.invoiceParts.find((p: any) => p.invoicePartId === claimedPart.invoicePartId);
    expect(JSON.parse(stored.moreInfo)).toEqual({ WarrantyClaimId: claimId });
  });

  test('6. Removing the claim from the part takes away the warranty and the Checkout button', async ({ request }) => {
    test.skip(!claimId, 'no claim');
    await attachClaim(request, wo, claimedPart, null);
    const { s, targets, invoice } = await state(request);
    expect(s.hasWarranty).toBe(false);
    expect(targets).toEqual([]);
    expect(invoice.invoiceAmount).toBeCloseTo(PART_PRICE * 2, 2);
  });

  test.afterAll(async () => {
    if (!wo) return;
    const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
    await cleanUpOpenOrder(ctx, wo.orderId);
    await ctx.dispose();
  });
});

// The rule itself, independent of the API.
test.describe('Checkout options: the rule on its own (the same rule the web app uses)', () => {
  test('Blank, zero and unreadable claim numbers are treated as "no warranty"', () => {
    for (const empty of [null, undefined, '', '{}', '{"WarrantyClaimId":0}', '{"WarrantyClaimId":"0"}', '{"WarrantyClaimId":""}', '{"WarrantyClaimId":null}', 'not json']) {
      expect(claimIdOf(empty as string), `moreInfo ${JSON.stringify(empty)}`).toBeNull();
    }
    expect(claimIdOf('{"WarrantyClaimId":"483"}')).toBe('483');
    expect(claimIdOf('{"WarrantyClaimId":483,"Other":"x"}')).toBe('483');
  });

  test('No items, no warranty, all warranty and mixed orders each give the right choices', () => {
    const claimed = { moreInfo: '{"WarrantyClaimId":"1"}' };
    const plain = { moreInfo: null };
    expect(enabledTargets(warrantyState([]))).toEqual([]);
    expect(enabledTargets(warrantyState([plain, plain]))).toEqual([]);
    expect(enabledTargets(warrantyState([claimed, claimed]))).toEqual(['WarrantorOnly']);
    expect(enabledTargets(warrantyState([claimed, plain]))).toEqual(['CustomerOnly', 'CustomerAndWarrantor', 'WarrantorOnly']);
  });

  test('Each billing choice sends the right instructions to checkout', () => {
    expect(checkoutParams('WarrantorOnly', [5])).toEqual({ onlyWarrantors: true, warrantyClaimIds: [5] });
    expect(checkoutParams('CustomerAndWarrantor', [5])).toEqual({ onlyWarrantors: false, warrantyClaimIds: [5] });
    expect(checkoutParams('CustomerOnly', [5])).toEqual({ onlyWarrantors: false });
  });
});
