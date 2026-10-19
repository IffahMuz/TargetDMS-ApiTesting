import { expect, request as pwRequest } from '@playwright/test';
import { test } from '../../../src/fixtures';
import { config } from '../../../src/config';
import { pace } from '../../../src/pace';
import { claimIdOf } from '../../../src/warranty-rules';
import { addPart, checkout, claimsOf, cleanUpOpenOrder, createClaim, createWorkOrder, getOrder, guid, headers, json, WorkOrder } from '../../../src/warranty-helpers';

test.beforeEach(pace);

// What happens when a warranty claim is deleted while a line item still points to it. Uses an open order and cleans up after itself.
// (The "reference should be cleared" expectation is a known defect and lives in tests/defects.)
test.describe.serial('Deleting a warranty claim that a part still points to', () => {
  let wo: WorkOrder;
  let claimId = '';

  test('1. Start with one part under a warranty claim', async ({ request }) => {
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    claimId = await createClaim(request, wo, 'DC');
    await addPart(request, wo, claimId);
    expect(claimIdOf((await getOrder(request, wo.orderId)).invoices[0].invoiceParts[0].moreInfo)).toBe(claimId);
  });

  test('2. The claim can be deleted and the claim list becomes empty', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    const res = await request.delete(`/api/v1/Dealer/WarrantyClaims/${guid}?WorkOrderId=${wo.orderId}&WarrantyClaimId=${claimId}`, { headers, timeout: config.timeoutMs });
    expect(config.passStatuses, `HTTP ${res.status()}`).toContain(res.status());
    expect(await claimsOf(request, wo.orderId)).toEqual([]);
  });

  test('3. Billing the warrantor with the deleted claim is refused with a clear message and nothing changes', async ({ request }) => {
    test.skip(!claimId, 'setup failed');
    const res = await checkout(request, wo.orderId, { onlyWarrantors: true, warrantyClaimIds: [Number(claimId)] });
    const text = JSON.stringify(await json(res));
    expect([200, 201, 204]).not.toContain(res.status());
    expect(text).toContain(`WarrantyClaimId '${claimId}' does not exist for Order (${wo.orderId})`);
    expect((await getOrder(request, wo.orderId)).orderStatusId).toBe('InProgress');
  });

  test.afterAll(async () => {
    if (!wo) return;
    const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
    await cleanUpOpenOrder(ctx, wo.orderId);
    await ctx.dispose();
  });
});
