import { expect } from '@playwright/test';
import { IDS, PostCall } from './types';
import { DATA } from '../testdata';

// POST /Customer/GetCustomerUnits is a read-only lookup (POST is used only to carry the search body).
const path = '/api/v1/Customer/GetCustomerUnits';

export const customerPostCalls: PostCall[] = [
  {
    name: 'Units for a customer all belong to that customer',
    path,
    body: { dealerId: IDS.dealerId, customerId: IDS.customerId, serialNumber: '' },
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      for (const unit of data) {
        expect(unit).toHaveProperty('inventoryWgId');
        expect(unit).toHaveProperty('serialNumber');
        expect(unit.customer.customerId).toBe(IDS.customerId);
      }
    },
  },
  {
    name: 'Lookup by serial number only returns that unit',
    path,
    body: { dealerId: IDS.dealerId, customerId: 0, serialNumber: DATA.unit.serialNumber },
    check: (data) => {
      expect(data).toHaveLength(1);
      expect(data[0].serialNumber).toBe(DATA.unit.serialNumber);
      expect(data[0].customer.customerId).toBe(IDS.customerId);
    },
  },
  {
    name: 'Unknown serial number returns an empty list',
    path,
    body: { dealerId: IDS.dealerId, customerId: 0, serialNumber: 'ZZZ-NO-SUCH-SERIAL' },
    check: (data) => expect(data).toEqual([]),
  },
  {
    name: 'Neither customer nor serial is rejected with 400',
    path,
    body: { dealerId: IDS.dealerId, customerId: 0, serialNumber: '' },
    expectStatus: [400],
    check: (body) => expect(JSON.stringify(body)).toContain('Either CustomerId or SerialNumber is required'),
  },
  {
    name: 'Missing dealerId is rejected with 400',
    path,
    body: { customerId: IDS.customerId, serialNumber: '' },
    expectStatus: [400],
    check: (body) => expect(body).toBeTruthy(),
  },
];
