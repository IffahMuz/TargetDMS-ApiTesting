import { expect } from '@playwright/test';
import { GetCall, IDS } from './types';

export const otherCalls: GetCall[] = [
  {
    name: 'Purchase orders (paged)',
    path: '/api/v1/PurchaseOrder/{dealerGuid}',
    query: { PageNumber: 1, PageSize: 10 },
    check: (data) => {
      expect(data.pageNumber).toBe(1);
      expect(data.pageSize).toBe(10);
      expect(Array.isArray(data.items)).toBe(true);
    },
  },
  {
    name: 'Purchase order detail',
    path: '/api/v1/PurchaseOrder/Detail/{dealerGuid}/{purchaseOrderId}',
    pathParams: { purchaseOrderId: 1 },
    check: (data) => expect(Array.isArray(data)).toBe(true),
  },
  {
    name: 'Receipt for an invoice is returned',
    path: '/api/v1/Receipt/{dealerGuid}/{invoiceGuid}',
    pathParams: { invoiceGuid: IDS.invoiceGuid },
    check: (data) => {
      expect(typeof data).toBe('string');
      expect(data.length).toBeGreaterThan(0);
    },
  },
  {
    name: 'Payment types',
    path: '/api/v1/Transaction/GetPaymentTypes/{dealerId}',
    pathParams: { dealerId: IDS.dealerId },
    check: (data) => expect(Array.isArray(data)).toBe(true),
  },
];
