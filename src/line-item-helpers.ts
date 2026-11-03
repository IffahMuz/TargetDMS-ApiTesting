import { APIRequestContext } from '@playwright/test';
import { config } from './config';
import { DATA } from './testdata';
import { getOrder, guid, headers, json, partBody, WorkOrder } from './warranty-helpers';

/** Helpers for the order line-item flows (parts, labor, miscellaneous). Labor and miscellaneous lines need REAL codes/items from the dealer. */
const LI = `/api/v1/OrderLineItem`;
const ZERO_GUID = '00000000-0000-0000-0000-000000000000';
const now = () => new Date().toISOString().slice(0, 19);
const q = '?orderSource=TargetDMSWeb';

/** First row of a list endpoint. A refused or failed call (rate limit, 5xx, dropped connection) is tried again a few times, then reported with what the API said, instead of "cannot read properties of null". */
async function firstRow(request: APIRequestContext, url: string, what: string): Promise<any> {
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await request.get(url, { headers, timeout: config.timeoutMs });
      const body = await json(res);
      if (Array.isArray(body?.data) && body.data.length) return body.data[0];
      last = `HTTP ${res.status()} ${JSON.stringify(body).slice(0, 200)}`;
    } catch (err) { last = String(err).split(/\r?\n/)[0]; }
    await new Promise((r) => setTimeout(r, 3000 * attempt));
  }
  throw new Error(`${what}: no first row after 3 tries (${last})`);
}

export async function firstJobCode(request: APIRequestContext): Promise<{ jobCode: string; description: string }> {
  return firstRow(request, `/api/v1/Dealer/JobCodes?DealerGuid=${guid}&PageNumber=1&PageSize=1`, 'Dealer/JobCodes');
}

export async function firstMiscItem(request: APIRequestContext): Promise<{ description: string; moreInfo: string }> {
  return firstRow(request, `/api/v1/Inventory/Miscellaneous/${guid}?PageNumber=1&PageSize=1`, 'Inventory/Miscellaneous');
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
const { addable: _addable, ...unitFields } = DATA.unit;
export const WG_UNIT = unitFields;
export const WG_UNAVAILABLE_UNIT = { ...DATA.unavailableUnit };
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
