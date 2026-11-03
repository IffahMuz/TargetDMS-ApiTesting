import { expect } from '@playwright/test';
import { test } from '../../src/fixtures';
import * as crypto from 'crypto';
import { config } from '../../src/config';
import { pace } from '../../src/pace';
import { headers, json } from '../../src/warranty-helpers';

test.beforeEach(pace);

const api = '/api/v1';
const text = async (res: any) => JSON.stringify(await json(res)).slice(0, 220);
const bad = (res: any) => res.status() >= 400 && res.status() < 500;

/**
 * Endpoints that were not covered before: ChangeRelay/TestEvent, the dealer configuration save and User/RegisterEmail, plus the
 * login validation that is refused before the identity server is called.
 * Nothing here records a dealer setting or registers an email: a valid configuration save and a valid RegisterEmail are left out on purpose.
 */
test.describe('ChangeRelay TestEvent', () => {
  const event = (over: Record<string, unknown> = {}) => ({
    dealerGuid: config.dealerGuid, dmsDealerId: config.dmsDealerId, entityType: 'WorkOrder', entityId: 'api-test-0', changeType: 'Updated', changeSource: 'api-tests', ...over,
  });
  const send = (request: any, data: unknown, auth = true) =>
    request.post(`${api}/ChangeRelay/TestEvent`, { headers: auth ? headers : { Accept: 'application/json' }, data, timeout: config.timeoutMs });

  // The endpoint answers 404 in a Production environment, so a 404 on a valid event means there is nothing to test here.
  test('1. A valid work order event is published', async ({ request }) => {
    const res = await send(request, event({ entityType: 'workorder', entityId: 'api-test-1' }));
    test.skip(res.status() === 404, 'TestEvent is switched off in Production (404)');
    const body = await json(res);
    expect(config.passStatuses, `HTTP ${res.status()} ${await text(res)}`).toContain(res.status());
    expect(body.success).toBe(true);
    expect(String(body.message)).toContain('Test event published');
  });

  test('2. A sales order event is published for Created, Updated and Deleted', async ({ request }) => {
    for (const changeType of ['Created', 'Updated', 'Deleted']) {
      const res = await send(request, event({ entityType: 'SaleOrder', entityId: 'api-test-2', changeType }));
      test.skip(res.status() === 404, 'TestEvent is switched off in Production (404)');
      expect(config.passStatuses, `${changeType}: HTTP ${res.status()} ${await text(res)}`).toContain(res.status());
      expect((await json(res)).success, changeType).toBe(true);
    }
  });

  test('3. An unknown entity type is refused with a 400', async ({ request }) => {
    const res = await send(request, event({ entityType: 'Banana' }));
    test.skip(res.status() === 404, 'TestEvent is switched off in Production (404)');
    expect(res.status(), await text(res)).toBe(400);
    expect((await text(res)).toLowerCase(), 'the 400 must be about the entity type').toContain('entitytype');
  });

  test('4. An unknown change type is refused with a 400', async ({ request }) => {
    const res = await send(request, event({ changeType: 'Exploded' }));
    test.skip(res.status() === 404, 'TestEvent is switched off in Production (404)');
    expect(res.status(), await text(res)).toBe(400);
    expect((await text(res)).toLowerCase(), 'the 400 must be about the change type').toContain('changetype');
  });

  test('5. Missing or invalid fields are refused with a 400', async ({ request }) => {
    // The word is the field the 400 has to name, so a 400 for some other reason cannot make a case pass.
    const cases: [string, unknown, string][] = [
      ['empty body', {}, 'entitytype'],
      ['no dealerGuid', event({ dealerGuid: undefined }), 'dealerguid'],
      ['dealerGuid that is not a GUID', event({ dealerGuid: 'not-a-guid' }), 'dealerguid'],
      ['no entityType', event({ entityType: undefined }), 'entitytype'],
      ['empty entityId', event({ entityId: '' }), 'entityid'],
      ['entityId of 201 characters', event({ entityId: 'x'.repeat(201) }), 'entityid'],
      ['no changeType', event({ changeType: undefined }), 'changetype'],
    ];
    for (const [what, data, field] of cases) {
      const res = await send(request, data);
      test.skip(res.status() === 404, 'TestEvent is switched off in Production (404)');
      expect(res.status(), `${what}: ${await text(res)}`).toBe(400);
      expect(JSON.stringify(await json(res)).toLowerCase(), `${what}: the 400 must name ${field}`).toContain(field);
    }
  });

  test('6. Without a token the event is refused with a 401', async ({ request }) => {
    const res = await send(request, event(), false);
    expect(res.status()).toBe(401);
  });
});

