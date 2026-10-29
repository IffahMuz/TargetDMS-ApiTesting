import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import * as crypto from 'crypto';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { cleanUpOpenOrder, createWorkOrder, headers, json, WorkOrder } from '../../src/warranty-helpers';
import { firstJobCode } from '../../src/line-item-helpers';
import { Location, currentLocation, loadLocations, otherLocation } from '../../src/location-helpers';
import {
  STATUS, Template, deactivateTemplate, deleteSession, readSession, result, saveSession, saveTemplate, sessionBody, sessionsOf, templateBody, templatesAt,
} from '../../src/inspection-helpers';

test.beforeEach(pace);

/**
 * Bad input to the inspection endpoints that the API already refuses correctly, and the per-location rules for templates and inspections.
 * These must keep passing. The cases where the API answers wrongly (a 502 for a bad status, an inspection saved for a work order that does not exist ...)
 * live in tests/defects/server-defects.spec.ts and stay red. The locations come from Dealer/Locations at run time.
 */
test.describe('Inspection negative cases: bad input is refused', () => {
  let wo: WorkOrder;
  let template: Template;
  let templateRaw: unknown;
  let sessionId = '';
  let jobCode = '';
  const stamp = Date.now();
  const text = async (res: any) => JSON.stringify(await json(res)).slice(0, 220);
  const post = (request: any, url: string, data: unknown, h: object | undefined = headers) => request.post(url, { headers: h, data, timeout: config.timeoutMs });
  const sessionUrl = `/api/v1/Inspection/Session/${config.dealerGuid}`;
  const templatesUrl = `/api/v1/Inspection/Templates/${config.dealerGuid}`;
  const answer = () => result(template, 0, 0, 'good');

  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: config.baseUrl });
    jobCode = (await firstJobCode(ctx)).jobCode;
    wo = await createWorkOrder(ctx, `AUTOMATION-INSP-NEG-${stamp}`);
    templateRaw = templateBody(`API-TEST inspection negative ${stamp}`, jobCode, [{ name: 'Engine', items: ['Oil level', 'Belts'] }]);
    template = (await saveTemplate(ctx, templateRaw)).template!;
    sessionId = (await saveSession(ctx, sessionBody(template, wo.orderId, STATUS.draft, [answer()]))).id;
    await ctx.dispose();
  });

  test.afterAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: config.baseUrl });
    if (sessionId) await deleteSession(ctx, sessionId).catch(() => 0);
    if (template) await deactivateTemplate(ctx, template).catch(() => undefined);
    if (wo) await cleanUpOpenOrder(ctx, wo.orderId).catch(() => undefined);
    await ctx.dispose();
  });

  // ---- templates ----
  test('INSP-NEG-01 A template without a name is a 400', async ({ request }) => {
    const res = await post(request, templatesUrl, { ...(templateRaw as object), name: '' });
    expect(res.status(), await text(res)).toBe(400);
  });

  test('INSP-NEG-02 A template name of 101 characters is a 400', async ({ request }) => {
    const res = await post(request, templatesUrl, { ...(templateRaw as object), name: 'N'.repeat(101) });
    expect(res.status(), await text(res)).toBe(400);
  });

  // ---- inspections ----
  test('INSP-NEG-03 An inspection without any answer is a 400', async ({ request }) => {
    const res = await post(request, sessionUrl, sessionBody(template, wo.orderId, STATUS.draft, []));
    expect(res.status(), await text(res)).toBe(400);
  });

  test('INSP-NEG-04 An answer that is not good, marginal, poor or na is a 400', async ({ request }) => {
    const res = await post(request, sessionUrl, sessionBody(template, wo.orderId, STATUS.draft, [result(template, 0, 0, 'excellent')]));
    expect(res.status(), await text(res)).toBe(400);
  });

  test('INSP-NEG-05 A note of 1001 characters on an answer is a 400', async ({ request }) => {
    const res = await post(request, sessionUrl, sessionBody(template, wo.orderId, STATUS.draft, [result(template, 0, 0, 'good', { notes: 'x'.repeat(1001) })]));
    expect(res.status(), await text(res)).toBe(400);
  });

  test('INSP-NEG-06 An inspection without a template id is a 400', async ({ request }) => {
    const res = await post(request, sessionUrl, { ...sessionBody(template, wo.orderId, STATUS.draft, [answer()]), inspectionTemplateId: '' });
    expect(res.status(), await text(res)).toBe(400);
  });

  test('INSP-NEG-07 An answer without an item id is a 400', async ({ request }) => {
    const res = await post(request, sessionUrl, sessionBody(template, wo.orderId, STATUS.draft, [{ ...answer(), templateItemId: '' }]));
    expect(res.status(), await text(res)).toBe(400);
  });

  test('INSP-NEG-08 Reading or deleting an inspection with a malformed id is a 400', async ({ request }) => {
    const get = await request.get(`${sessionUrl}?inspectionSessionId=not-a-guid`, { headers, timeout: config.timeoutMs });
    expect(get.status(), `GET ${await text(get)}`).toBe(400);
    const del = await request.delete(`${sessionUrl}?inspectionSessionId=not-a-guid`, { headers, timeout: config.timeoutMs });
    expect(del.status(), `DELETE ${await text(del)}`).toBe(400);
  });

  test('INSP-NEG-09 Listing inspections for work order 0 or customer 0 is a 400', async ({ request }) => {
    for (const path of [`/api/v1/Inspection/WorkOrderSessions/${config.dealerGuid}?workOrderId=0`, `/api/v1/Inspection/CustomerSessions/${config.dealerGuid}?customerId=0`]) {
      const res = await request.get(path, { headers, timeout: config.timeoutMs });
      expect(res.status(), `${path.split('?')[0]}: ${await text(res)}`).toBe(400);
    }
  });

  test('INSP-NEG-10 Templates and inspections without a token are a 401', async ({ request }) => {
    for (const path of [templatesUrl, `${sessionUrl}?inspectionSessionId=${sessionId}`, `/api/v1/Inspection/WorkOrderSessions/${config.dealerGuid}?workOrderId=${wo.orderId}`]) {
      const res = await request.get(path, { timeout: config.timeoutMs });
      expect(res.status(), path.split('?')[0]).toBe(401);
    }
    expect((await post(request, sessionUrl, sessionBody(template, wo.orderId, STATUS.draft, [answer()]), {})).status(), 'POST without a token').toBe(401);
  });

  test('INSP-NEG-11 An inspection for a template that does not exist is refused', async ({ request }) => {
    const ghost = { ...template, templateId: crypto.randomUUID() };
    const res = await post(request, sessionUrl, sessionBody(ghost, wo.orderId, STATUS.draft, [answer()]));
    expect(config.passStatuses, `HTTP ${res.status()}: ${await text(res)}`).not.toContain(res.status());
    const saved = (await json(res))?.data?.inspectionSessionId;
    if (saved) await deleteSession(request, saved);
  });

  test('INSP-NEG-12 Every refused request above saved nothing: the work order still has its one inspection', async ({ request }) => {
    const { sessions } = await sessionsOf(request, wo.orderId);
    expect(sessions.map((s) => s.inspectionSessionId)).toEqual([sessionId]);
    expect(sessions[0].results).toHaveLength(1);
  });

  // ---- locations: templates and inspections belong to the location in the URL ----
  test.describe('per location', () => {
    let other: Location;
    let current: Location;

    test.beforeAll(async ({ playwright }) => {
      const ctx = await playwright.request.newContext({ baseURL: config.baseUrl });
      const { locations } = await loadLocations(ctx);
      await ctx.dispose();
      current = currentLocation(locations)!;
      other = (current && otherLocation(locations, current))!;
    });

    test('INSP-LOC-01 A template made at this location is not offered at another location', async ({ request }) => {
      test.skip(!other, 'this company has only one location');
      expect((await templatesAt(request, current, true)).some((t) => t.templateId === template.templateId), 'listed at its own location').toBe(true);
      expect((await templatesAt(request, other, true)).some((t) => t.templateId === template.templateId), `listed at ${other.name}`).toBe(false);
    });

    test('INSP-LOC-02 The inspections of a work order are not listed when another location is asked', async ({ request }) => {
      test.skip(!other, 'this company has only one location');
      const asked = await sessionsOf(request, wo.orderId, other);
      expect(asked.status, `HTTP ${asked.status}`).toBeLessThan(500);
      expect(asked.sessions.map((s) => s.inspectionSessionId), `listed at ${other.name}`).not.toContain(sessionId);
    });

    test('INSP-LOC-03 An inspection of this location cannot be deleted through another location', async ({ request }) => {
      test.skip(!other, 'this company has only one location');
      const status = await deleteSession(request, sessionId, other);
      expect(status, 'delete through the other location').toBeGreaterThanOrEqual(400);
      expect(status, 'delete through the other location').toBeLessThan(500);
      expect((await readSession(request, sessionId)).session?.inspectionSessionId, 'still there at its own location').toBe(sessionId);
    });
  });
});
