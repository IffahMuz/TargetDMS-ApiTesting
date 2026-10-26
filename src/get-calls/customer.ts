import { expect } from '@playwright/test';
import { DATA } from '../testdata';
import { GetCall, IDS } from './types';

export const customerCalls: GetCall[] = [
  {
    name: 'Get one customer by id',
    path: '/api/v1/Customer',
    query: { DealerGuid: IDS.dealerGuid, CustomerId: IDS.customerId },
    check: (data) => {
      expect(data.customerId).toBe(IDS.customerId);
      expect(data.dealerId).toBe(IDS.dealerId);
      expect(Array.isArray(data.contact)).toBe(true);
    },
  },
  {
    name: 'List customers (paged)',
    path: '/api/v1/Customer/All',
    query: { DealerGuid: IDS.dealerGuid, PageNumber: 1, PageSize: 10 },
    check: (data) => {
      expect(data.totalCount).toBeGreaterThan(0);
      expect(Array.isArray(data.customers)).toBe(true);
      expect(data.customers.length).toBeLessThanOrEqual(10);
    },
  },
  {
    name: 'Customer balance has credit fields',
    path: '/api/v1/Customer/Balance/{dealerGuid}',
    query: { CustomerId: IDS.customerId },
    check: (data) => {
      for (const key of ['balanceAmount', 'creditLimit', 'creditAvailable', 'overLimit', 'balancePastDue']) {
        expect(data, `missing ${key}`).toHaveProperty(key);
      }
    },
  },
  {
    name: 'Customer categories include the test category',
    path: '/api/v1/Customer/Categories/{dealerGuid}',
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data.map((c: any) => c.customerCategoryId)).toContain(DATA.customerCategoryId);
    },
  },
  {
    name: 'Customer summary (by dealerId) has invoice summary',
    path: '/api/v1/Customer/GetCustomerSummary',
    query: { dealerId: IDS.dealerId, customerId: IDS.customerId },
    check: (data) => {
      expect(data).toHaveProperty('invoiceSummary');
      expect(data).toHaveProperty('customerOwnedEquipment');
    },
  },
  {
    name: 'Customer summary (by dealerGuid) has invoice summary',
    path: '/api/v1/Customer/Summary/{dealerGuid}',
    query: { CustomerId: IDS.customerId },
    check: (data) => {
      expect(data).toHaveProperty('invoiceSummary');
      expect(data).toHaveProperty('customerOwnedEquipment');
    },
  },
];
