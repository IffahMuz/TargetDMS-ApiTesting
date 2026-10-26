import { APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { loadTestBody } from './testdata';
import { guid, headers, json } from './warranty-helpers';

/** Helpers for the work order creation flows (tests/flows/work-order.flow.spec.ts). Every order is closed again by the caller. */
const now = () => new Date().toISOString().slice(0, 19);

/** The web app's "New Service Order" body (testdata/order-create.json) with a marker in the notes, so automation orders are easy to spot. */
export function workOrderBody(marker: string): any {
  const body = loadTestBody("order-create.json");
  body.notes = marker;
  body.poNumber = 'AUTO-WO';
  return body;
}

export async function saveOrder(request: APIRequestContext, body: unknown): Promise<{ status: number; body: any; orderId: number }> {
  const res = await request.post(`/api/v1/Order/${guid}`, { headers, data: body, timeout: config.timeoutMs });
  const parsed = await json(res);
  return { status: res.status(), body: parsed, orderId: Number(parsed?.data?.orderId ?? 0) };
}

export async function closeOrder(request: APIRequestContext, orderId: number): Promise<number> {
  const res = await request.delete(`/api/v1/Order/${guid}?orderId=${orderId}`, { headers, timeout: config.timeoutMs });
  return res.status();
}

/** The dealer's first active job status id (a single character such as "A"). */
export async function firstJobStatus(request: APIRequestContext): Promise<string> {
  const list = (await json(await request.get(`/api/v1/Order/WorkOrderJobStatuses/${guid}`, { headers, timeout: config.timeoutMs }))).data ?? [];
  return list.find((s: any) => s.isActive)?.jobStatusId ?? list[0].jobStatusId;
}

/** The first technician (employeeType "Tech") from the sales rep list. */
export async function firstTechnician(request: APIRequestContext): Promise<string> {
  const reps = (await json(await request.get(`/api/v1/Dealer/SalesReps?DealerGuid=${guid}`, { headers, timeout: config.timeoutMs }))).data ?? [];
  return (reps.find((r: any) => r.employeeType === 'Tech') ?? reps[0]).id;
}

/** A second job for an existing order, shaped the way the web app's Add Job drawer posts it (jobId 0, next job number). */
export function newJob(order: any, description: string, jobStatusId: string, technicianId = ''): any {
  const inv = order.invoices[0];
  const next = Math.max(0, ...inv.workOrderJobs.map((j: any) => j.jobNumber)) + 1;
  return {
    dealerId: config.dealerId, jobId: 0, jobNumber: next, workOrderId: order.orderId, invoiceId: inv.invoiceId,
    workOrderJobGuid: '3f2b8c1e-5a1d-4c55-9f0a-0d9e7a6b1c11', invoiceGuid: inv.invoiceGuid, unitId: '', meterReading: '', description,
    moreInfo: '{"SymptomNotes":"","LaborNotes":"","RequestNotes":""}', jobStatusId, technicianId, salesRepId: null, tech: '', mfrId: '',
    partNumber: '', productSerialNumber: '', productDescription: '', symptomNotes: '', isActive: true, startDate: now(), lastUpdated: now(),
  };
}

/** Prepares a read-back order for re-saving, as the web app's save does. */
export function forResave(order: any): any {
  order.orderSource = 'TargetDMSWeb';
  order.calculateTax = true;
  return order;
}

export const nowString = now;
