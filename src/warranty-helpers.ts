import { APIRequestContext, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { config, tokenPath } from './config';

/** Shared setup/cleanup for the warranty checkout flows (tests/flows/warranty/*). Every helper takes the Playwright `request`. */
const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
export const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
export const guid = config.dealerGuid;
/** A part with a large stock at Location 1, so repeated real checkouts never use it up (a part with no stock turns into a special order and cannot be finalized). */
export const PART_PRICE = 2.29;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const now = () => new Date().toISOString().slice(0, 19);
export const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
export const ok = (res: APIResponse) => config.passStatuses.includes(res.status());

export interface WorkOrder { orderId: number; invoiceId: number; invoiceGuid: string; jobId: number }

export async function createWorkOrder(request: APIRequestContext, marker: string): Promise<WorkOrder> {
  const raw = fs.readFileSync(path.resolve(__dirname, '..', 'testdata', 'order-create.json'), 'utf8');
  const body = JSON.parse(raw.split('{{NOW}}').join(now()));
  body.notes = marker;
  body.poNumber = 'AUTO-WARR';
  const created = await json(await request.post(`/api/v1/Order/${guid}`, { headers, data: body, timeout: config.timeoutMs }));
  const orderId = Number(created?.data?.orderId ?? 0);
  if (!orderId) throw new Error(`work order not created: ${JSON.stringify(created).slice(0, 200)}`);
  const inv = (await getOrder(request, orderId)).invoices[0];
  return { orderId, invoiceId: inv.invoiceId, invoiceGuid: inv.invoiceGuid, jobId: inv.workOrderJobs[0].jobId };
}

export async function getOrder(request: APIRequestContext, orderId: number, invoiceId?: number): Promise<any> {
  const q = invoiceId ? `OrderId=${orderId}&InvoiceId=${invoiceId}` : `OrderId=${orderId}`;
  return (await json(await request.get(`/api/v1/Order/${guid}?${q}`, { headers, timeout: config.timeoutMs }))).data;
}

/** Every invoice of an order with its line items (the order endpoint only lists items for the invoice you ask for). */
export async function invoicesOf(request: APIRequestContext, orderId: number): Promise<any[]> {
  const order = await getOrder(request, orderId);
  const full: any[] = [];
  for (const header of order.invoices) {
    const detail = await getOrder(request, orderId, header.invoiceId);
    full.push(detail.invoices.find((i: any) => i.invoiceId === header.invoiceId) ?? detail.invoices[0]);
  }
  return full;
}

export const partBody = (wo: WorkOrder, over: Record<string, unknown> = {}) => ({
  dealerId: 888166, lastUpdated: now(), invoiceId: wo.invoiceId, orderId: wo.orderId, invoicePartId: 0, invoicePartGuid: ZERO_GUID,
  invoiceGuid: wo.invoiceGuid, jobId: wo.jobId, salesPerson: '', partNumber: '62349', partNoDash: '62349', manufacturerId: 'ECHO',
  description: 'PROMO EDGER BLADE', cost: 1, price: PART_PRICE, retailPrice: PART_PRICE, quantitySold: 1, quantitySpecialOrdered: 0, filledQty: 1, moreInfo: null, ...over,
});

/** Adds a $2.29 part to the work order. Pass `claimId` to attach a warranty claim in the same call sequence. */
export async function addPart(request: APIRequestContext, wo: WorkOrder, claimId?: string): Promise<any> {
  const url = `/api/v1/OrderLineItem/Parts/${guid}?orderSource=TargetDMSWeb`;
  const added = await json(await request.post(url, { headers, data: partBody(wo), timeout: config.timeoutMs }));
  const part = added?.data?.part;
  if (!part) throw new Error(`part not added: ${JSON.stringify(added).slice(0, 200)}`);
  return claimId ? attachClaim(request, wo, part, claimId) : part;
}

/** Sets moreInfo.WarrantyClaimId on a part (claimId null/'0' clears it), exactly like the web app does. */
export async function attachClaim(request: APIRequestContext, wo: WorkOrder, part: any, claimId: string | null): Promise<any> {
  const moreInfo = JSON.stringify({ WarrantyClaimId: claimId ?? 0 });
  const res = await json(await request.post(`/api/v1/OrderLineItem/Parts/${guid}?orderSource=TargetDMSWeb`, {
    headers, data: partBody(wo, { invoicePartId: part.invoicePartId, invoicePartGuid: part.invoicePartGuid, moreInfo }), timeout: config.timeoutMs,
  }));
  if (!res?.data?.part) throw new Error(`claim not attached: ${JSON.stringify(res).slice(0, 200)}`);
  return res.data.part;
}

export async function createClaim(request: APIRequestContext, wo: WorkOrder, label: string): Promise<string> {
  const res = await json(await request.post(`/api/v1/Dealer/WarrantyClaims/${guid}?WorkOrderId=${wo.orderId}`, {
    headers, timeout: config.timeoutMs,
    data: {
      warrantyClaimId: null, warrantorId: 'GRAVELY', claimType: 'W', claimNumber: `AUTO-${label}-${Date.now().toString().slice(-6)}`,
      subtotal: 0, tax: 0, total: 0, failedDate: '2026-10-01T00:00:00', modelNumber: 'MODEL-X', mfrId: 'STI', serialNumber: 'SN-1', failedPartName: 'Blade',
    },
  }));
  const id = res?.data?.warrantyClaimId as string;
  if (!id) throw new Error(`claim not created: ${JSON.stringify(res).slice(0, 200)}`);
  return id;
}

/** A cash payment. paymentInfo and everestPaymentInfo MUST be JSON text (the server parses them; plain text returns 502). */
export function cashPayment(wo: WorkOrder, amount: number, over: Record<string, unknown> = {}) {
  const info = JSON.stringify({ source: 'AUTOMATION' });
  return {
    dealerId: 888166, arPaymentId: 0, applyInvoiceId: wo.invoiceId, paymentType: 'Pmt Cash', paymentTypeDescription: 'Cash',
    paymentInfo: info, everestPaymentInfo: info, reference: '', cardType: '', amount, paymentDate: now(), customerId: 17395, orderId: wo.orderId, ...over,
  };
}

export function checkout(request: APIRequestContext, orderId: number, over: Record<string, unknown> = {}): Promise<APIResponse> {
  return request.post(`/api/v1/Order/Checkout/${guid}`, {
    headers, timeout: config.timeoutMs, data: { orderId, orderSource: 'TargetDMSWeb', takeDeposit: false, payments: [], ...over },
  });
}

export async function claimsOf(request: APIRequestContext, orderId: number): Promise<any[]> {
  return (await json(await request.get(`/api/v1/Dealer/WarrantyClaims/${guid}?WorkOrderId=${orderId}`, { headers, timeout: config.timeoutMs }))).data ?? [];
}

/** Removes every claim and the order. Only works while the order is still open and unpaid. */
export async function cleanUpOpenOrder(request: APIRequestContext, orderId: number): Promise<void> {
  for (const c of await claimsOf(request, orderId)) {
    await request.delete(`/api/v1/Dealer/WarrantyClaims/${guid}?WorkOrderId=${orderId}&WarrantyClaimId=${encodeURIComponent(c.warrantyClaimId)}`, { headers, timeout: config.timeoutMs });
  }
  await request.delete(`/api/v1/Order/${guid}?orderId=${orderId}`, { headers, timeout: config.timeoutMs });
}
