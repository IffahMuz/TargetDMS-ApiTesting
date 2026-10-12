import { test, expect, request as pwRequest, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { config, tokenPath } from '../../src/config';

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const base = '/api/v1/Customer';
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
const ok = (res: APIResponse) => config.passStatuses.includes(res.status());

// The API has no delete for customers, so cleanup = update with isActive=false.
test.describe.serial('Flow: customer create -> get -> update -> get -> deactivate', () => {
  const run = `AUTO${Date.now()}`;
  let customerId = 0;
  let current: any;
  let deactivated = false;

  const getCustomer = (request: any) =>
    request.get(`${base}?DealerGuid=${config.dealerGuid}&CustomerId=${customerId}`, { headers, timeout: config.timeoutMs });
  const putCustomer = (request: any, data: any) =>
    request.put(`${base}/${config.dealerGuid}`, { headers, data, timeout: config.timeoutMs });

  test('1. POST create customer returns 200/201/204 and a customer id', async ({ request }) => {
    const raw = fs.readFileSync(path.resolve(__dirname, '..', '..', 'testdata', 'customer-create.json'), 'utf8');
    const res = await request.post(base, { headers, data: JSON.parse(raw.replace('{{RUN}}', run)), timeout: config.timeoutMs });
    const body = await json(res);
    customerId = Number(body?.data?.customerId ?? 0);
    expect(config.passStatuses, `create: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 400)}`).toContain(res.status());
    expect(customerId, `no customerId in response: ${JSON.stringify(body).slice(0, 400)}`).toBeGreaterThan(0);
  });

  test('2. GET the created customer returns the same name', async ({ request }) => {
    test.skip(!customerId, 'customer was not created');
    const res = await getCustomer(request);
    const body = await json(res);
    expect(config.passStatuses, `get: HTTP ${res.status()} ${JSON.stringify(body).slice(0, 400)}`).toContain(res.status());
    current = body.data;
    expect(current.customerId).toBe(customerId);
    expect(JSON.stringify(current)).toContain(run);
  });

  test('3. PUT update customer (notes + extra contact) returns 200/201/204', async ({ request }) => {
    test.skip(!current, 'customer was not read');
    const update = {
      ...current,
      notes: `AUTOMATION update ${run}`,
      contact: [
        ...current.contact,
        { firstName: 'contact', middleName: '', lastName: '', jobTitle: '', dateOfBirth: null, name: '', isActive: true, contactId: -1, isDefault: false, customerContactGuid: '' },
      ],
    };
    const res = await putCustomer(request, update);
    expect(config.passStatuses, `update: HTTP ${res.status()} ${(await res.text()).slice(0, 400)}`).toContain(res.status());
  });

  test('4. GET after update shows the new notes and the extra contact', async ({ request }) => {
    test.skip(!current, 'customer was not read');
    const res = await getCustomer(request);
    const body = await json(res);
    expect(ok(res), `get: HTTP ${res.status()}`).toBe(true);
    expect(body.data.notes).toBe(`AUTOMATION update ${run}`);
    expect(body.data.contact.length).toBeGreaterThanOrEqual(2);
    current = body.data;
  });

  test('5. PUT deactivate customer (cleanup) returns 200/201/204', async ({ request }) => {
    test.skip(!current, 'customer was not read');
    const res = await putCustomer(request, { ...current, isActive: false });
    deactivated = ok(res);
    expect(config.passStatuses, `deactivate: HTTP ${res.status()} ${(await res.text()).slice(0, 400)}`).toContain(res.status());
  });

  test('6. GET after deactivate shows isActive=false', async ({ request }) => {
    test.skip(!deactivated, 'customer was not deactivated');
    const res = await getCustomer(request);
    const body = await json(res);
    expect(body?.data?.isActive, `HTTP ${res.status()}`).toBe(false);
  });

  test.afterAll(async () => {
    if (current && !deactivated) {
      const ctx = await pwRequest.newContext({ baseURL: config.baseUrl });
      const res = await ctx.put(`${base}/${config.dealerGuid}`, { headers, data: { ...current, isActive: false } });
      await ctx.dispose();
      console.log(`Cleanup deactivate of customer ${customerId}: HTTP ${res.status()}`);
    }
  });
});
