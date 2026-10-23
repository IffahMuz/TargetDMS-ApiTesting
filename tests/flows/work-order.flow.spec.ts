import { expect, request as pwRequest } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { getOrder, guid, headers } from '../../src/warranty-helpers';
import { closeOrder, firstJobStatus, firstTechnician, forResave, newJob, nowString, saveOrder, workOrderBody } from '../../src/work-order-helpers';

test.beforeEach(pace);

// Work order creation flows, using the same POST /Order call as the web app's "New Service Order" screen. Orders are closed at the end.
// (Internal / warranty / rental / quote variants are not here: the web app never creates them. Warranty invoices come from checkout.)

test.describe.serial('Work order with details: create it, add a second job, edit it', () => {
  const marker = `AUTOMATION-WO-${Date.now()}`;
  let orderId = 0;
  let status = '';
  let tech = '';
  let firstJobId = 0;
  const wo = async (request: any) => getOrder(request, orderId);

  test('1. Creating a work order with a technician, tag, meter and pickup dates keeps every value', async ({ request }) => {
    status = await firstJobStatus(request);
    tech = await firstTechnician(request);
    const body = workOrderBody(marker);
    const inv = body.invoices[0];
    Object.assign(inv.workOrder, { serviceWriterId: tech, tagNumber: 'QA-TAG-1', meter: '123', symptomNotes: 'noise', priority: 2, pickUp: true, pickUpDate: nowString(), deliver: true, deliverDate: nowString() });
    Object.assign(inv.workOrderJobs[0], { description: 'QA job one', jobStatusId: status, technicianId: tech, symptomNotes: 'noise' });
    const res = await saveOrder(request, body);
    expect(config.passStatuses, JSON.stringify(res.body).slice(0, 250)).toContain(res.status);
    expect(res.body.message).toContain('Order saved successfully');
    orderId = res.orderId;
    expect(orderId).toBeGreaterThan(0);

    const order = await wo(request);
    expect(order).toMatchObject({ orderTypeId: 'WorkOrder', orderStatusId: 'InProgress', workOrderId: orderId, poNumber: 'AUTO-WO', notes: marker });
    const invoice = order.invoices[0];
    expect(invoice).toMatchObject({ hasWorkOrder: true, isInternal: false, isWarranty: false });
    expect(invoice.workOrder).toMatchObject({ workOrderId: orderId, serviceWriterId: tech, tagNumber: 'QA-TAG-1', meter: '123', symptomNotes: 'noise', priority: 2, pickUp: true, deliver: true });
    expect(invoice.workOrderJobs).toHaveLength(1);
    expect(invoice.workOrderJobs[0]).toMatchObject({ jobNumber: 1, description: 'QA job one', jobStatusId: status, technicianId: tech });
    firstJobId = invoice.workOrderJobs[0].jobId;
    expect(firstJobId).toBeGreaterThan(0);
  });

  test('2. Adding a second job (saving the order again) keeps the first job and the order details', async ({ request }) => {
    test.skip(!orderId, 'order was not created');
    const order = await wo(request);
    order.invoices[0].workOrderJobs.push(newJob(order, 'QA added job', status));
    const res = await saveOrder(request, forResave(order));
    expect(config.passStatuses, JSON.stringify(res.body).slice(0, 250)).toContain(res.status);
    expect(res.orderId, 'same order, not a new one').toBe(orderId);

    const after = await wo(request);
    const jobs = after.invoices[0].workOrderJobs;
    expect(jobs).toHaveLength(2);
    expect(jobs.map((j: any) => j.jobNumber).sort()).toEqual([1, 2]);
    expect(jobs.find((j: any) => j.jobNumber === 1)).toMatchObject({ jobId: firstJobId, description: 'QA job one' });
    expect(jobs.find((j: any) => j.jobNumber === 2)).toMatchObject({ description: 'QA added job', jobStatusId: status });
    expect(jobs.find((j: any) => j.jobNumber === 2).jobId).toBeGreaterThan(firstJobId);
    expect(after.invoices[0].workOrder).toMatchObject({ tagNumber: 'QA-TAG-1', meter: '123' });
  });

  test('3. Editing the PO number, notes, tag and symptoms is saved on the same order and keeps both jobs', async ({ request }) => {
    test.skip(!orderId, 'order was not created');
    const order = await wo(request);
    order.poNumber = 'AUTO-EDIT';
    order.notes = `${marker}-EDITED`;
    order.invoices[0].workOrder.tagNumber = 'QA-TAG-2';
    order.invoices[0].workOrder.symptomNotes = 'rattle';
    const res = await saveOrder(request, forResave(order));
    expect(config.passStatuses, JSON.stringify(res.body).slice(0, 250)).toContain(res.status);
    expect(res.orderId).toBe(orderId);

    const after = await wo(request);
    expect(after).toMatchObject({ poNumber: 'AUTO-EDIT', notes: `${marker}-EDITED` });
    expect(after.invoices[0].workOrder).toMatchObject({ tagNumber: 'QA-TAG-2', symptomNotes: 'rattle', meter: '123' });
    expect(after.invoices[0].workOrderJobs).toHaveLength(2);
  });

  test('4. Deleting the order closes it', async ({ request }) => {
    test.skip(!orderId, 'order was not created');
    expect(config.passStatuses).toContain(await closeOrder(request, orderId));
    expect((await wo(request)).orderStatusId, `order ${orderId} should be Closed after delete`).toBe('Closed');
    orderId = 0;
  });

  // Safety net: if a middle step failed, don't leave the test order behind.
  test.afterAll(async () => {
    if (!orderId) return;
    const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
    await ctx.delete(`/api/v1/Order/${guid}?orderId=${orderId}`, { headers });
    await ctx.dispose();
  });
});

