import { expect, request as pwRequest, APIResponse } from '@playwright/test';
import { test } from '../../src/fixtures';
import * as fs from 'fs';
import * as path from 'path';
import { config, tokenPath } from '../../src/config';
import { IDS } from '../../src/get-calls/types';
import { pace } from '../../src/pace';

test.beforeEach(pace);

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const guid = config.dealerGuid;
const orderUrl = `/api/v1/Order/${guid}`;
const claimsUrl = `/api/v1/Dealer/WarrantyClaims/${guid}`;
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
const ok = (res: APIResponse) => config.passStatuses.includes(res.status());

// Hidden rules found by probing (not in Swagger or the validator): claimType must be exactly 1 character (W works) and
// warrantorId at most 10 characters. subtotal / tax / total are calculated by the server and ignored when sent.
const claimBody = (over: Record<string, unknown> = {}) => ({
  warrantyClaimId: null, warrantorId: 'GRAVELY', warrantorName: 'ARIENS COMPANY', subtotal: 0, tax: 0, total: 0,
  claimType: 'W', claimNumber: 'AUTO-A', salesTaxCode: null,
  failedDate: '2026-10-01T00:00:00', repairStartDate: '2026-10-02T00:00:00', repairCompleteDate: '2026-10-03T00:00:00',
  modelNumber: 'MODEL-X', mfrId: 'STI', serialNumber: 'SN-AUTO-1', origSoldBy: 'Test Dealer', equipmentType: 'Mower',
  failedPartNumber: 'PN-123', failedPartName: 'Blade', meter: '12', ...over,
});

function orderBody(marker: string) {
  const raw = fs.readFileSync(path.resolve(__dirname, '..', '..', 'testdata', 'order-create.json'), 'utf8');
  const body = JSON.parse(raw.split('{{NOW}}').join(new Date().toISOString().slice(0, 19)));
  body.notes = marker;
  body.poNumber = 'AUTO-WTY';
  return body;
}

