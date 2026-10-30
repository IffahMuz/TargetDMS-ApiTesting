import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { json } from '../../src/warranty-helpers';
import { DEPOSIT, StandingOrders, customerBalance, depositBody, orderPayments, postDeposit, standingOrders } from '../../src/payment-helpers';

test.beforeEach(pace);

/**
 * Cash deposits on a work order and on a sales order ($10 each). An order that has a payment cannot be deleted through the API, so the
 * flow reuses one open work order and one open sales order from run to run (see standingOrders) instead of leaving two new orders every time.
 * A deposit never finalizes the order. Card deposits are not covered: they need the card gateway.
 */
test.describe.serial('Flow: cash deposit on work orders and sales orders', () => {
  let orders: StandingOrders;
  const before: Record<string, number> = {};
  const text = async (res: any) => `HTTP ${res.status()} ${JSON.stringify(await json(res)).slice(0, 300)}`;
  const share = (data: any, orderId: number) => (data?.allocations ?? []).find((a: any) => a.orderId === orderId);

  async function deposit(request: any, allocations: Array<{ orderId: number; appliedAmount: number }>) {
    const res = await postDeposit(request, depositBody(allocations));
    const body = await json(res);
    expect(config.passStatuses, await text(res)).toContain(res.status());
    expect(body.success, JSON.stringify(body).slice(0, 300)).toBe(true);
    return body.data;
  }

  async function snapshot(request: any, name: string, orderId: number) {
    before[name] = (await orderPayments(request, orderId)).total;
  }

  test('1. A work order and a sales order are ready for deposits (reused from earlier runs when still open)', async ({ request }) => {
    orders = await standingOrders(request);
    expect(orders.workOrderId).toBeGreaterThan(0);
    expect(orders.salesOrderId).toBeGreaterThan(0);
    await snapshot(request, 'work', orders.workOrderId);
    await snapshot(request, 'sales', orders.salesOrderId);
  });

  test('2. A $10 cash deposit on the work order is recorded and the response shows the allocation', async ({ request }) => {
    test.skip(!orders, 'no orders');
    const data = await deposit(request, [{ orderId: orders.workOrderId, appliedAmount: DEPOSIT }]);
    expect(data.customerId).toBe(config.customerId);
    expect(share(data, orders.workOrderId)?.appliedAmount, JSON.stringify(data)).toBe(DEPOSIT);
  });

  test('3. The work order now lists a payment of $10 more and is still open', async ({ request }) => {
    test.skip(!orders, 'no orders');
    const { order, total, payments, newest } = await orderPayments(request, orders.workOrderId);
    expect(total, `payments seen: ${JSON.stringify(payments).slice(-300)}`).toBe(before.work + 1);
    expect(newest(1), 'size of the new payment').toEqual([DEPOSIT]);
    expect(order.invoices[0].invoiceStatusId, 'a deposit must not finalize the order').toBe('Open');
    before.work = total;
  });

  test('4. A $10 cash deposit on the sales order is recorded and shows on that order', async ({ request }) => {
    test.skip(!orders, 'no orders');
    const data = await deposit(request, [{ orderId: orders.salesOrderId, appliedAmount: DEPOSIT }]);
    expect(share(data, orders.salesOrderId)?.appliedAmount, JSON.stringify(data)).toBe(DEPOSIT);
    const { order, total, payments, newest } = await orderPayments(request, orders.salesOrderId);
    expect(total, `payments seen: ${JSON.stringify(payments).slice(-300)}`).toBe(before.sales + 1);
    expect(newest(1), 'size of the new payment').toEqual([DEPOSIT]);
    expect(order.invoices[0].invoiceStatusId, 'a deposit must not finalize the order').toBe('Open');
    before.sales = total;
  });

  test('5. One $10 cash payment split $6 / $4 between the work order and the sales order gives each its share', async ({ request }) => {
    test.skip(!orders, 'no orders');
    const data = await deposit(request, [{ orderId: orders.workOrderId, appliedAmount: 6 }, { orderId: orders.salesOrderId, appliedAmount: 4 }]);
    expect(share(data, orders.workOrderId)?.appliedAmount).toBe(6);
    expect(share(data, orders.salesOrderId)?.appliedAmount).toBe(4);
    const work = await orderPayments(request, orders.workOrderId);
    const sales = await orderPayments(request, orders.salesOrderId);
    expect(work.total, 'rows on the work order').toBe(before.work + 1);
    expect(sales.total, 'rows on the sales order').toBe(before.sales + 1);
    expect(work.newest(1), 'work order share').toEqual([6]);
    expect(sales.newest(1), 'sales order share').toEqual([4]);
    before.work = work.total;
    before.sales = sales.total;
  });

  test('6. Two deposits on the same order both stay listed and the total adds up', async ({ request }) => {
    test.skip(!orders, 'no orders');
    await deposit(request, [{ orderId: orders.workOrderId, appliedAmount: DEPOSIT }]);
    await deposit(request, [{ orderId: orders.workOrderId, appliedAmount: DEPOSIT }]);
    const { total, payments, newest } = await orderPayments(request, orders.workOrderId);
    expect(total, `payments seen: ${JSON.stringify(payments).slice(-300)}`).toBe(before.work + 2);
    expect(newest(2)).toEqual([DEPOSIT, DEPOSIT]);
  });

  test('7. The customer balance can still be read after the deposits', async ({ request }) => {
    const balance = await customerBalance(request);
    expect(typeof balance?.balanceAmount, JSON.stringify(balance)).toBe('number');
    test.info().annotations.push({ type: 'balance', description: `balanceAmount ${balance.balanceAmount}` });
  });
});