test.describe.serial('Work order with two jobs in one request', () => {
  let orderId = 0;

  test('1. Both jobs are created, numbered 1 and 2, and a job with no status or technician is given defaults', async ({ request }) => {
    const status = await firstJobStatus(request);
    const body = workOrderBody(`AUTOMATION-WO2-${Date.now()}`);
    const jobs = body.invoices[0].workOrderJobs;
    const second = JSON.parse(JSON.stringify(jobs[0]));
    Object.assign(jobs[0], { description: 'QA job A', jobStatusId: status });
    Object.assign(second, { jobNumber: 2, description: 'QA job B', jobStatusId: '', technicianId: '' }); // sent blank on purpose
    jobs.push(second);
    const res = await saveOrder(request, body);
    expect(config.passStatuses, JSON.stringify(res.body).slice(0, 250)).toContain(res.status);
    orderId = res.orderId;
    expect(orderId).toBeGreaterThan(0);

    const created = (await getOrder(request, orderId)).invoices[0].workOrderJobs;
    expect(created).toHaveLength(2);
    const [a, b] = ['QA job A', 'QA job B'].map((d) => created.find((j: any) => j.description === d));
    expect([a.jobNumber, b.jobNumber]).toEqual([1, 2]);
    expect(a.jobStatusId).toBe(status);
    expect(b.jobStatusId, 'a blank job status gets a default').not.toBe('');
    expect(b.technicianId, 'a blank technician gets a default').not.toBe('');
  });

  test('2. Deleting the order closes it', async ({ request }) => {
    test.skip(!orderId, 'order was not created');
    expect(config.passStatuses).toContain(await closeOrder(request, orderId));
    expect((await getOrder(request, orderId)).orderStatusId).toBe('Closed');
    orderId = 0;
  });

  test.afterAll(async () => {
    if (!orderId) return;
    const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
    await ctx.delete(`/api/v1/Order/${guid}?orderId=${orderId}`, { headers });
    await ctx.dispose();
  });
});

// Each body breaks exactly ONE rule of the order validator, so it must be rejected with 400 before any order is created.
test.describe('Work order: invalid values are rejected with 400', () => {
  const L = (n: number) => 'x'.repeat(n);
  const cases: [string, (b: any) => void, string][] = [
    ['customerId 0', (b) => { b.customerId = 0; }, 'CustomerId'],
    ['dealerId 0', (b) => { b.dealerId = 0; }, 'DealerId'],
    ['an unknown order type', (b) => { b.orderTypeId = 99; }, 'OrderTypeId'],
    ['an unknown order status', (b) => { b.orderStatusId = 99; }, 'OrderStatusId'],
    ['no invoices', (b) => { b.invoices = []; }, 'Invoices'],
    ['a PO number over 30 characters', (b) => { b.poNumber = L(31); }, 'PoNumber'],
    ['an order source over 20 characters', (b) => { b.orderSource = L(21); }, 'OrderSource'],
    ['notes over 1000 characters', (b) => { b.notes = L(1001); }, 'Notes'],
    ['script tags in the notes', (b) => { b.notes = '<script>alert(1)</script>'; }, 'Notes'],
    ['a service writer over 50 characters', (b) => { b.serviceWriterId = L(51); }, 'ServiceWriterId'],
    ['a tag number over 50 characters', (b) => { b.invoices[0].workOrder.tagNumber = L(51); }, 'WorkOrder.TagNumber'],
    ['a meter reading over 20 characters', (b) => { b.invoices[0].workOrder.meter = L(21); }, 'WorkOrder.Meter'],
    ['symptom notes over 2000 characters', (b) => { b.invoices[0].workOrder.symptomNotes = L(2001); }, 'WorkOrder.SymptomNotes'],
    ['a job description over 2000 characters', (b) => { b.invoices[0].workOrderJobs[0].description = L(2001); }, 'WorkOrderJobs[0].Description'],
    ['a job unit id over 50 characters', (b) => { b.invoices[0].workOrderJobs[0].unitId = L(51); }, 'WorkOrderJobs[0].UnitId'],
    ['a job status over 20 characters', (b) => { b.invoices[0].workOrderJobs[0].jobStatusId = L(21); }, 'WorkOrderJobs[0].JobStatusId'],
    ['a job dealerId of 0', (b) => { b.invoices[0].workOrderJobs[0].dealerId = 0; }, 'WorkOrderJobs[0].DealerId'],
    ['an invoice customerId of 0', (b) => { b.invoices[0].customerId = 0; }, 'Invoices[0].CustomerId'],
    ['an unknown invoice status', (b) => { b.invoices[0].invoiceStatusId = 99; }, 'Invoices[0].InvoiceStatusId'],
  ];
  for (const [what, mutate, field] of cases) {
    test(`Creating a work order with ${what} is rejected with 400`, async ({ request }) => {
      const body = workOrderBody(`AUTOMATION-WOBAD-${Date.now()}`);
      mutate(body);
      const res = await saveOrder(request, body);
      if (res.orderId) await closeOrder(request, res.orderId); // an order was created: clean up before failing
      expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(400);
      expect(JSON.stringify(res.body)).toContain(field);
    });
  }

  test('Creating a work order with an empty body is rejected with 400', async ({ request }) => {
    const res = await saveOrder(request, {});
    expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(400);
  });
});