// Warranty claims on a work order. Creates its own work order and removes every claim and the order afterwards.
test.describe.serial('Warranty claim: create, view, update, add a second claim, then delete', () => {
  let workOrderId = 0;
  let orderId = 0;
  let claimA = '';
  let claimB = '';
  const claims = (request: any) => request.get(`${claimsUrl}?WorkOrderId=${workOrderId}`, { headers, timeout: config.timeoutMs });
  const save = (request: any, data: object) => request.post(`${claimsUrl}?WorkOrderId=${workOrderId}`, { headers, data, timeout: config.timeoutMs });
  const remove = (request: any, id: string) => request.delete(`${claimsUrl}?WorkOrderId=${workOrderId}&WarrantyClaimId=${encodeURIComponent(id)}`, { headers, timeout: config.timeoutMs });

  test('1. Start with a new work order that has no claims yet', async ({ request }) => {
    const created = await json(await request.post(orderUrl, { headers, data: orderBody(`AUTOMATION-${Date.now()}`), timeout: config.timeoutMs }));
    orderId = Number(created?.data?.orderId ?? 0);
    expect(orderId, `order not created: ${JSON.stringify(created).slice(0, 200)}`).toBeGreaterThan(0);
    const order = await json(await request.get(`${orderUrl}?OrderId=${orderId}`, { headers, timeout: config.timeoutMs }));
    workOrderId = Number(order.data.workOrderId || orderId);
    expect(workOrderId).toBeGreaterThan(0);
  });

  test('2. A brand-new work order shows no warranty claims', async ({ request }) => {
    test.skip(!workOrderId, 'setup failed');
    const body = await json(await claims(request));
    expect(body.data).toEqual([]);
  });

  test('3. Saving a claim works and gives back the claim number and the details we entered', async ({ request }) => {
    test.skip(!workOrderId, 'setup failed');
    const res = await save(request, claimBody());
    const body = await json(res);
    expect(config.passStatuses, `save: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 250)}`).toContain(res.status());
    claimA = body.data.warrantyClaimId;
    expect(claimA).toBeTruthy();
    expect(body.data).toMatchObject({ claimType: 'W', claimNumber: 'AUTO-A', modelNumber: 'MODEL-X', serialNumber: 'SN-AUTO-1', failedPartName: 'Blade', meter: '12' });
  });

  test('4. The claim list shows the new claim, including the warrantor name', async ({ request }) => {
    test.skip(!claimA, 'no claim');
    const body = await json(await claims(request));
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ warrantyClaimId: claimA, warrantorId: 'GRAVELY', warrantorName: 'ARIENS COMPANY', claimNumber: 'AUTO-A' });
  });

  test('5. Amounts typed into a claim are ignored, because the system works out the totals itself', async ({ request }) => {
    test.skip(!claimA, 'no claim');
    const res = await save(request, claimBody({ warrantyClaimId: claimA, subtotal: 100, tax: 8, total: 108 }));
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    const body = await json(await claims(request));
    expect(body.data[0].subtotal).toBe(0);
    expect(body.data[0].total).toBe(0);
  });

  test('6. Editing a claim changes it and does not create a second claim', async ({ request }) => {
    test.skip(!claimA, 'no claim');
    const res = await save(request, claimBody({ warrantyClaimId: claimA, claimNumber: 'AUTO-A-UPD', failedPartName: 'Blade UPDATED', meter: '99' }));
    expect(ok(res), `HTTP ${res.status()}`).toBe(true);
    const body = await json(await claims(request));
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ warrantyClaimId: claimA, claimNumber: 'AUTO-A-UPD', failedPartName: 'Blade UPDATED', meter: '99' });
  });

  test('7. A work order can have a second claim and both are shown', async ({ request }) => {
    test.skip(!claimA, 'no claim');
    const res = await save(request, claimBody({ claimNumber: 'AUTO-B' }));
    const body = await json(res);
    expect(ok(res), `HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`).toBe(true);
    claimB = body.data.warrantyClaimId;
    expect(claimB).not.toBe(claimA);
    expect((await json(await claims(request))).data).toHaveLength(2);
  });

  test('8. Deleting the first claim leaves only the second one', async ({ request }) => {
    test.skip(!claimA, 'no claim');
    const res = await remove(request, claimA);
    const body = await json(res);
    expect(config.passStatuses, `delete: HTTP ${res.status()}`).toContain(res.status());
    expect(body.message).toContain('deleted');
    const left = (await json(await claims(request))).data;
    expect(left.map((c: any) => c.warrantyClaimId)).toEqual([claimB]);
    claimA = '';
  });

  test('9. Deleting a claim that is already deleted is refused', async ({ request }) => {
    test.skip(!claimB, 'no claim');
    const firstId = (await json(await save(request, claimBody({ claimNumber: 'AUTO-C' })))).data.warrantyClaimId as string;
    expect(ok(await remove(request, firstId))).toBe(true);
    const again = await remove(request, firstId);
    expect(config.passStatuses).not.toContain(again.status());
    expect(JSON.stringify(await json(again))).toContain('does not exist');
  });

  test('10. Clean up: delete the last claim and the work order', async ({ request }) => {
    test.skip(!workOrderId, 'setup failed');
    if (claimB) expect(ok(await remove(request, claimB)), 'delete claim B').toBe(true);
    claimB = '';
    expect((await json(await claims(request))).data).toEqual([]);
    const del = await request.delete(`${orderUrl}?orderId=${orderId}`, { headers, timeout: config.timeoutMs });
    expect(ok(del), `delete order: HTTP ${del.status()}`).toBe(true);
    orderId = 0;
  });

  test.afterAll(async () => {
    if (!workOrderId || (!orderId && !claimA && !claimB)) return;
    const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
    const list = await json(await ctx.get(`${claimsUrl}?WorkOrderId=${workOrderId}`, { headers }));
    for (const c of list.data ?? []) {
      await ctx.delete(`${claimsUrl}?WorkOrderId=${workOrderId}&WarrantyClaimId=${encodeURIComponent(c.warrantyClaimId)}`, { headers });
    }
    if (orderId) await ctx.delete(`${orderUrl}?orderId=${orderId}`, { headers });
    await ctx.dispose();
    console.log(`Cleanup: warranty claims and order ${orderId || '-'} removed`);
  });
});

// Validation (nothing is changed: every request below is rejected before anything is saved).
test.describe('Warranty claim: bad input is refused', () => {
  test('Viewing claims without saying which work order is refused', async ({ request }) => {
    const res = await request.get(claimsUrl, { headers, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('WorkOrderId must be greater than 0');
  });

  test('Saving a claim for work order 0 is refused', async ({ request }) => {
    const res = await request.post(`${claimsUrl}?WorkOrderId=0`, { headers, data: claimBody(), timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('WorkOrderId must be greater than 0');
  });

  test('A claim type longer than one letter is refused', async ({ request }) => {
    const res = await request.post(`${claimsUrl}?WorkOrderId=${IDS.workOrderId}`, { headers, data: claimBody({ claimType: 'WW', claimNumber: 'AUTO-X' }), timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('Claim Type must be 1 characters or fewer');
  });

  test('A warrantor code longer than 10 characters is refused', async ({ request }) => {
    const res = await request.post(`${claimsUrl}?WorkOrderId=${IDS.workOrderId}`, { headers, data: claimBody({ warrantorId: 'WARRANTOR-TOO-LONG', claimNumber: 'AUTO-Y' }), timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('Warrantor ID must be 10 characters or fewer');
  });

  test('Deleting a claim without saying which claim is refused', async ({ request }) => {
    const res = await request.delete(`${claimsUrl}?WorkOrderId=${IDS.workOrderId}`, { headers, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('WarrantyClaimId is required');
  });

  test('Deleting a claim that does not exist is refused', async ({ request }) => {
    const res = await request.delete(`${claimsUrl}?WorkOrderId=${IDS.workOrderId}&WarrantyClaimId=NO-SUCH`, { headers, timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('does not exist');
  });
});
