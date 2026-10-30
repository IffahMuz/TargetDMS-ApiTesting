import { APIRequestContext, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { config, workDir } from './config';
import { loadTestBody } from './testdata';
import { getOrder, guid, headers, json } from './warranty-helpers';

/** Shared setup for the payment deposit tests. A deposit records one payment and splits it across existing orders without finalizing them. */
export const DEPOSIT = 10;
const now = () => new Date().toISOString().slice(0, 19);
const standingFile = path.join(workDir, 'payment-orders.json');

/** Runs a call again when the connection drops (reset, timeout, DNS). Only for calls that are safe to repeat: reads, and requests that must be refused and so record nothing. */
export async function transient<T>(call: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await call(); } catch (err) {
      if (i >= tries || !/ECONNRESET|Timeout|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(String(err))) throw err;
    }
  }
}

export interface StandingOrders { workOrderId: number; salesOrderId: number }

/** One payment as the caller sends it. paymentInfo must be JSON text (plain text makes the server answer 502). Cash by default. */
export function depositPayment(amount: number, over: Record<string, unknown> = {}) {
  const info = JSON.stringify({ source: 'AUTOMATION' });
  return {
    dealerId: config.dealerId, arPaymentId: 0, paymentType: 'Pmt Cash', paymentTypeDescription: 'Cash', paymentInfo: info, everestPaymentInfo: info,
    reference: '', cardType: '', amount, paymentDate: now(), customerId: config.customerId, ...over,
  };
}

export function depositBody(allocations: Array<{ orderId: number; appliedAmount: number }>, over: Record<string, unknown> = {}, paymentOver: Record<string, unknown> = {}) {
  const total = allocations.reduce((sum, a) => sum + a.appliedAmount, 0);
  return { customerId: config.customerId, orderSource: 'TargetDMSWeb', payment: depositPayment(Math.round(total * 100) / 100, paymentOver), allocations, ...over };
}

export function postDeposit(request: APIRequestContext, body: unknown, h: Record<string, string> = headers, dealerGuid: string = guid): Promise<APIResponse> {
  return request.post(`/api/v1/Payment/Deposit/${dealerGuid}`, { headers: h, data: body, timeout: config.timeoutMs });
}

/** Every object in a response that looks like a payment (has an amount and a payment type or payment id), wherever the API nests it. */
export function paymentsIn(node: any, found: any[] = []): any[] {
  if (Array.isArray(node)) node.forEach((n) => paymentsIn(n, found));
  else if (node && typeof node === 'object') {
    if ('amount' in node && ('paymentType' in node || 'arPaymentId' in node)) found.push(node);
    Object.values(node).forEach((v) => paymentsIn(v, found));
  }
  return found;
}

/**
 * The payments an order shows, oldest first. A deposit on one order is stored as a negative amount (a credit), while a deposit split over several orders
 * shows on each order as a positive row of that order's share, so callers compare the size of the newest rows (`size`) and the row count, not the sign.
 */
export async function orderPayments(request: APIRequestContext, orderId: number): Promise<{ order: any; payments: any[]; total: number; newest: (n: number) => number[] }> {
  const order = await transient(() => getOrder(request, orderId));
  const payments = paymentsIn(order).sort((a, b) => Number(a.arPaymentId) - Number(b.arPaymentId));
  const size = (p: any) => Math.round(Math.abs(Number(p.amount ?? 0)) * 100) / 100;
  return { order, payments, total: payments.length, newest: (n) => payments.slice(-n).map(size) };
}

export async function customerBalance(request: APIRequestContext): Promise<any> {
  return (await json(await request.get(`/api/v1/Customer/Balance/${guid}?CustomerId=${config.customerId}`, { headers, timeout: config.timeoutMs }))).data;
}

export async function createSalesOrder(request: APIRequestContext, marker: string): Promise<number> {
  const body = loadTestBody('order-parts-create.json');
  body.notes = marker;
  body.poNumber = 'AUTO-PAY';
  const created = await json(await request.post(`/api/v1/Order/${guid}`, { headers, data: body, timeout: config.timeoutMs }));
  const orderId = Number(created?.data?.orderId ?? 0);
  if (!orderId) throw new Error(`sales order not created: ${JSON.stringify(created).slice(0, 200)}`);
  return orderId;
}

async function createWorkOrderId(request: APIRequestContext, marker: string): Promise<number> {
  const body = loadTestBody('order-create.json');
  body.notes = marker;
  body.poNumber = 'AUTO-PAY';
  const created = await json(await request.post(`/api/v1/Order/${guid}`, { headers, data: body, timeout: config.timeoutMs }));
  const orderId = Number(created?.data?.orderId ?? 0);
  if (!orderId) throw new Error(`work order not created: ${JSON.stringify(created).slice(0, 200)}`);
  return orderId;
}

const isOpen = async (request: APIRequestContext, orderId: number) => {
  if (!orderId) return false;
  const order = await transient(() => getOrder(request, orderId));
  return !!order && order.orderStatusId !== 'Closed' && order.invoices?.[0]?.invoiceStatusId === 'Open';
};

/**
 * An order that has a payment can never be deleted through the API, so the deposit tests do not create new orders every run.
 * One open work order and one open sales order are kept and reused (their ids are remembered in the work folder); new ones are made only when the old ones are gone.
 */
export async function standingOrders(request: APIRequestContext): Promise<StandingOrders> {
  let saved: Partial<StandingOrders> = {};
  try { saved = JSON.parse(fs.readFileSync(standingFile, 'utf8')); } catch { /* none yet */ }
  const marker = `AUTOMATION-PAY-${Date.now()}`;
  const workOrderId = (await isOpen(request, saved.workOrderId ?? 0)) ? saved.workOrderId! : await createWorkOrderId(request, marker);
  const salesOrderId = (await isOpen(request, saved.salesOrderId ?? 0)) ? saved.salesOrderId! : await createSalesOrder(request, marker);
  fs.mkdirSync(path.dirname(standingFile), { recursive: true });
  fs.writeFileSync(standingFile, JSON.stringify({ workOrderId, salesOrderId }));
  return { workOrderId, salesOrderId };
}
