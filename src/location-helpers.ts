import { APIRequestContext } from '@playwright/test';
import { config } from './config';
import { loadTestBody } from './testdata';
import { headers, json } from './warranty-helpers';

/** Helpers for the multi-location flows (tests/flows/location.flow.spec.ts). Locations are read from the API, never hard-coded. */
export interface Location { dealerId: number; dealerGuid: string; dmsLocationId: number; name: string }

/** The web app's order type ids for the Order/All filter (and the orderTypeId inside an order). */
export const ORDER_TYPE_ID = { sales: 1, work: 2 };

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function loadLocations(request: APIRequestContext): Promise<{ status: number; locations: Location[] }> {
  const res = await request.get(`/api/v1/Dealer/Locations/${config.dealerGuid}`, { headers, timeout: config.timeoutMs });
  const body = await json(res);
  return { status: res.status(), locations: Array.isArray(body?.data) ? body.data : [] };
}

/** The location the tests run in (DEALER_ID / DEALER_GUID in .env). */
export function currentLocation(all: Location[]): Location | undefined {
  return all.find((l) => l.dealerId === config.dealerId) ?? all.find((l) => same(l.dealerGuid, config.dealerGuid));
}

/** The location to compare with: SECOND_LOCATION_DEALER_ID from .env, otherwise the first other location in the list. */
export function otherLocation(all: Location[], current: Location): Location | undefined {
  const wanted = Number(process.env.SECOND_LOCATION_DEALER_ID ?? 0);
  return wanted ? all.find((l) => l.dealerId === wanted && l.dealerId !== current.dealerId) : all.find((l) => l.dealerId !== current.dealerId);
}

/** Sets every dealerId in an order body (order, invoices, jobs ...) to this location, as the web app does for a new order. */
function setDealerId(node: any, dealerId: number): any {
  if (Array.isArray(node)) node.forEach((n) => setDealerId(n, dealerId));
  else if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) key === 'dealerId' ? (node[key] = dealerId) : setDealerId(node[key], dealerId);
  }
  return node;
}

/** A testdata order body (work order: order-create.json, parts sales order: order-parts-create.json) made for one location. */
export function orderBodyFor(file: string, location: Location, marker: string): any {
  const body = setDealerId(loadTestBody(file), location.dealerId);
  body.notes = marker;
  body.poNumber = marker.slice(0, 20);
  return body;
}

export async function saveOrderAt(request: APIRequestContext, urlLocation: Location, body: unknown) {
  const res = await request.post(`/api/v1/Order/${urlLocation.dealerGuid}`, { headers, data: body, timeout: config.timeoutMs });
  const parsed = await json(res);
  return { status: res.status(), body: parsed, orderId: Number(parsed?.data?.orderId ?? 0), dealerId: parsed?.data?.dealerId as number | undefined };
}

export async function readOrderAt(request: APIRequestContext, location: Location, orderId: number) {
  const res = await request.get(`/api/v1/Order/${location.dealerGuid}?OrderId=${orderId}`, { headers, timeout: config.timeoutMs });
  const parsed = await json(res);
  return { status: res.status(), body: parsed, order: parsed?.data };
}

export async function closeOrderAt(request: APIRequestContext, location: Location, orderId: number): Promise<number> {
  const res = await request.delete(`/api/v1/Order/${location.dealerGuid}?OrderId=${orderId}`, { headers, timeout: config.timeoutMs });
  return res.status();
}

/** The Order/All list of one location (WithCount is needed or the server answers 500). */
export async function listOrdersAt(request: APIRequestContext, location: Location, query: Record<string, string | number> = {}) {
  const qs = new URLSearchParams({ WithCount: 'true', PageNumber: '1', PageSize: '50', ...Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)])) });
  const res = await request.get(`/api/v1/Order/All/${location.dealerGuid}?${qs}`, { headers, timeout: config.timeoutMs });
  const parsed = await json(res);
  return { status: res.status(), total: Number(parsed?.data?.totalCount ?? 0), orders: (parsed?.data?.orders ?? []) as any[], body: parsed };
}
