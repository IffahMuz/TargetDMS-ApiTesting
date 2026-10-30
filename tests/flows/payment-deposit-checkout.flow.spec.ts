import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { pace } from '../../src/pace';
import { addPart, cashPayment, checkout, createWorkOrder, getOrder, invoicesOf, json, WorkOrder } from '../../src/warranty-helpers';
import { DEPOSIT, customerBalance, depositBody, postDeposit, transient } from '../../src/payment-helpers';

test.beforeEach(pace);

/**
 * Cash deposits meeting a real checkout: a deposit taken before checkout, and cash paid at checkout that is more than the bill
 * (GiveChange, LeaveAsDeposit, CreditAccount). Each flow uses its own new work order with one part; the bill is the part price plus tax (read from the order), and checkout finalizes it, so every run leaves
 * finalized work orders and payments behind. Off by default like the other checkout flows: set RUN_CHECKOUT=true.
 */
test.describe('Checkout with deposits and cash overpayment', () => {
  test.skip(process.env.RUN_CHECKOUT !== 'true', 'Real checkouts are switched off. Set RUN_CHECKOUT=true to run them.');

  const note = (name: string, value: unknown) => test.info().annotations.push({ type: name, description: JSON.stringify(value) });
  const cents = (n: number) => Math.round(n * 100) / 100;
  const net = (invoices: any[]) => cents(invoices.flatMap((i) => i.payments ?? []).reduce((s, p) => s + Math.abs(Number(p.amount)), 0));

  /** What the customer owes: the invoice amount plus its taxes. */
  const billOf = (order: any) => cents(Number(order.invoices[0].invoiceAmount) + Number(order.invoices[0].invoiceTaxes ?? 0));

  async function newOrder(request: any): Promise<{ wo: WorkOrder; bill: number }> {
    const wo = await transient(() => createWorkOrder(request, `AUTOMATION-PAYCO-${Date.now()}`));
    await addPart(request, wo);
    const bill = billOf(await getOrder(request, wo.orderId));
    expect(bill, 'the new order has something to pay').toBeGreaterThan(DEPOSIT);
    return { wo, bill };
  }

  async function finalized(request: any, wo: WorkOrder) {
    const order = await getOrder(request, wo.orderId);
    expect(order.orderStatusId, `order status after checkout; invoices: ${JSON.stringify(order.invoices.map((i: any) => [i.invoiceStatusId, i.invoiceAmount, i.payments?.map((p: any) => p.amount)]))}`).toBe('Finalized');
    return invoicesOf(request, wo.orderId);
  }

  test('1. Cash for exactly the bill finalizes the order and records one payment of the bill', async ({ request }) => {
    const { wo, bill } = await newOrder(request);
    const res = await checkout(request, wo.orderId, { paymentAction: 'GiveChange', payments: [cashPayment(wo, bill)] });
    const body = await json(res);
    expect(res.status(), JSON.stringify(body).slice(0, 300)).toBe(200);
    const invoices = await finalized(request, wo);
    expect(invoices.every((i) => i.invoiceStatusId === 'Closed')).toBe(true);
    expect(net(invoices)).toBe(bill);
  });

  let depositOrder: WorkOrder | undefined;
  let depositBill = 0;

  test('2. A $10 deposit taken first counts toward the bill at checkout: with cash for the rest, the payments add up to the bill', async ({ request }) => {
    const { wo, bill } = await newOrder(request);
    depositOrder = wo;
    depositBill = bill;
    const dep = await postDeposit(request, depositBody([{ orderId: wo.orderId, appliedAmount: DEPOSIT }]));
    expect(dep.status(), JSON.stringify(await json(dep)).slice(0, 300)).toBe(200);
    const rest = cents(bill - DEPOSIT);
    const res = await checkout(request, wo.orderId, { takeDeposit: true, paymentAction: 'LeaveAsDeposit', payments: [cashPayment(wo, rest)] });
    const body = await json(res);
    expect(res.status(), JSON.stringify(body).slice(0, 300)).toBe(200);
    expect(net(await invoicesOf(request, wo.orderId)), 'the deposit and the cash together cover the bill').toBe(bill);
  });

  test('2b. After that checkout the order is finalized and its invoice closed [known defect]', async ({ request }) => {
    test.skip(!depositOrder, 'setup failed');
    const order = await getOrder(request, depositOrder!.orderId);
    const invoices = await invoicesOf(request, depositOrder!.orderId);
    expect(`${order.orderStatusId} / ${invoices.map((i) => i.invoiceStatusId)} (paid in full: ${net(invoices) === depositBill})`).toBe('Finalized / Closed (paid in full: true)');
  });

  for (const action of ['GiveChange', 'LeaveAsDeposit', 'CreditAccount']) {
    test(`3. Paying the bill plus $10 cash with ${action} is handled correctly`, async ({ request }) => {
      const { wo, bill } = await newOrder(request);
      const before = await customerBalance(request);
      const res = await checkout(request, wo.orderId, { paymentAction: action, payments: [cashPayment(wo, cents(bill + DEPOSIT))] });
      const body = await json(res);
      expect(res.status(), JSON.stringify(body).slice(0, 300)).toBe(200);
      const after = await customerBalance(request);
      const moved = cents(Number(after?.balanceAmount) - Number(before?.balanceAmount));
      if (action === 'LeaveAsDeposit') {
        // the bill is paid on its own closed invoice and the extra $10 stays on the order as a deposit on a new open invoice, so the order is not finalized
        const invoices = await invoicesOf(request, wo.orderId);
        const closed = invoices.filter((i) => i.invoiceStatusId === 'Closed');
        const open = invoices.filter((i) => i.invoiceStatusId === 'Open');
        expect(closed.map((i) => net([i])), 'closed invoice paid the bill').toEqual([bill]);
        expect(open.map((i) => net([i])), 'open invoice holds the extra as a deposit').toEqual([DEPOSIT]);
      } else {
        const invoices = await finalized(request, wo);
        expect(invoices.every((i) => i.invoiceStatusId === 'Closed')).toBe(true);
        // GiveChange hands the extra back, CreditAccount keeps it on the customer's account (balance down by $10). The cash row shows what was handed over.
        expect(moved, 'change in the customer balance').toBe(action === 'CreditAccount' ? -DEPOSIT : 0);
        expect(net(invoices), 'cash received').toBe(cents(bill + DEPOSIT));
      }
    });
  }
});
