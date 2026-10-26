import { expect } from '@playwright/test';
import { config } from '../config';
import { IDS, PostCall } from './types';

// POST /Dealer/GetDealers is deprecated (backend points to Dealer/Locations) but still live; it is a read-only lookup.
// The DMS dealer id that owns the test locations (Dealer/Locations reports it); differs from the id used at login.
const dmsDealerId = config.locationDmsId;
const getDealers = '/api/v1/Dealer/GetDealers';
// POST /Dealer/JobCode creates a permanent job code and there is no delete endpoint,
// so only validation failures are tested: each body breaks exactly ONE rule and must be rejected before anything is saved.
const jobCode = '/api/v1/Dealer/JobCode/{dealerGuid}';
const validJobCode = { jobCode: 'QA001', description: 'QA validation', hours: 1, amount: 1, codeType: 0, codeGroupId: 'QA' };
const rejected = (needle: string) => (body: any) => expect(JSON.stringify(body)).toContain(needle);

export const dealerPostCalls: PostCall[] = [
  {
    // dealerId 0 means "all locations of the DMS dealer"; a specific dealerId such as the location dealerId returns an empty list.
    name: 'Dealers lookup returns the test dealer location with id, guid and name',
    path: getDealers,
    body: { dmsDealerId, dealerId: 0 },
    check: (data) => {
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      for (const key of ['dealerId', 'dealerGuid', 'name']) expect(data[0], `missing ${key}`).toHaveProperty(key);
      const testDealer = data.find((d: any) => d.dealerId === IDS.dealerId);
      expect(testDealer, 'test dealer is listed').toBeTruthy();
      expect(String(testDealer.dealerGuid).toLowerCase()).toBe(IDS.dealerGuid.toLowerCase());
    },
  },
  {
    name: 'Dealers lookup for a dmsDealerId the user does not own is rejected with 403',
    path: getDealers,
    body: { dmsDealerId: config.dealerId, dealerId: 0 },
    expectStatus: [403],
    check: rejected('Dealer authorization failed'),
  },
  {
    name: 'Dealers lookup missing dmsDealerId is rejected with 400',
    path: getDealers,
    body: { dealerId: IDS.dealerId },
    expectStatus: [400],
    check: rejected('DmsDealerId is required'),
  },
  {
    name: 'Dealers lookup with a negative dealerId is rejected with 400',
    path: getDealers,
    body: { dmsDealerId, dealerId: -5 },
    expectStatus: [400],
    check: rejected('DealerId is required'),
  },
  {
    name: 'Job code longer than 8 characters is rejected with 400',
    path: jobCode,
    body: { ...validJobCode, jobCode: 'QA1234567' },
    expectStatus: [400],
    check: rejected('JobCode must not exceed 8 characters'),
  },
  {
    name: 'Job code missing is rejected with 400',
    path: jobCode,
    body: { ...validJobCode, jobCode: '' },
    expectStatus: [400],
    check: rejected('JobCode is required'),
  },
  {
    name: 'Job code description longer than 40 characters is rejected with 400',
    path: jobCode,
    body: { ...validJobCode, description: 'D'.repeat(41) },
    expectStatus: [400],
    check: rejected('Description must not exceed 40 characters'),
  },
  {
    name: 'Job code with an invalid codeType is rejected with 400',
    path: jobCode,
    body: { ...validJobCode, codeType: 99 },
    expectStatus: [400],
    check: rejected('CodeType must be a valid value'),
  },
  {
    name: 'Job code without a codeGroupId is rejected with 400',
    path: jobCode,
    body: { ...validJobCode, codeGroupId: '' },
    expectStatus: [400],
    check: rejected('CodeGroupId is required'),
  },
  {
    name: 'Job code with a codeGroupId longer than 20 characters is rejected with 400',
    path: jobCode,
    body: { ...validJobCode, codeGroupId: 'G'.repeat(21) },
    expectStatus: [400],
    check: rejected('CodeGroupId must not exceed 20 characters'),
  },
  {
    name: 'Job code with a serviceMfrId longer than 4 characters is rejected with 400',
    path: jobCode,
    body: { ...validJobCode, serviceMfrId: 'MFR12' },
    expectStatus: [400],
    check: rejected('ServiceMfrId must not exceed 4 characters'),
  },
];
