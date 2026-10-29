import { APIRequestContext } from '@playwright/test';
import * as crypto from 'crypto';
import { config } from './config';
import { Location } from './location-helpers';
import { getOrder, guid, headers, json, WorkOrder } from './warranty-helpers';

/**
 * Helpers for the inspection flows. The Inspection tab of a work order is only a screen on top of these calls, so the flows repeat the web app's steps:
 *   save a draft / complete the inspection = POST Inspection/Session (the same call creates and updates a session)
 *   "add to a new job"                    = append a job and its labor lines to the order and save the order (POST Order), then store the new job id on the result
 * A template cannot be deleted, so the flows create their own (named API-TEST ...) and switch it off at the end.
 */
export const STATUS = { draft: 'Draft', completed: 'Completed' } as const;
export type Answer = 'good' | 'marginal' | 'poor' | 'na';

export interface Template { templateId: string; name: string; modules: { templateModuleId: string; name: string; items: { templateItemId: string; name: string; jobCode: string | null }[] }[] }

const sessionUrl = (loc: { dealerGuid: string }) => `/api/v1/Inspection/Session/${loc.dealerGuid}`;
const here = { dealerGuid: guid } as Location;

/** A template body with the given modules; every item carries the dealer's job code, so adding it to a job needs no new job code. */
export function templateBody(name: string, jobCode: string, modules: { name: string; items: string[] }[]): any {
  return {
    templateId: null, name, description: 'created by the API test suite', type: 'Unit', imageUrl: '', requireMeterReading: false, isActive: true, isReadonly: false, createdDate: null, modifiedDate: null,
    modules: modules.map((m, mi) => ({
      templateModuleId: null, name: m.name, order: mi + 1, isActive: true,
      items: m.items.map((item, ii) => ({ templateItemId: null, name: item, category: '', jobCode, order: ii + 1, isActive: true })),
    })),
  };
}

export async function saveTemplate(request: APIRequestContext, body: unknown, loc: { dealerGuid: string } = here) {
  const res = await request.post(`/api/v1/Inspection/Templates/${loc.dealerGuid}`, { headers, data: body, timeout: config.timeoutMs });
  const parsed = await json(res);
  return { status: res.status(), body: parsed, template: parsed?.data as Template | undefined };
}

export async function templatesAt(request: APIRequestContext, loc: { dealerGuid: string } = here, includeInactive = false): Promise<any[]> {
  const res = await request.get(`/api/v1/Inspection/Templates/${loc.dealerGuid}?includeInactive=${includeInactive}`, { headers, timeout: config.timeoutMs });
  return (await json(res))?.data ?? [];
}

/** Templates cannot be deleted: switch it off so it leaves the Inspection tab. */
export async function deactivateTemplate(request: APIRequestContext, template: unknown): Promise<void> {
  await saveTemplate(request, { ...(template as object), isActive: false });
}

/** One answer for a template item. */
export const result = (template: Template, moduleIndex: number, itemIndex: number, status: Answer | string, extra: Record<string, unknown> = {}) => ({
  inspectionResultId: null, templateModuleId: template.modules[moduleIndex].templateModuleId, templateItemId: template.modules[moduleIndex].items[itemIndex].templateItemId,
  status, notes: '', photos: [], ...extra,
});

export const sessionBody = (template: Template, workOrderId: number, status: string, results: unknown[], over: Record<string, unknown> = {}) => ({
  inspectionSessionId: null, inspectionTemplateId: template.templateId, workOrderId, customerId: String(config.customerId), unitId: null, status, results, ...over,
});

export async function saveSession(request: APIRequestContext, body: unknown, loc: { dealerGuid: string } = here) {
  const res = await request.post(sessionUrl(loc), { headers, data: body, timeout: config.timeoutMs });
  const parsed = await json(res);
  return { status: res.status(), body: parsed, session: parsed?.data, id: (parsed?.data?.inspectionSessionId ?? '') as string };
}

export async function readSession(request: APIRequestContext, id: string, loc: { dealerGuid: string } = here) {
  const res = await request.get(`${sessionUrl(loc)}?inspectionSessionId=${id}`, { headers, timeout: config.timeoutMs });
  const parsed = await json(res);
  return { status: res.status(), body: parsed, session: parsed?.data };
}

