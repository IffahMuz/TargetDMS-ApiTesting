import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { cleanUpOpenOrder, createWorkOrder, WorkOrder } from '../../src/warranty-helpers';
import { firstJobCode } from '../../src/line-item-helpers';
import {
  STATUS, Template, addItemsToJob, deactivateTemplate, deleteSession, jobsAndLabors, readSession, result, saveSession, saveTemplate, sessionBody, sessionsOf, templateBody, templatesAt,
} from '../../src/inspection-helpers';

test.beforeEach(pace);

/**
 * The Inspection tab of a work order, step by step as the web app does it: pick a template, answer the items (good / marginal / poor / na), save a draft, add
 * additional findings, complete the inspection, add the poor and marginal items to a new job or an existing one, then delete the inspection.
 * The work order and the template are our own (the template is named API-TEST ... and switched off at the end, templates cannot be deleted).
 * Nothing is checked out. Items carry the dealer's first job code, so no new job code is created.
 */
test.describe.serial('Flow: inspection on a work order -> draft -> complete -> add to jobs -> delete', () => {
  let wo: WorkOrder;
  let template: Template;
  let templateRaw: unknown;
  let sessionId = '';
  let newJobId = 0;
  let jobCode = '';
  const stamp = Date.now();
  const moreInfo = JSON.stringify({ additionalFindings: [{ id: 'finding-1', notes: 'Scratch on the engine cover', photos: [], status: 'marginal' }] });
  // Engine: 0 Oil level, 1 Belts. Safety: 0 Guards.
  const answers = (oil: string, belts: string | null, guards: string | null, jobs: Record<string, number> = {}) => [
    result(template, 0, 0, oil, jobs.oil ? { jobId: jobs.oil } : {}),
    ...(belts ? [result(template, 0, 1, belts, jobs.belts ? { jobId: jobs.belts } : {})] : []),
    ...(guards ? [result(template, 1, 0, guards, jobs.guards ? { jobId: jobs.guards } : {})] : []),
  ];
  const save = async (request: any, status: string, results: unknown[], over: Record<string, unknown> = {}) =>
    saveSession(request, sessionBody(template, wo.orderId, status, results, { inspectionSessionId: sessionId || null, ...over }));
  const onlySession = async (request: any) => {
    const { sessions } = await sessionsOf(request, wo.orderId);
    expect(sessions, 'the work order must have exactly one inspection').toHaveLength(1);
    return sessions[0];
  };
  const resultOf = (session: any, moduleIndex: number, itemIndex: number) => session.results.find((r: any) => r.templateItemId === template.modules[moduleIndex].items[itemIndex].templateItemId);

  test('1. Setup: a new work order and an inspection template with two modules and three items', async ({ request }) => {
    jobCode = (await firstJobCode(request)).jobCode;
    wo = await createWorkOrder(request, `AUTOMATION-INSP-${stamp}`);
    templateRaw = templateBody(`API-TEST inspection ${stamp}`, jobCode, [{ name: 'Engine', items: ['Oil level', 'Belts'] }, { name: 'Safety', items: ['Guards'] }]);
    const saved = await saveTemplate(request, templateRaw);
    expect(config.passStatuses, JSON.stringify(saved.body).slice(0, 300)).toContain(saved.status);
    template = saved.template!;
    expect(template.templateId, 'template id').toBeTruthy();
    expect(template.modules.map((m) => m.name)).toEqual(['Engine', 'Safety']);
    expect(template.modules.flatMap((m) => m.items.map((i) => i.name))).toEqual(['Oil level', 'Belts', 'Guards']);
    for (const item of template.modules.flatMap((m) => m.items)) {
      expect(item.templateItemId, `item ${item.name} has an id`).toBeTruthy();
      expect(item.jobCode, `item ${item.name} keeps its job code`).toBe(jobCode);
    }
  });

  test('2. The template appears in the list the Inspection tab offers', async ({ request }) => {
    test.skip(!template, 'no template');
    const found = (await templatesAt(request)).find((t) => t.templateId === template.templateId);
    expect(found, 'template listed').toBeTruthy();
    expect(found.isActive).toBe(true);
    expect(found.isReadonly).toBe(false);
    expect(found.modules.flatMap((m: any) => m.items).filter((i: any) => i.isActive)).toHaveLength(3);
  });

  test('3. A new work order has no inspection yet', async ({ request }) => {
    test.skip(!template, 'no template');
    const { status, sessions } = await sessionsOf(request, wo.orderId);
    expect(status).toBe(200);
    expect(sessions).toEqual([]);
  });

  test('4. "Save and close" with one answer keeps a draft on the work order', async ({ request }) => {
    test.skip(!template, 'no template');
    const saved = await save(request, STATUS.draft, answers('good', null, null));
    expect(config.passStatuses, JSON.stringify(saved.body).slice(0, 300)).toContain(saved.status);
    sessionId = saved.id;
    expect(sessionId, 'session id').toBeTruthy();
    const session = await onlySession(request);
    expect(session).toMatchObject({ inspectionSessionId: sessionId, inspectionTemplateId: template.templateId, workOrderId: wo.orderId, status: STATUS.draft });
    expect(session.results).toHaveLength(1);
    expect(resultOf(session, 0, 0)).toMatchObject({ status: 'good', templateModuleId: template.modules[0].templateModuleId });
  });

  test('5. Continuing the draft updates the same inspection, with the rest of the answers and an additional finding', async ({ request }) => {
    test.skip(!sessionId, 'no draft');
    const saved = await save(request, STATUS.draft, answers('poor', 'poor', 'good'), { moreInfo });
    expect(config.passStatuses, JSON.stringify(saved.body).slice(0, 300)).toContain(saved.status);
    expect(saved.id, 'saving again with the session id must not make a second inspection').toBe(sessionId);
    const session = await onlySession(request);
    expect(session.status).toBe(STATUS.draft);
    expect(session.results).toHaveLength(3);
    expect(resultOf(session, 0, 0).status).toBe('poor');
    expect(resultOf(session, 0, 1).status).toBe('poor');
    expect(resultOf(session, 1, 0).status).toBe('good');
    expect(JSON.parse(session.moreInfo).additionalFindings).toEqual([expect.objectContaining({ notes: 'Scratch on the engine cover', status: 'marginal' })]);
  });

  test('6. Completing the inspection without adding anything to a job leaves the work order with its one job and no extra labor', async ({ request }) => {
    test.skip(!sessionId, 'no draft');
    const saved = await save(request, STATUS.completed, answers('poor', 'marginal', 'poor'), { moreInfo });
    expect(config.passStatuses, JSON.stringify(saved.body).slice(0, 300)).toContain(saved.status);
    const session = await onlySession(request);
    expect(session).toMatchObject({ inspectionSessionId: sessionId, status: STATUS.completed });
    expect(session.results.map((r: any) => r.status).sort()).toEqual(['marginal', 'poor', 'poor']);
    for (const r of session.results) expect(r.jobId ?? null, 'no item was assigned to a job').toBeNull();
    const { jobs, labors } = await jobsAndLabors(request, wo);
    expect(jobs, 'jobs').toHaveLength(1);
    expect(labors, 'labor lines').toHaveLength(0);
  });

  test('7. Adding two items to a new job creates exactly one new job with one labor line per item', async ({ request }) => {
    test.skip(!sessionId, 'no completed inspection');
    const added = await addItemsToJob(request, wo, template, [{ moduleIndex: 0, itemIndex: 0 }, { moduleIndex: 0, itemIndex: 1 }], null);
    expect(config.passStatuses, 'saving the order with the new job').toContain(added.status);
    expect(added.jobId, 'the new job has a real id').toBeGreaterThan(0);
    newJobId = added.jobId;
    const { jobs, labors } = await jobsAndLabors(request, wo);
    expect(jobs, 'one job was added, not one per item').toHaveLength(2);
    const job = jobs.find((j) => j.jobId === newJobId);
    expect(job.description).toBe(`Job 2 - ${template.name}`);
    expect(labors.map((l) => l.description).sort()).toEqual([`${template.name} - Engine: Belts`, `${template.name} - Engine: Oil level`]);
    for (const l of labors) expect(l, 'labor line').toMatchObject({ jobId: newJobId, laborCode: jobCode });

    // the inspection stores which job each item went to
    const saved = await save(request, STATUS.completed, answers('poor', 'marginal', 'poor', { oil: newJobId, belts: newJobId }), { moreInfo });
    expect(config.passStatuses, JSON.stringify(saved.body).slice(0, 300)).toContain(saved.status);
    const session = await onlySession(request);
    expect(resultOf(session, 0, 0).jobId).toBe(newJobId);
    expect(resultOf(session, 0, 1).jobId).toBe(newJobId);
    expect(resultOf(session, 1, 0).jobId ?? null, 'the item that was not assigned').toBeNull();
  });

  test('8. Adding the third item to the existing first job adds a labor line and no new job', async ({ request }) => {
    test.skip(!newJobId, 'no new job');
    const firstJobId = wo.jobId;
    const added = await addItemsToJob(request, wo, template, [{ moduleIndex: 1, itemIndex: 0 }], firstJobId);
    expect(config.passStatuses, 'saving the order').toContain(added.status);
    const { jobs, labors } = await jobsAndLabors(request, wo);
    expect(jobs, 'jobs').toHaveLength(2);
    expect(labors, 'labor lines').toHaveLength(3);
    expect(labors.find((l) => l.description === `${template.name} - Safety: Guards`), 'the new labor line').toMatchObject({ jobId: firstJobId, laborCode: jobCode });
    expect(labors.filter((l) => l.jobId === newJobId), 'the new job keeps its two lines').toHaveLength(2);
    const saved = await save(request, STATUS.completed, answers('poor', 'marginal', 'poor', { oil: newJobId, belts: newJobId, guards: firstJobId }), { moreInfo });
    expect(config.passStatuses, JSON.stringify(saved.body).slice(0, 300)).toContain(saved.status);
    expect(resultOf(await onlySession(request), 1, 0).jobId).toBe(firstJobId);
  });

  test('9. Deleting the inspection removes it from the work order but keeps the jobs and labor it created', async ({ request }) => {
    test.skip(!sessionId, 'no inspection');
    const status = await deleteSession(request, sessionId);
    expect(config.passStatuses, 'delete').toContain(status);
    expect((await sessionsOf(request, wo.orderId)).sessions, 'sessions after delete').toEqual([]);
    expect(config.passStatuses, 'the deleted inspection must not be readable').not.toContain((await readSession(request, sessionId)).status);
    const { jobs, labors } = await jobsAndLabors(request, wo);
    expect(jobs, 'jobs').toHaveLength(2);
    expect(labors, 'labor lines').toHaveLength(3);
  });

  test('10. Deleting the same inspection again is refused with a 4xx', async ({ request }) => {
    test.skip(!sessionId, 'no inspection');
    const status = await deleteSession(request, sessionId);
    expect(status, 'second delete').toBeGreaterThanOrEqual(400);
    expect(status, 'second delete').toBeLessThan(500);
    sessionId = '';
  });

  test('11. Switching the template off removes it from the Inspection tab but not from the inactive list', async ({ request }) => {
    test.skip(!template, 'no template');
    await deactivateTemplate(request, template);
    expect((await templatesAt(request)).some((t) => t.templateId === template.templateId), 'listed as active').toBe(false);
    expect((await templatesAt(request, undefined, true)).find((t) => t.templateId === template.templateId)?.isActive, 'still listed when inactive ones are included').toBe(false);
  });

  test.afterAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: config.baseUrl });
    if (sessionId) await deleteSession(ctx, sessionId).catch(() => 0);
    if (template) await deactivateTemplate(ctx, template).catch(() => undefined);
    if (wo) await cleanUpOpenOrder(ctx, wo.orderId).catch(() => undefined);
    await ctx.dispose();
  });
});
