import { APIRequestContext } from '@playwright/test';
import { config } from './config';
import { DATA } from './testdata';
import { getOrder, guid, headers, json, partBody, WorkOrder } from './warranty-helpers';

/** Helpers for the order line-item flows (parts, labor, miscellaneous). Labor and miscellaneous lines need REAL codes/items from the dealer. */
const LI = `/api/v1/OrderLineItem`;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const now = () => new Date().toISOString().slice(0, 19);
const q = '?orderSource=TargetDMSWeb';

export async function firstJobCode(request: APIRequestContext): Promise<{ jobCode: string; description: string }> {
  const res = await json(await request.get(`/api/v1/Dealer/JobCodes?DealerGuid=${guid}&PageNumber=1&PageSize=1`, { headers, timeout: config.timeoutMs }));
  return res.data[0];
}

export async function firstMiscItem(request: APIRequestContext): Promise<{ description: string; moreInfo: string }> {
  const res = await json(await request.get(`/api/v1/Inventory/Miscellaneous/${guid}?PageNumber=1&PageSize=1`, { headers, timeout: config.timeoutMs }));
  return res.data[0];
}

export const laborBody = (wo: WorkOrder, code: { jobCode: string; description: string }, over: Record<string, unknown> = {}) => ({
  dealerId: config.dealerId, lastUpdated: now(), invoiceId: wo.invoiceId, orderId: wo.orderId, invoiceLaborId: 0, invoiceLaborGuid: ZERO_GUID,
  invoiceGuid: wo.invoiceGuid, jobId: wo.jobId, technicianId: '', billedHours: 1, actualHours: 0, rate: 50, total: 50, retailTotal: 0,
  laborCode: code.jobCode, description: code.description, moreInfo: null, ...over,
});

export const miscBody = (wo: WorkOrder, item: { description: string; moreInfo: string }, over: Record<string, unknown> = {}) => ({
  dealerId: config.dealerId, lastUpdated: now(), invoiceId: wo.invoiceId, orderId: wo.orderId, invoiceMiscId: 0, invoiceMiscGuid: ZERO_GUID,
  invoiceGuid: wo.invoiceGuid, jobId: wo.jobId, quantitySold: 1, price: 5, retailPrice: 5, description: item.description, moreInfo: item.moreInfo, ...over,
});

/** The test customer's unit (see testdata/dealers/<dealerId>.json). A wholegood line only references it; nothing is checked out. */
export const WG_UNIT = { ...DATA.unit };
export const WG_PRICE = 100;

export const wgBody = (wo: WorkOrder, over: Record<string, unknown> = {}) => ({
  dealerId: config.dealerId, lastUpdated: now(), invoiceId: wo.invoiceId, orderId: wo.orderId, invoiceWGId: 0, invoiceWGGuid: ZERO_GUID,
  invoiceGuid: wo.invoiceGuid, jobId: wo.jobId, dealNumber: 0, ...WG_UNIT, partNumber: WG_UNIT.model, stockNumber: 'AUTO-WG', description: 'AUTOMATION wholegood',
  cost: 50, price: WG_PRICE, suggestedRetailPrice: WG_PRICE, used: false, ...over,
});

type Kind = 'Parts' | 'Labor' | 'Miscellaneous' | 'Wholegoods';
export async function saveLine(request: APIRequestContext, kind: Kind, body: object): Promise<{ status: number; body: any }> {
  const res = await request.post(`${LI}/${kind}/${guid}${q}`, { headers, data: body, timeout: config.timeoutMs });
  return { status: res.status(), body: await json(res) };
}

export async function deleteLine(request: APIRequestContext, kind: Kind, body: object): Promise<{ status: number; body: any }> {
  const res = await request.delete(`${LI}/${kind}/${guid}${q}`, { headers, data: body, timeout: config.timeoutMs });
  return { status: res.status(), body: await json(res) };
}

/** How the web app removes lines: save the whole order again without them. (The DELETE line endpoints currently return 502.) */
export async function removeAllLines(request: APIRequestContext, orderId: number): Promise<void> {
  const order = await getOrder(request, orderId);
  const invoice = order.invoices[0];
  invoice.invoiceParts = [];
  invoice.invoiceLabors = [];
  invoice.invoiceMiscs = [];
  invoice.invoiceWGs = [];
  order.orderSource = 'TargetDMSWeb';
  order.calculateTax = true;
  const res = await request.post(`/api/v1/Order/${guid}`, { headers, data: order, timeout: config.timeoutMs });
  if (!config.passStatuses.includes(res.status())) throw new Error(`re-saving the order failed: HTTP ${res.status()} ${(await res.text()).slice(0, 200)}`);
}

export { partBody };