/** The sessions the Inspection tab shows for a work order. */
export async function sessionsOf(request: APIRequestContext, workOrderId: number, loc: { dealerGuid: string } = here) {
  const res = await request.get(`/api/v1/Inspection/WorkOrderSessions/${loc.dealerGuid}?workOrderId=${workOrderId}`, { headers, timeout: config.timeoutMs });
  const parsed = await json(res);
  return { status: res.status(), body: parsed, sessions: (parsed?.data ?? []) as any[] };
}

export async function deleteSession(request: APIRequestContext, id: string, loc: { dealerGuid: string } = here): Promise<number> {
  const res = await request.delete(`${sessionUrl(loc)}?inspectionSessionId=${id}`, { headers, timeout: config.timeoutMs });
  return res.status();
}

/** The jobs and labor lines of a work order as the Order endpoint returns them (the labor lines are only listed for the invoice that is asked for). */
export async function jobsAndLabors(request: APIRequestContext, wo: WorkOrder) {
  const invoice = (await getOrder(request, wo.orderId, wo.invoiceId)).invoices[0];
  return {
    jobs: (invoice.workOrderJobs as any[]).filter((j) => j.isActive),
    // some dealers add a $0 SHOP SUPPLIES line to every new work order; it is not ours
    labors: (invoice.invoiceLabors as any[]).filter((l) => l.description !== 'SHOP SUPPLIES'),
  };
}

/**
 * What "Add to job" does in the web app (useInspectionJobActions.addItemsToJob): for a NEW job it appends a job named "Job N - <template>" to the invoice, one labor line per item
 * (code = the template item's job code, description "<template> - <module>: <item>") and saves the whole order. For an existing job only the labor lines are added.
 * Returns the id of the job the lines went to.
 */
export async function addItemsToJob(request: APIRequestContext, wo: WorkOrder, template: Template, items: { moduleIndex: number; itemIndex: number }[], jobId: number | null): Promise<{ jobId: number; jobNumber: number; status: number }> {
  const order = await getOrder(request, wo.orderId, wo.invoiceId);
  const invoice = order.invoices[0];
  const jobs: any[] = invoice.workOrderJobs ?? [];
  let targetId = jobId ?? 0;
  let targetNumber = jobs.find((j) => j.jobId === jobId)?.jobNumber ?? 0;
  if (jobId === null) {
    targetNumber = jobs.reduce((max, j) => Math.max(max, j.jobNumber || 0), 0) + 1;
    jobs.push({
      dealerId: invoice.dealerId, jobId: 0, jobNumber: targetNumber, workOrderId: wo.orderId, invoiceId: invoice.invoiceId, workOrderJobGuid: crypto.randomUUID(), invoiceGuid: invoice.invoiceGuid,
      unitId: jobs[0]?.unitId ?? '', meterReading: '', startDate: new Date().toISOString(), description: `Job ${targetNumber} - ${template.name}`, moreInfo: null, jobStatusId: '', technicianId: '',
      salesRepId: null, tech: null, mfrId: null, partNumber: null, productSerialNumber: null, productDescription: null, symptomNotes: null, isActive: true,
    });
  }
  for (const { moduleIndex, itemIndex } of items) {
    const module = template.modules[moduleIndex];
    const item = module.items[itemIndex];
    invoice.invoiceLabors.push({
      dealerId: invoice.dealerId, invoiceId: invoice.invoiceId, orderId: invoice.orderId, invoiceLaborId: 0, invoiceLaborGuid: crypto.randomUUID(), invoiceGuid: invoice.invoiceGuid,
      jobId: targetId, technicianId: '', billedHours: 0, rate: 0, total: 0, laborCode: item.jobCode, description: `${template.name} - ${module.name}: ${item.name}`,
    });
  }
  invoice.workOrderJobs = jobs;
  order.orderSource = 'TargetDMSWeb';
  const res = await request.post(`/api/v1/Order/${guid}`, { headers, data: order, timeout: config.timeoutMs });
  const saved = (await json(res))?.data?.invoices?.[0]?.workOrderJobs as any[] | undefined;
  // the new job only gets its real id once the order is saved: find it again by its number, as the web app does
  const real = jobId === null ? saved?.find((j) => j.jobNumber === targetNumber && j.jobId > 0) : saved?.find((j) => j.jobId === jobId);
  return { jobId: real?.jobId ?? 0, jobNumber: targetNumber, status: res.status() };
}