test.describe('Dealer configuration save: bad input', () => {
  const entry = (over: Record<string, unknown> = {}) => ({ source: 'TargetDMS', entityName: 'ApiTest', key: 'Automation', value: 'x', ...over });
  const save = (request: any, data: unknown, auth = true) =>
    request.post(`${api}/Dealer/Configuration/${config.dealerGuid}`, { headers: auth ? headers : { Accept: 'application/json' }, data, timeout: config.timeoutMs });

  // Every body below is invalid on purpose, so nothing is ever saved.
  test('9. A missing or too long field is refused with a 400', async ({ request }) => {
    const cases: [string, unknown][] = [
      ['empty body', {}],
      ['no source', entry({ source: undefined })],
      ['no entityName', entry({ entityName: undefined })],
      ['no key', entry({ key: undefined })],
      ['no value', entry({ value: undefined })],
      ['empty value', entry({ value: '' })],
      ['source of 21 characters', entry({ source: 's'.repeat(21) })],
      ['entityName of 101 characters', entry({ entityName: 'e'.repeat(101) })],
      ['key of 101 characters', entry({ key: 'k'.repeat(101) })],
      ['dealerConfigId that is not a GUID', entry({ dealerConfigId: 'not-a-guid' })],
    ];
    for (const [what, data] of cases) {
      const res = await save(request, data);
      expect(res.status(), `${what}: ${await text(res)}`).toBe(400);
    }
  });

  test('10. A malformed dealer GUID or no token is refused', async ({ request }) => {
    const malformed = await request.post(`${api}/Dealer/Configuration/not-a-guid`, { headers, data: entry({ source: undefined }), timeout: config.timeoutMs });
    expect(malformed.status(), await text(malformed)).toBe(400);
    const noToken = await save(request, entry(), false);
    expect(noToken.status()).toBe(401);
  });
});

test.describe('User RegisterEmail: bad input', () => {
  const body = (over: Record<string, unknown> = {}) => ({ userId: crypto.randomUUID(), userName: 'api-test', email: 'api-test@example.invalid', redirectUrl: 'https://example.invalid', ...over });
  const register = (request: any, data: unknown, auth = true) =>
    request.post(`${api}/User/RegisterEmail`, { headers: auth ? headers : { Accept: 'application/json' }, data, timeout: config.timeoutMs });

  // Each request is invalid, so no email is registered and no mail is sent.
  // User/* allows only 5 calls per 3 minutes per path (a 429 makes the suite wait the full 3 minutes), so this describe makes 4 calls in all.
  test('11. A missing or badly formed field is refused with a 400', async ({ request }) => {
    const cases: [string, unknown][] = [
      ['empty body', {}],
      ['email without an @', body({ email: 'not-an-email' })],
      ['empty redirectUrl', body({ redirectUrl: '' })],
    ];
    for (const [what, data] of cases) {
      const res = await register(request, data);
      expect(res.status(), `${what}: ${await text(res)}`).toBe(400);
    }
  });

  test('11b. Without a token RegisterEmail is refused with a 401', async ({ request }) => {
    expect((await register(request, body(), false)).status()).toBe(401);
  });
});

// The identity server is never reached for these (the request is refused first), so they cannot lock the account.
// Auth/* allows 5 calls per 3 minutes per path: this describe makes 3.
test.describe('Login validation', () => {
  const login = (request: any, data: unknown) => request.post(`${api}/Auth/Login`, { data, timeout: config.timeoutMs });

  test('12. A too long username or password and a negative dealer id are refused with a 400', async ({ request }) => {
    test.skip(config.singleLogin, 'SINGLE_LOGIN=true: only global setup logs in');
    const cases: [string, unknown][] = [
      ['username of 51 characters', { userName: 'u'.repeat(51), password: 'x' }],
      ['password of 21 characters', { userName: 'api-test', password: 'p'.repeat(21) }],
      ['negative dmsDealerId', { dmsDealerId: -5, userName: 'api-test', password: 'x' }],
    ];
    for (const [what, data] of cases) {
      const res = await login(request, data);
      expect(bad(res), `${what}: HTTP ${res.status()} ${await text(res)}`).toBe(true);
      expect(res.status(), what).toBe(400);
    }
  });
});
