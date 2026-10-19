import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { createWorkOrder, guid, headers, WorkOrder } from '../../src/warranty-helpers';
import { saveLine, wgBody } from '../../src/line-item-helpers';

test.beforeEach(pace);

// Wholegood (unit) order lines. Only validation failures are tested here: no unit can currently be added to an order
// (known defect "A wholegood unit cannot be added to an order" in tests/defects), so the add / change / remove flow
// is not written yet. Each body breaks exactly ONE length/format rule, so it must be rejected before anything is saved.
test.describe('Order wholegood line: invalid values are rejected with 400', () => {
  let wo: WorkOrder;
  test.beforeAll(async ({ request }) => {
    wo = await createWorkOrder(request, `AUTOMATION-${Date.now()}`);
  });
  test.afterAll(async ({ request }) => {
    if (!wo) return;
    await request.delete(`/api/v1/Order/${guid}?orderId=${wo.orderId}`, { headers, timeout: config.timeoutMs });
  });

  const cases: [string, Record<string, unknown>, string][] = [
    ['a serial number over 100 characters', { serialNumber: 'S'.repeat(101) }, 'SerialNumber cannot exceed 100 characters'],
    ['a stock number over 50 characters', { stockNumber: 'N'.repeat(51) }, 'StockNumber cannot exceed 50 characters'],
    ['a meter reading over 20 characters', { meterReading: '1'.repeat(21) }, 'MeterReading cannot exceed 20 characters'],
    ['a received date that is not a date', { receivedDate: 'not-a-date' }, 'ReceivedDate must be a valid date'],
  ];
  for (const [what, over, message] of cases) {
    test(`Adding a wholegood with ${what} is rejected with 400`, async ({ request }) => {
      test.skip(!wo, 'setup failed');
      const res = await saveLine(request, 'Wholegoods', wgBody(wo, over));
      expect(res.status, JSON.stringify(res.body).slice(0, 250)).toBe(400);
      expect(JSON.stringify(res.body)).toContain(message);
    });
  }
});
