import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { json } from '../../src/warranty-helpers';
import { DEPOSIT, StandingOrders, depositBody, depositPayment, orderPayments, postDeposit, standingOrders, transient } from '../../src/payment-helpers';

test.beforeEach(pace);

/**
 * Bad deposit requests. The API must refuse each one with a 4xx and record nothing. If it ever accepts one, the extra $10 shows on the standing order
 * and the "nothing recorded" check in the last tests fails too. The cases where the API answers wrongly (a 502 for something that is the caller's
 * mistake) belong in tests/defects/server-defects.spec.ts.
 */
test.describe('Deposit negative cases: bad input is refused and nothing is recorded', () => {
  let orders: StandingOrders;
  let startTotal = 0;
  const text = async (res: any) => `HTTP ${res.status()} ${JSON.stringify(await json(res)).slice(0, 250)}`;
  const refused = async (res: any) => {
    expect(res.status(), await text(res)).toBeGreaterThanOrEqual(400);
    expect(res.status(), await text(res)).toBeLessThan(500);
  };
  const one = () => [{ orderId: orders.workOrderId, appliedAmount: DEPOSIT }];

  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: config.baseUrl });
    orders = await standingOrders(ctx);
    startTotal = (await orderPayments(ctx, orders.workOrderId)).total;
    await ctx.dispose();
  });

  const bad: Array<[string, () => unknown]> = [
    ['NEG-01 customer id 0', () => depositBody(one(), { customerId: 0 })],
    ['NEG-02 an order source that does not exist', () => depositBody(one(), { orderSource: 'Banana' })],
    ['NEG-03 no payment at all', () => depositBody(one(), { payment: null })],
    ['NEG-04 amount 0', () => ({ ...depositBody(one()), payment: depositPayment(0) })],
    ['NEG-05 a negative amount', () => ({ ...depositBody(one()), payment: depositPayment(-DEPOSIT) })],
    ['NEG-06 an empty payment type', () => depositBody(one(), {}, { paymentType: '' })],
    ['NEG-07 a payment type of 51 characters', () => depositBody(one(), {}, { paymentType: 'P'.repeat(51) })],
    ['NEG-08 script text in the payment type', () => depositBody(one(), {}, { paymentType: '<script>alert(1)</script>' })],
    ['NEG-09 no allocations', () => ({ ...depositBody(one()), allocations: [] })],
    ['NEG-10 an allocation for order 0', () => ({ ...depositBody(one()), allocations: [{ orderId: 0, appliedAmount: DEPOSIT }] })],
    ['NEG-11 an allocation of $0', () => ({ ...depositBody(one()), allocations: [{ orderId: orders.workOrderId, appliedAmount: 0 }] })],
    ['NEG-12 a negative allocation', () => ({ ...depositBody(one()), allocations: [{ orderId: orders.workOrderId, appliedAmount: -DEPOSIT }] })],
    ['NEG-13 allocations add up to less than the payment', () => ({ ...depositBody(one()), allocations: [{ orderId: orders.workOrderId, appliedAmount: 4 }] })],
    ['NEG-14 allocations add up to more than the payment', () => ({ ...depositBody(one()), allocations: [{ orderId: orders.workOrderId, appliedAmount: 14 }] })],
  ];
  for (const [title, build] of bad) {
    test(`${title} is refused with a 4xx`, async ({ request }) => refused(await transient(() => postDeposit(request, build()))));
  }

  test('NEG-17 No token is a 401', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: config.baseUrl });
    const res = await transient(() => postDeposit(ctx, depositBody(one()), {}));
    await ctx.dispose();
    expect(res.status(), await text(res)).toBe(401);
  });

  test('NEG-18 A garbage token is a 401', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: config.baseUrl });
    const res = await transient(() => postDeposit(ctx, depositBody(one()), { Authorization: 'Bearer not.a.token' }));
    await ctx.dispose();
    expect(res.status(), await text(res)).toBe(401);
  });

  test('NEG-20 If one allocation is bad, no payment is recorded for the good one either', async ({ request }) => {
    const before = (await orderPayments(request, orders.workOrderId)).total;
    await postDeposit(request, depositBody([{ orderId: orders.workOrderId, appliedAmount: 5 }, { orderId: 999999999, appliedAmount: 5 }]));
    const after = (await orderPayments(request, orders.workOrderId)).total;
    expect(after, 'the good allocation must roll back with the bad one').toBe(before);
  });

  test('NEG-19 Nothing was recorded by any refused request above', async ({ request }) => {
    const { total, payments } = await orderPayments(request, orders.workOrderId);
    expect(total, `payments seen: ${JSON.stringify(payments).slice(-300)}`).toBe(startTotal);
  });
});
