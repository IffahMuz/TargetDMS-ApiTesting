import { expect, request as pwRequest } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { createWorkOrder, guid, headers, json, WorkOrder } from '../../src/warranty-helpers';

test.beforeEach(pace);

const clockIn = `/api/v1/Order/TimeClock/ClockIn/${guid}`;
const clockOut = `/api/v1/Order/TimeClock/ClockOut/${guid}`;
const entriesUrl = (workOrderId: number) => `/api/v1/Order/TimeClock/Entries/${guid}?WorkOrderId=${workOrderId}`;
const employeesUrl = `/api/v1/Order/TimeClock/Employees/${guid}`;
const COMPUTER = 'AUTOMATION';

// Clocking a technician in and out of a job on a work order of our own.
// SAFETY: the clock-out call identifies the technician only (not the work order), so it ends whatever session that person has open.
// This flow therefore only uses a technician who is NOT clocked in anywhere. Time entries cannot be deleted and a work order with time entries cannot be
// deleted either, so each run leaves one work order and one closed entry behind (accepted on the test dealer).
test.describe.serial('Time clock: clock a technician in and out of a job', () => {
  let wo: WorkOrder;
  let employee = '';
  let clockedIn = false;
  const entries = async (request: any) => (await json(await request.get(entriesUrl(wo.orderId), { headers, timeout: config.timeoutMs }))).data;

  test('1. Start with a new work order and pick a technician who is not clocked in anywhere', async ({ request }) => {
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
    const employees = (await json(await request.get(employeesUrl, { headers, timeout: config.timeoutMs }))).data;
    const idle = employees.find((e: any) => !e.isClockedIn);
    expect(idle, 'every technician is clocked in, so none can be used safely').toBeTruthy();
    employee = idle.salesRep;
  });

  test('2. The new work order has no time entries yet', async ({ request }) => {
    test.skip(!employee, 'no technician');
    expect(await entries(request)).toEqual([]);
  });

  test('3. Clocking in works and records the technician, work order and job', async ({ request }) => {
    test.skip(!employee, 'no technician');
    const res = await request.post(clockIn, { headers, data: { employeeId: employee, workOrderId: wo.orderId, workOrderJobId: wo.jobId, originComputerName: COMPUTER }, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, JSON.stringify(body).slice(0, 250)).toContain(res.status());
    clockedIn = true;
    expect(body.data).toMatchObject({ employeeId: employee, workOrderId: wo.orderId, workOrderJobId: wo.jobId });
    expect(body.data.laborTransId).toBeGreaterThan(0);
  });

  test('4. The work order shows one open entry for that technician', async ({ request }) => {
    test.skip(!clockedIn, 'not clocked in');
    const list = await entries(request);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ employeeId: employee, isOpen: true, clockOutTime: null, workOrderId: wo.orderId, workOrderJobId: wo.jobId });
  });

  test('5. The technician list shows them as clocked in on this work order', async ({ request }) => {
    test.skip(!clockedIn, 'not clocked in');
    const employees = (await json(await request.get(employeesUrl, { headers, timeout: config.timeoutMs }))).data;
    expect(employees.find((e: any) => e.salesRep === employee)).toMatchObject({ isClockedIn: true, workOrderId: wo.orderId, workOrderJobId: wo.jobId });
  });

  test('6. Clocking in again while already clocked in is refused', async ({ request }) => {
    test.skip(!clockedIn, 'not clocked in');
    const res = await request.post(clockIn, { headers, data: { employeeId: employee, workOrderId: wo.orderId, workOrderJobId: wo.jobId, originComputerName: COMPUTER }, timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('is already Clocked In');
    expect(await entries(request)).toHaveLength(1);
  });

  test('7. Clocking out works and records how long the technician was clocked in', async ({ request }) => {
    test.skip(!clockedIn, 'not clocked in');
    const res = await request.post(clockOut, { headers, data: { employeeId: employee, comment: 'AUTOMATION comment', notes: 'AUTOMATION notes', originComputerName: COMPUTER }, timeout: config.timeoutMs });
    const body = await json(res);
    expect(config.passStatuses, JSON.stringify(body).slice(0, 250)).toContain(res.status());
    clockedIn = false;
    expect(body.data).toMatchObject({ employeeId: employee, workOrderId: wo.orderId });
    expect(body.data.clockOutTime).toBeTruthy();
    expect(body.data.elapsedHours).toBeGreaterThanOrEqual(0);
  });

  test('8. The entry is now closed and keeps the comment and notes', async ({ request }) => {
    test.skip(!employee || clockedIn, 'not clocked out');
    const list = await entries(request);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ isOpen: false, comment: 'AUTOMATION comment', notes: 'AUTOMATION notes' });
    expect(list[0].clockOutTime).toBeTruthy();
  });

  test('9. Clocking out again when not clocked in is refused', async ({ request }) => {
    test.skip(!employee || clockedIn, 'not clocked out');
    const res = await request.post(clockOut, { headers, data: { employeeId: employee, comment: 'x', notes: 'x', originComputerName: COMPUTER }, timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('is not currently Clocked In');
  });

  test('10. A work order with time entries cannot be deleted, so it stays behind with its closed entry', async ({ request }) => {
    test.skip(!wo, 'setup failed');
    const res = await request.delete(`/api/v1/Order/${guid}?orderId=${wo.orderId}`, { headers, timeout: config.timeoutMs });
    expect(config.passStatuses).not.toContain(res.status());
    expect(JSON.stringify(await json(res))).toContain('This Order contains Time Clock/Labor Entries');
    wo = undefined as unknown as WorkOrder; // nothing more to clean up: the order and its closed entry are left on the test dealer
  });

  test.afterAll(async () => {
    const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
    if (clockedIn) await ctx.post(clockOut, { headers, data: { employeeId: employee, comment: 'AUTOMATION cleanup', notes: 'AUTOMATION cleanup', originComputerName: COMPUTER } });
    await ctx.dispose();
  });
});

// Requests refused by validation before anything happens.
test.describe('Time clock: bad requests are refused', () => {
  test('Clocking in without saying who is refused', async ({ request }) => {
    const res = await request.post(clockIn, { headers, data: { workOrderId: 1, workOrderJobId: 1, originComputerName: COMPUTER }, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
    expect(JSON.stringify(await json(res))).toContain('EmployeeId is required');
  });

  test('Clocking out without saying who is refused', async ({ request }) => {
    const res = await request.post(clockOut, { headers, data: { comment: 'x', notes: 'x', originComputerName: COMPUTER }, timeout: config.timeoutMs });
    expect(res.status()).toBe(400);
  });
});
