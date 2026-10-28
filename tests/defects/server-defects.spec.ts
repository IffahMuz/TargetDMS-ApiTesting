import { expect, APIResponse } from '@playwright/test';
import { test } from '../../src/fixtures';
import * as fs from 'fs';
import { config, tokenPath } from '../../src/config';
import { DATA, loadTestBody } from '../../src/testdata';
import { IDS } from '../../src/get-calls/types';
import { pace } from '../../src/pace';
import * as crypto from 'crypto';
import { Location, closeOrderAt, currentLocation, listOrdersAt, loadLocations, orderBodyFor, otherLocation, readOrderAt, saveOrderAt } from '../../src/location-helpers';

test.beforeEach(pace);

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
const isClientError = (status: number) => status >= 400 && status < 500;

// These tests assert the CORRECT behaviour for bad input. They currently FAIL because the API answers
// with a 5xx instead of a clean 4xx. They stay red on purpose until the defects are fixed, so the report keeps flagging them.
// Root causes found in the backend source (TargetDMS.Backend, `test` branch):
//   - GetReceipt: the token is Base64-decoded with no try/catch; a FormatException falls through to the generic 500.
//   - Wholegoods: CurrentOwnerId defaults to 0, no validator rule rejects it, and the upstream Everest call returns 500.
//   - Wholegood/Detail: an unknown id gets an empty upstream response; ReadFromJsonAsync then throws a JsonException (500).
//   - GetInventory: no upper bound on pageNumber; far pages make the upstream query time out (504).
test.describe('Known server defects (5xx instead of 4xx)', () => {
  test('GetReceipt with a malformed token should be a 4xx, not 500 [known defect]', async ({ request }) => {
    const res = await request.get('/api/v1/Notification/GetReceipt?token=abc', { timeout: config.timeoutMs });
    expect(isClientError(res.status()), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(true);
  });

  // Without a real owner the old test dealer answered 500; dealer 10543 answers 200 with the units of every owner, which is fine.
  // The check is only that the request never fails with a server error.
  test('Wholegoods without an owner filter does not fail with a server error', async ({ request }) => {
    const res = await request.get(`/api/v1/Inventory/Wholegoods/${IDS.dealerGuid}?pageNumber=1&pageSize=10`, { headers, timeout: config.timeoutMs });
    expect(res.status(), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBeLessThan(500);
  });

  test('Wholegood detail for an unknown id should be a 404, not 500 [known defect]', async ({ request }) => {
    const res = await request.get(`/api/v1/Inventory/Wholegood/Detail/${IDS.dealerGuid}?InventoryWgId=NO-SUCH-UNIT`, { headers, timeout: config.timeoutMs });
    expect(isClientError(res.status()), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(true);
  });

  // Deleting a tag removes it from the tag list and from the part's tagDetails, but the assignment row stays behind:
  // GetInventory with tag=<deleted id> still returns the item until Tags/Remove is called with the deleted id.
  test('Deleting a tag should clear its inventory assignments [known defect]', async ({ request }) => {
    const guid = IDS.dealerGuid;
    const filter = (tag: string) => request.post('/api/v1/Inventory/GetInventory', {
      headers,
      data: { dealerId: String(IDS.dealerId), itemType: '', search: '', mfrCode: '', availability: '', categoryId: '', condition: 'New', modelCode: '', tag, pageNumber: 0, pageSize: 10 },
      timeout: config.timeoutMs,
    });
    const created = await json(await request.post(`/api/v1/Dealer/Tag/${guid}`, {
      headers, data: { tagId: 0, name: `AUTOMATION-stale-${Date.now()}`, color: '#111111', isActive: true, category: 'Inventory' }, timeout: config.timeoutMs,
    }));
    const tagId = created.data.tagId as number;
    const part = { inventoryPartId: DATA.searchPart.inventoryPartId };
    try {
      await request.post(`/api/v1/Dealer/Tags/Assign/${guid}`, { headers, data: { tagIds: [tagId], inventoryParts: [part] }, timeout: config.timeoutMs });
      expect((await json(await filter(String(tagId)))).data.totalCount, 'assignment should be visible before delete').toBe(1);
      const del = await request.delete(`/api/v1/Dealer/Tag/${guid}/${tagId}`, { headers, timeout: config.timeoutMs });
      expect(config.passStatuses).toContain(del.status());
      const after = (await json(await filter(String(tagId)))).data.totalCount;
      expect(after, `deleted tag ${tagId} still matches ${after} inventory item(s)`).toBe(0);
    } finally {
      await request.post(`/api/v1/Dealer/Tags/Remove/${guid}`, { headers, data: { tagIds: [tagId], inventoryParts: [part] }, timeout: config.timeoutMs });
      await request.delete(`/api/v1/Dealer/Tag/${guid}/${tagId}`, { headers, timeout: config.timeoutMs });
    }
  });

  // Swagger/validator (SaveDealerTagRequestValidator): "IsActive cannot be set to false. Use the delete tag endpoint".
  // The deployed API accepts isActive=false with 200 and stores it.
  test('Saving a tag with isActive=false should be rejected with 400 [known defect]', async ({ request }) => {
    const guid = IDS.dealerGuid;
    const created = await json(await request.post(`/api/v1/Dealer/Tag/${guid}`, {
      headers, data: { tagId: 0, name: `AUTOMATION-inactive-${Date.now()}`, color: '#222222', isActive: true, category: 'Public' }, timeout: config.timeoutMs,
    }));
    const tagId = created.data.tagId as number;
    try {
      const res = await request.post(`/api/v1/Dealer/Tag/${guid}`, {
        headers, data: { tagId, name: `AUTOMATION-inactive-upd-${Date.now()}`, color: '#222222', isActive: false, category: 'Public' }, timeout: config.timeoutMs,
      });
      expect(res.status(), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(400);
    } finally {
      await request.delete(`/api/v1/Dealer/Tag/${guid}/${tagId}`, { headers, timeout: config.timeoutMs });
    }
  });

  // POST User/RevokeToken answers 200 / true, but the token keeps working: GET /User still returns 200 for at least 40 seconds,
  // Auth/ValidateToken still says true, and the matching refresh token still issues new tokens. The backend returns
  // `IsSuccessStatusCode` from the identity server and revokes with an access-token hint only.
  test('A revoked access token should stop working [known defect]', async ({ request }) => {
    test.skip(!config.username || !config.password, 'API_USERNAME / API_PASSWORD are not set');
    test.skip(config.skipRevoke, 'SKIP_TOKEN_REVOKE=true');
    const login = await json(await request.post('/api/v1/Auth/Login', {
      data: { dmsDealerId: config.dmsDealerId || undefined, userName: config.username, password: config.password }, timeout: config.timeoutMs,
    }));
    const own = login.data.accessToken as string;
    const revoke = await request.post('/api/v1/User/RevokeToken', { headers: { Authorization: `Bearer ${own}` }, timeout: config.timeoutMs });
    expect(config.passStatuses).toContain(revoke.status());
    await new Promise((r) => setTimeout(r, 5000));
    const after = await request.get(`/api/v1/Customer/Categories/${IDS.dealerGuid}`, { headers: { Authorization: `Bearer ${own}` }, timeout: config.timeoutMs });
    expect(after.status(), 'a revoked token should be rejected with 401').toBe(401);
  });

  // Order/All answers 500 "The JSON value could not be converted to System.Int32. Path: $[0].TotalCount" whenever it is called
  // WITHOUT WithCount=true and the query matches at least one order. With WithCount=true (what the web app sends) it works, so the
  // green tests use that flag (src/get-calls/order.ts, tests/flows/order-tag.flow.spec.ts). Queries that match nothing return 200.
  test('Order/All without WithCount should return a customer\'s orders, not 500 [known defect]', async ({ request }) => {
    const res = await request.get(`/api/v1/Order/All/${IDS.dealerGuid}?CustomerId=${IDS.customerId}&PageNumber=1&PageSize=5`, { headers, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, `HTTP ${res.status()}: ${JSON.stringify(body).slice(0, 200)}`).toContain(res.status());
    expect(body.data.orders.length).toBeGreaterThan(0);
  });

  // Saving a warranty claim for work order 99999999 (which does not exist) returns 200 and stores an orphan claim,
  // and GET claims for that work order then lists it. The test removes any claim it created.
  test('A claim can be saved for a work order that does not exist (it should be refused) [known defect]', async ({ request }) => {
    const claims = `/api/v1/Dealer/WarrantyClaims/${IDS.dealerGuid}`;
    const missingWo = 99999999;
    const body = {
      warrantyClaimId: null, warrantorId: DATA.warrantor.id, claimType: 'W', claimNumber: 'AUTO-ORPHAN', subtotal: 0, tax: 0, total: 0,
      failedDate: '2026-10-01T00:00:00', modelNumber: 'MODEL-X', mfrId: 'STI', serialNumber: 'SN-AUTO-1', failedPartName: 'Blade',
    };
    const res = await request.post(`${claims}?WorkOrderId=${missingWo}`, { headers, data: body, timeout: config.timeoutMs });
    const status = res.status();
    try {
      expect(config.passStatuses, `HTTP ${status}: a claim was stored for a work order that does not exist`).not.toContain(status);
    } finally {
      const list = await json(await request.get(`${claims}?WorkOrderId=${missingWo}`, { headers, timeout: config.timeoutMs }));
      for (const c of list.data ?? []) {
        await request.delete(`${claims}?WorkOrderId=${missingWo}&WarrantyClaimId=${encodeURIComponent(c.warrantyClaimId)}`, { headers, timeout: config.timeoutMs });
      }
    }
  });

  // An empty claim body returns 502 whose message exposes a database column name ("WARRANTYCLAIM"."WARRANTORID").
  test('Saving an empty claim shows a database error (it should say what is missing) [known defect]', async ({ request }) => {
    const res = await request.post(`/api/v1/Dealer/WarrantyClaims/${IDS.dealerGuid}?WorkOrderId=${IDS.workOrderId}`, { headers, data: {}, timeout: config.timeoutMs });
    const text = JSON.stringify(await json(res));
    expect(res.status(), `HTTP ${res.status()}: ${text.slice(0, 200)}`).toBe(400);
    expect(text).not.toMatch(/WARRANTYCLAIM|column/i);
  });

  // Deleting a warranty claim leaves the line item's moreInfo.WarrantyClaimId pointing at it. The item is still treated as covered
  // (the customer's invoice amount stays 0 and the web app still shows Checkout), yet no claim exists to bill. Please confirm the intended behaviour.
  test('Deleting a claim leaves parts pointing at it, so the customer pays nothing for them [known defect]', async ({ request }) => {
    const { createWorkOrder, createClaim, addPart, getOrder, cleanUpOpenOrder, guid: dealerGuid } = await import('../../src/warranty-helpers');
    const { claimIdOf } = await import('../../src/warranty-rules');
    const wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    try {
      const claimId = await createClaim(request, wo, 'DD');
      await addPart(request, wo, claimId);
      const del = await request.delete(`/api/v1/Dealer/WarrantyClaims/${dealerGuid}?WorkOrderId=${wo.orderId}&WarrantyClaimId=${claimId}`, { headers, timeout: config.timeoutMs });
      expect(config.passStatuses).toContain(del.status());
      const invoice = (await getOrder(request, wo.orderId)).invoices[0];
      expect(claimIdOf(invoice.invoiceParts[0].moreInfo), `part still points at deleted claim ${claimId}; customer amount is ${invoice.invoiceAmount}`).toBeNull();
    } finally {
      await cleanUpOpenOrder(request, wo.orderId);
    }
  });

  // A payment whose paymentInfo / everestPaymentInfo is not JSON makes checkout fail with a 502 that exposes a JSON parser message
  // ("'p' is an invalid start of a value"). It should be a clean 400 telling the caller which field is wrong.
  test('Unreadable payment details show a technical error (it should say which field is wrong) [known defect]', async ({ request }) => {
    const { createWorkOrder, addPart, cashPayment, checkout, cleanUpOpenOrder, PART_PRICE } = await import('../../src/warranty-helpers');
    const wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    try {
      await addPart(request, wo);
      const res = await checkout(request, wo.orderId, { payments: [cashPayment(wo, PART_PRICE, { paymentInfo: 'plain text' })] });
      const text = JSON.stringify(await json(res));
      expect(res.status(), `HTTP ${res.status()}: ${text.slice(0, 200)}`).toBe(400);
      expect(text).not.toMatch(/invalid start of a value|\[SERVICE\]/);
    } finally {
      await cleanUpOpenOrder(request, wo.orderId);
    }
  });

  // The DELETE OrderLineItem endpoints answer 502 "The external service returned an error." whatever body is sent
  // (full item, item returned by the add, ids only, with or without orderSource). The web app removes lines by saving the whole order again.
  // (The wholegood DELETE cannot be tested yet: no unit can be added, see the wholegood tests below.)
  for (const kind of ['Parts', 'Labor', 'Miscellaneous'] as const) {
    test(`Deleting a ${kind === 'Parts' ? 'part' : kind === 'Labor' ? 'labor' : 'miscellaneous'} line directly fails with a vague error (it should work) [known defect]`, async ({ request }) => {
      const { createWorkOrder, guid: dealerGuid, getOrder } = await import('../../src/warranty-helpers');
      const lh = await import('../../src/line-item-helpers');
      const wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
      try {
        let added: any;
        if (kind === 'Parts') added = (await lh.saveLine(request, 'Parts', lh.partBody(wo))).body.data.part;
        if (kind === 'Labor') added = (await lh.saveLine(request, 'Labor', lh.laborBody(wo, await lh.firstJobCode(request)))).body.data.labor;
        if (kind === 'Miscellaneous') added = (await lh.saveLine(request, 'Miscellaneous', lh.miscBody(wo, await lh.firstMiscItem(request)))).body.data.misc;
        expect(added, 'the line was not added').toBeTruthy();
        const res = await lh.deleteLine(request, kind, added);
        expect(config.passStatuses, `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`).toContain(res.status);
        const inv = (await getOrder(request, wo.orderId)).invoices[0];
        const left = kind === 'Parts' ? inv.invoiceParts : kind === 'Labor' ? inv.invoiceLabors.filter((l: any) => l.description !== 'SHOP SUPPLIES') : inv.invoiceMiscs;
        expect(left).toHaveLength(0);
      } finally {
        await request.delete(`/api/v1/Order/${dealerGuid}?orderId=${wo.orderId}`, { headers, timeout: config.timeoutMs });
      }
    });
  }

  // Deleting a wholegood line directly answers 502 "The external service returned an error", like the part, labor and miscellaneous lines above.
  // (Adding and updating one works; see tests/flows/order-wholegood.flow.spec.ts.)
  test('Deleting a wholegood line directly fails with a vague error (it should work) [known defect]', async ({ request }) => {
    test.skip(!DATA.unit.addable, 'this dealer has no available wholegood unit to add');
    const { createWorkOrder, guid: dealerGuid } = await import('../../src/warranty-helpers');
    const lh = await import('../../src/line-item-helpers');
    const wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    try {
      const added = (await lh.saveLine(request, 'Wholegoods', lh.wgBody(wo))).body.data?.wg;
      expect(added, 'the wholegood was not added').toBeTruthy();
      const res = await lh.deleteLine(request, 'Wholegoods', added);
      expect(config.passStatuses, `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`).toContain(res.status);
    } finally {
      await request.delete(`/api/v1/Order/${dealerGuid}?orderId=${wo.orderId}`, { headers, timeout: config.timeoutMs });
    }
  });

  // PartNumber is required by the upstream system but not by the validator, so leaving it out reaches upstream and comes back as a 502.
  // It should be a clean 400 ("PartNumber is required") from the validator.
  test('A wholegood line without a part number is a vague 502 (it should be a 400) [known defect]', async ({ request }) => {
    const { createWorkOrder, guid: dealerGuid } = await import('../../src/warranty-helpers');
    const lh = await import('../../src/line-item-helpers');
    const wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    try {
      const res = await lh.saveLine(request, 'Wholegoods', lh.wgBody(wo, { partNumber: undefined }));
      expect(res.status, `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 250)}`).toBe(400);
    } finally {
      await request.delete(`/api/v1/Order/${dealerGuid}?orderId=${wo.orderId}`, { headers, timeout: config.timeoutMs });
    }
  });

  // Clock-in accepts a work order that does not exist and stores an entry for it. The test closes the entry again.
  test('A technician can be clocked in to a work order that does not exist (it should be refused) [known defect]', async ({ request }) => {
    const base = `/api/v1/Order/TimeClock`;
    const { guid: dealerGuid } = await import('../../src/warranty-helpers');
    const employees = (await json(await request.get(`${base}/Employees/${dealerGuid}`, { headers, timeout: config.timeoutMs }))).data;
    const idle = employees.find((e: any) => !e.isClockedIn);
    test.skip(!idle, 'no idle technician to test with');
    const res = await request.post(`${base}/ClockIn/${dealerGuid}`, { headers, data: { employeeId: idle.salesRep, workOrderId: 99999999, workOrderJobId: 1, originComputerName: 'AUTOMATION' }, timeout: config.timeoutMs });
    const status = res.status();
    try {
      expect(config.passStatuses, `HTTP ${status}: an entry was stored for a work order that does not exist`).not.toContain(status);
    } finally {
      if (config.passStatuses.includes(status)) {
        await request.post(`${base}/ClockOut/${dealerGuid}`, { headers, data: { employeeId: idle.salesRep, comment: 'AUTOMATION cleanup', notes: 'closing a test entry', originComputerName: 'AUTOMATION' }, timeout: config.timeoutMs });
      }
    }
  });

  // An unknown technician id returns a raw database error ("string right truncation") instead of a clear message.
  test('An unknown technician shows a database error (it should say the technician was not found) [known defect]', async ({ request }) => {
    const { guid: dealerGuid } = await import('../../src/warranty-helpers');
    const res = await request.post(`/api/v1/Order/TimeClock/ClockIn/${dealerGuid}`, { headers, data: { employeeId: 'NO-SUCH-EMP', workOrderId: 1, workOrderJobId: 1, originComputerName: 'AUTOMATION' }, timeout: config.timeoutMs });
    const text = JSON.stringify(await json(res));
    expect(res.status(), `HTTP ${res.status()}: ${text.slice(0, 200)}`).toBeLessThan(500);
    expect(text).not.toMatch(/truncation|arithmetic exception|numeric overflow/i);
  });

  // Inventory count update: UpdateInventoryCountItemValidator says itemId > 0, quantity >= 0, binLocation <= 40 chars and safe input,
  // but the body is an array, so those rules are never applied. Bad values reach the upstream system instead: some come back as a vague 502,
  // a long bin location leaks a database error, and an unsafe bin location is accepted. These use an item and count that cannot exist.
  const countUrl = (id: number) => `/api/v1/Inventory/Count/${config.dealerGuid}/${id}`;
  const badUpdates: [string, unknown][] = [
    ['an item number of 0', [{ itemId: 0, quantity: 1, binLocation: 'A' }]],
    ['a negative quantity', [{ itemId: 999999999, quantity: -1, binLocation: 'A' }]],
    ['an empty list', []],
  ];
  for (const [what, items] of badUpdates) {
    test(`Updating a count with ${what} should be a clean 400, not a vague 502 [known defect]`, async ({ request }) => {
      const res = await request.put(countUrl(99999999), { headers, data: items, timeout: config.timeoutMs });
      expect(res.status(), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 160)}`).toBe(400);
    });
  }

  test('A bin location longer than 40 characters shows a database error (it should be a clean 400) [known defect]', async ({ request }) => {
    const res = await request.put(countUrl(99999999), { headers, data: [{ itemId: 999999999, quantity: 1, binLocation: 'x'.repeat(41) }], timeout: config.timeoutMs });
    const text = JSON.stringify(await json(res));
    expect(res.status(), `HTTP ${res.status()}: ${text.slice(0, 160)}`).toBe(400);
    expect(text).not.toMatch(/FIREBIRD|truncation|arithmetic exception/i);
  });

  test('A bin location containing script tags is accepted (it should be refused) [known defect]', async ({ request }) => {
    const res = await request.put(countUrl(99999999), { headers, data: [{ itemId: 999999999, quantity: 1, binLocation: '<script>alert(1)</script>' }], timeout: config.timeoutMs });
    expect(res.status(), 'unsafe input should be refused with a 400').toBe(400);
  });

  // Purchase order receive: PurchaseOrderDetailDtoValidator (itemId > 0, quantities >= 0, productType <= 50, serial <= 50, prices >= 0, safe input)
  // is never applied because the body is an array. Bad input either reaches the upstream system and comes back as a vague 502
  // ("ProductType field is required", "itemId must be greater than 0"...) or is accepted silently. Every request uses an item that cannot exist,
  // so nothing is ever received. A purchase order that does not exist is also answered with 200.
  const poReceive = (request: any, id: number, items: unknown) =>
    request.put(`/api/v1/PurchaseOrder/Receive/${IDS.dealerGuid}/${id}`, { headers, data: items, timeout: config.timeoutMs });
  const noItem = { itemId: 999999999, receivedQty: 0, backOrderQty: 0, productType: 'P' };
  const badReceives: [string, unknown][] = [
    ['an empty list', []],
    ['an item number of 0', [{ ...noItem, itemId: 0 }]],
    ['a negative received quantity', [{ ...noItem, receivedQty: -1 }]],
    ['a negative back-order quantity', [{ ...noItem, backOrderQty: -1 }]],
    ['no product type', [{ itemId: 999999999, receivedQty: 0, backOrderQty: 0 }]],
    ['a product type over 50 characters', [{ ...noItem, productType: 'P'.repeat(51) }]],
    ['a serial number over 50 characters', [{ ...noItem, serialNumbers: [{ serialNumber: 'S'.repeat(51), price: 0, listPrice: 0 }] }]],
    ['a negative serial price', [{ ...noItem, serialNumbers: [{ serialNumber: 'X', price: -1, listPrice: 0 }] }]],
    ['script tags in the bin location', [{ ...noItem, binLocation: '<script>alert(1)</script>' }]],
  ];
  for (const [what, items] of badReceives) {
    test(`Receiving a purchase order with ${what} should be a clean 400 [known defect]`, async ({ request }) => {
      const res = await poReceive(request, DATA.purchaseOrderId, items);
      expect(res.status(), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 160)}`).toBe(400);
    });
  }

  test('Receiving a purchase order that does not exist is answered with success (it should be a 404) [known defect]', async ({ request }) => {
    const res = await poReceive(request, 99999999, [noItem]);
    expect(config.passStatuses, `HTTP ${res.status()}: a purchase order that does not exist was accepted`).not.toContain(res.status());
  });

  // Work order creation: the validator allows a job status of up to 20 characters, but the upstream system needs exactly one character
  // ("JobStatusId must be a single alphanumeric character"), and an unknown technician is only noticed upstream ("SalesRep (...) not found").
  // Both come back as a vague 502; they should be a clean 400 from the validator. If an order is ever created, the test closes it.
  const woDefect = async (request: any, over: (job: any) => void) => {
    const wh = await import('../../src/work-order-helpers');
    const body = wh.workOrderBody(`AUTOMATION-WODEF-${Date.now()}`);
    over(body.invoices[0].workOrderJobs[0]);
    const res = await wh.saveOrder(request, body);
    if (res.orderId) await wh.closeOrder(request, res.orderId);
    return res;
  };
  test('A work order job status of more than one character is a vague 502 (it should be a clean 400) [known defect]', async ({ request }) => {
    const res = await woDefect(request, (job) => { job.jobStatusId = 'ZZZ'; });
    expect(res.status, `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(400);
  });

  test('A work order job for a technician that does not exist is a 502 (it should be a 400 or 404) [known defect]', async ({ request }) => {
    const res = await woDefect(request, (job) => { job.technicianId = 'NO-SUCH-TECH'; });
    expect(isClientError(res.status), `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(true);
  });

  // Notification defects. Every request uses an order / customer that cannot exist, so nothing is ever sent.
  // (SendPayByLinkEmail has the same loose domain check but a request for a missing order still SENDS the email, so it is not probed here.)
  const notify = (request: any, path: string, data: unknown) =>
    request.post(`/api/v1/Notification/${path}`, { headers, data, timeout: config.timeoutMs });

  test('Sending a receipt email for an order that does not exist shows a JSON parser error (it should say "Details not found") [known defect]', async ({ request }) => {
    const res = await notify(request, 'SendReceiptToEmail', { dmsDealerId: config.locationDmsId, dealerId: IDS.dealerId, orderId: 999999999, customerId: 999999999, invoiceId: 999999999 });
    const text = JSON.stringify(await json(res));
    expect(isClientError(res.status()), `HTTP ${res.status()}: ${text.slice(0, 200)}`).toBe(true);
    expect(text).not.toMatch(/JSON token|LineNumber/i);
  });

  // The file link check is host.Contains("targetumh"), so a link on someone else's domain that merely contains the word passes validation.
  // The request below is for a customer that does not exist (404 "Data not found"), which proves the link got past validation without sending anything.
  test('A file link on https://targetumh.evil.com passes the trusted-domain check (it should be refused with 400) [known defect]', async ({ request }) => {
    const res = await notify(request, 'SendFilesToEmail', {
      dmsDealerId: config.locationDmsId, dealerId: IDS.dealerId, customerId: 999999999,
      files: [{ fileName: 'a.png', fileUrl: 'https://targetumh.evil.com/a.png', fileType: 'image/png' }],
    });
    expect(res.status(), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(400);
  });

  test('GetInventory far past the last page should return an empty list, not time out [known defect]', async ({ request }) => {
    const res = await request.post('/api/v1/Inventory/GetInventory', {
      headers,
      data: { dealerId: String(IDS.dealerId), itemType: '', search: '', mfrCode: '', availability: '', categoryId: '', condition: 'New', modelCode: '', tag: '', pageNumber: 1000, pageSize: 25 },
      timeout: config.timeoutMs,
    });
    expect(config.passStatuses, `HTTP ${res.status()}`).toContain(res.status());
    expect((await json(res)).data.inventory).toEqual([]);
  });
});

// Two locations of one company (found from Dealer/Locations; see tests/flows/location.flow.spec.ts).
test.describe('Known server defects across locations', () => {
  const twoLocations = async (request: any) => {
    const { locations } = await loadLocations(request);
    const current = currentLocation(locations);
    const other = current && otherLocation(locations, current);
    test.skip(!current || !other, 'this company has only one location');
    return { current: current!, other: other! };
  };

  // The customer list is company-wide (same total and ids in every location), but reading one customer through another location's GUID gets an empty upstream answer.
  test('A customer of the company can be read through any location, not a 500 JSON parser error [known defect]', async ({ request }) => {
    const { other } = await twoLocations(request);
    const res = await request.get(`/api/v1/Customer?DealerGuid=${other.dealerGuid}&CustomerId=${config.customerId}`, { headers, timeout: config.timeoutMs });
    expect(res.status(), `HTTP ${res.status()} at ${other.name}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(200);
  });

  // The order is correctly not found, but the 404 from the order service comes back wrapped as a 502.
  test('Reading an order that belongs to another location is a 404, not a 502 [known defect]', async ({ request }) => {
    const { current, other } = await twoLocations(request);
    const theirs = (await listOrdersAt(request, other, { PageSize: 1 })).orders[0];
    test.skip(!theirs, `${other.name} has no orders to read`);
    const res = await readOrderAt(request, current, theirs.orderId);
    expect(isClientError(res.status), `HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(true);
  });
});

// Location handling. The cases are written against the correct behaviour; the locations come from Dealer/Locations at run time, nothing is hard-coded.
test.describe('Known server defects in location handling', () => {
  const unknownGuid = () => crypto.randomUUID();
  const text = async (res: any) => JSON.stringify(await json(res)).slice(0, 220);

  const locationsOf = async (request: any) => {
    const { locations } = await loadLocations(request);
    const current = currentLocation(locations);
    test.skip(!current, 'the current location is not in the location list');
    return { all: locations, current: current! };
  };

  test('NEG-05 Dealer/Locations for a GUID that does not exist is a 404 without internal error text [known defect]', async ({ request }) => {
    const res = await request.get(`/api/v1/Dealer/Locations/${unknownGuid()}`, { headers, timeout: config.timeoutMs });
    const body = await text(res);
    expect(res.status(), body).toBe(404);
    expect(body, 'the message shows internal text').not.toMatch(/Response status code does not indicate success/i);
  });

  // The same condition (no such dealer) is a clean 404 for Locations, Wholegoods and SalesReps but a 502 "Dealer not found" for these.
  const unknownDealerCalls: [string, (request: any, guid: string, here: Location) => Promise<any>][] = [
    ['Order/All', (r, g) => r.get(`/api/v1/Order/All/${g}?WithCount=true&PageNumber=1&PageSize=1`, { headers, timeout: config.timeoutMs })],
    ['reading an order', (r, g) => r.get(`/api/v1/Order/${g}?OrderId=1`, { headers, timeout: config.timeoutMs })],
    ['closing an order', (r, g) => r.delete(`/api/v1/Order/${g}?OrderId=1`, { headers, timeout: config.timeoutMs })],
    ['creating an order', (r, g, here) => r.post(`/api/v1/Order/${g}`, { headers, data: orderBodyFor('order-parts-create.json', here, 'AUTOMATION-NEG'), timeout: config.timeoutMs })],
    ['Inventory/Count', (r, g) => r.get(`/api/v1/Inventory/Count/${g}?LocationId=1&PageNumber=1&PageSize=1`, { headers, timeout: config.timeoutMs })],
    ['Dealer/Configuration', (r, g) => r.get(`/api/v1/Dealer/Configuration/${g}?Source=TargetDMS&EntityName=Setup`, { headers, timeout: config.timeoutMs })],
    ['Customer/All', (r, g) => r.get(`/api/v1/Customer/All?DealerGuid=${g}&PageNumber=1&PageSize=1`, { headers, timeout: config.timeoutMs })],
  ];
  for (const [what, call] of unknownDealerCalls) {
    test(`NEG-07 ${what} for a GUID that does not exist is a 404, not a 502 [known defect]`, async ({ request }) => {
      const { current } = await locationsOf(request);
      const res = await call(request, unknownGuid(), current);
      expect(res.status(), await text(res)).toBe(404);
    });
  }

  test('NEG-10 Reading an order that does not exist is a 404, not a 502 [known defect]', async ({ request }) => {
    const { current } = await locationsOf(request);
    const res = await request.get(`/api/v1/Order/${current.dealerGuid}?OrderId=999999999`, { headers, timeout: config.timeoutMs });
    expect(res.status(), await text(res)).toBe(404);
  });

  for (const [what, path] of [['Inventory counts', 'Inventory/Count'], ['Purchase orders', 'PurchaseOrder']] as const) {
    test(`NEG-13 ${what} for a location id no location has is a 400 or an empty list, not a 502 [known defect]`, async ({ request }) => {
      const { current } = await locationsOf(request);
      const res = await request.get(`/api/v1/${path}/${current.dealerGuid}?LocationId=999999&PageNumber=1&PageSize=5`, { headers, timeout: config.timeoutMs });
      const body = await json(res);
      const refusedOrEmpty = res.status() === 400 || (res.status() === 200 && (body.data?.items ?? []).length === 0);
      expect(refusedOrEmpty, `HTTP ${res.status()}: ${JSON.stringify(body).slice(0, 220)}`).toBe(true);
    });
  }

  // The URL names the location. A body that names another one (or one that does not exist) is a client mistake and must be refused, not quietly saved under the URL's location.
  for (const kind of ['a dealer id that does not exist', 'another location\'s dealer id']) {
    test(`NEG-19 An order posted to the current location with ${kind} in the body is a 403 [known defect]`, async ({ request }) => {
      const { all, current } = await locationsOf(request);
      const other = otherLocation(all, current);
      test.skip(kind.startsWith('another') && !other, 'this company has only one location');
      const dealerId = kind.startsWith('another') ? other!.dealerId : Math.max(...all.map((l) => l.dealerId)) + 1;
      const body = orderBodyFor('order-parts-create.json', current, `AUTOMATION-NEG-${Date.now()}`);
      body.dealerId = dealerId;
      for (const invoice of body.invoices ?? []) invoice.dealerId = dealerId;
      const saved = await saveOrderAt(request, current, body);
      try {
        expect(saved.status, `must be 403 (the dealer id in the token does not match the one in the request): order ${saved.orderId} was saved under dealer ${saved.dealerId} although the body says ${dealerId}, HTTP ${saved.status}`).toBe(403);
      } finally {
        if (saved.orderId) await closeOrderAt(request, current, saved.orderId);
      }
    });
  }
});
