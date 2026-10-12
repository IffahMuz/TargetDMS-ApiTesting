import { expect } from '@playwright/test';
import { GetCall, IDS } from './types';

export const inspectionCalls: GetCall[] = [
  {
    name: 'Sessions for a customer belong to that customer',
    path: '/api/v1/Inspection/CustomerSessions/{dealerGuid}',
    query: { customerId: IDS.customerId },
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      for (const s of data) expect(String(s.customerId)).toBe(String(IDS.customerId));
    },
  },
  {
    name: 'Get one inspection session by id',
    path: '/api/v1/Inspection/Session/{dealerGuid}',
    query: { inspectionSessionId: IDS.inspectionSessionId },
    check: (data) => {
      expect(data.inspectionSessionId).toBe(IDS.inspectionSessionId);
      expect(data).toHaveProperty('status');
      expect(Array.isArray(data.results)).toBe(true);
    },
  },
  {
    name: 'Inspection templates have id and name',
    path: '/api/v1/Inspection/Templates/{dealerGuid}',
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('templateId');
      expect(data[0]).toHaveProperty('name');
    },
  },
  {
    name: 'Sessions for a work order belong to that work order',
    path: '/api/v1/Inspection/WorkOrderSessions/{dealerGuid}',
    query: { workOrderId: IDS.workOrderId },
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      for (const s of data) expect(s.workOrderId).toBe(IDS.workOrderId);
    },
  },
];
