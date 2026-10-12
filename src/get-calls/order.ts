import { expect } from '@playwright/test';
import { GetCall, IDS } from './types';

export const orderCalls: GetCall[] = [
  {
    name: 'Get one order by id',
    path: '/api/v1/Order/{dealerGuid}',
    query: { OrderId: IDS.orderId },
    check: (data) => {
      expect(data.orderId).toBe(IDS.orderId);
      expect(data.dealerId).toBe(IDS.dealerId);
      expect(data).toHaveProperty('customerId');
      expect(data).toHaveProperty('orderStatusId');
      expect(Array.isArray(data.invoices)).toBe(true);
    },
  },
  {
    name: 'List orders (filtered, paged)',
    path: '/api/v1/Order/All/{dealerGuid}',
    query: { OrderId: IDS.orderId, CustomerId: IDS.customerId, PageNumber: 1, PageSize: 10 },
    check: (data) => {
      expect(data).toHaveProperty('totalCount');
      expect(Array.isArray(data.orders)).toBe(true);
    },
  },
  {
    name: 'Technician efficiency has hours and amounts',
    path: '/api/v1/Order/TechEfficiency/{dealerGuid}',
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      for (const key of ['salesRep', 'name', 'totalActualHours', 'billedHours', 'billedAmount']) {
        expect(data[0], `missing ${key}`).toHaveProperty(key);
      }
    },
  },
  {
    name: 'Time clock employees',
    path: '/api/v1/Order/TimeClock/Employees/{dealerGuid}',
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('salesRep');
      expect(data[0]).toHaveProperty('name');
    },
  },
  {
    name: 'Time clock entries for a work order',
    path: '/api/v1/Order/TimeClock/Entries/{dealerGuid}',
    query: { WorkOrderId: IDS.workOrderId },
    check: (data) => expect(Array.isArray(data)).toBe(true),
  },
  {
    name: 'Work order job statuses',
    path: '/api/v1/Order/WorkOrderJobStatuses/{dealerGuid}',
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('jobStatusId');
      expect(data[0]).toHaveProperty('description');
    },
  },
];
