import { test, expect, APIResponse } from '@playwright/test';
import * as fs from 'fs';
import { config, tokenPath } from '../../src/config';
import { IDS } from '../../src/get-calls/types';
import { pace } from '../../src/pace';

test.beforeEach(pace);

const { token } = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
const json = async (res: APIResponse): Promise<any> => res.json().catch(() => ({}));
const isClientError = (status: number) => status >= 400 && status < 500;

// These tests assert the CORRECT behaviour for bad input. They currently FAIL because the API answers
// with a 5xx instead of a clean 4xx. They stay red on purpose until the defects are fixed, so the report keeps flagging them.
// Root causes found in the backend source (TargetDMS.Backend, `test` branch):
//   - GetReceipt: the token is Base64-decoded with no try/catch; a FormatException falls through to the generic 500.
//   - Wholegoods: CurrentOwnerId defaults to 0, no validator rule rejects it, and the upstream Everest call returns 500.
//   - Wholegood/Detail: an unknown id gets an empty upstream response; ReadFromJsonAsync then throws a JsonException (500).
//   - GetInventory: no upper bound on pageNumber; far pages make the upstream query time out (504).
test.describe('Known server defects (5xx instead of 4xx)', () => {
  test('GetReceipt with a malformed token should be a 4xx, not 500 [known defect]', async ({ request }) => {
    const res = await request.get('/api/v1/Notification/GetReceipt?token=abc', { timeout: config.timeoutMs });
    expect(isClientError(res.status()), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(true);
  });

  test('Wholegoods without a real owner should be a 4xx, not 500 [known defect]', async ({ request }) => {
    const res = await request.get(`/api/v1/Inventory/Wholegoods/${IDS.dealerGuid}?pageNumber=1&pageSize=10`, { headers, timeout: config.timeoutMs });
    expect(isClientError(res.status()), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(true);
  });

  test('Wholegood detail for an unknown id should be a 404, not 500 [known defect]', async ({ request }) => {
    const res = await request.get(`/api/v1/Inventory/Wholegood/Detail/${IDS.dealerGuid}?InventoryWgId=NO-SUCH-UNIT`, { headers, timeout: config.timeoutMs });
    expect(isClientError(res.status()), `HTTP ${res.status()}: ${JSON.stringify(await json(res)).slice(0, 200)}`).toBe(true);
  });

  // Evidence on dealer 888166: condition "" -> 8972 items, "New" -> 7299, "Used" -> 0. The 1673 items that are not New
  // are never returned by the "Used" filter. Wholegoods show the same gap (WG: "" -> 1950, "New" -> 301, "Used" -> 0).
  // The backend only forwards `condition` to Everest unchanged, so the filter is applied upstream.
  test('GetInventory condition "Used" should return the items that are not New [known defect]', async ({ request }) => {
    const total = async (condition: string) => {
      const res = await request.post('/api/v1/Inventory/GetInventory', {
        headers,
        data: { dealerId: String(IDS.dealerId), itemType: '', search: '', mfrCode: '', availability: '', categoryId: '', condition, modelCode: '', tag: '', pageNumber: 0, pageSize: 1 },
        timeout: config.timeoutMs,
      });
      expect(config.passStatuses, `HTTP ${res.status()} for condition "${condition}"`).toContain(res.status());
      return (await json(res)).data.totalCount as number;
    };
    const [all, fresh, used] = [await total(''), await total('New'), await total('Used')];
    expect(used, `Used=${used}, New=${fresh}, all=${all}: Used should not be empty`).toBeGreaterThan(0);
    expect(used + fresh, `Used (${used}) + New (${fresh}) should equal all (${all})`).toBe(all);
  });

  test('GetInventory far past the last page should return an empty list, not time out [known defect]', async ({ request }) => {
    const res = await request.post('/api/v1/Inventory/GetInventory', {
      headers,
      data: { dealerId: String(IDS.dealerId), itemType: '', search: '', mfrCode: '', availability: '', categoryId: '', condition: 'New', modelCode: '', tag: '', pageNumber: 1000, pageSize: 25 },
      timeout: config.timeoutMs,
    });
    expect(config.passStatuses, `HTTP ${res.status()}`).toContain(res.status());
    expect((await json(res)).data.inventory).toEqual([]);
  });
});
