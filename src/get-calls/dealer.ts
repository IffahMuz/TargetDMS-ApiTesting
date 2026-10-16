import { expect } from '@playwright/test';
import { GetCall, IDS } from './types';

export const dealerCalls: GetCall[] = [
  {
    name: 'Dealer configuration list',
    path: '/api/v1/Dealer/Configuration/{dealerGuid}',
    query: { Source: 'test-Source', EntityName: 'test-EntityName' },
    check: (data) => expect(Array.isArray(data)).toBe(true),
  },
  {
    name: 'Dealer tags (paged) have id, name, color and category',
    path: '/api/v1/Dealer/Tags/{dealerGuid}',
    query: { PageNumber: 1, PageSize: 10 },
    check: (data) => {
      expect(data.pageNumber).toBe(1);
      expect(data.pageSize).toBe(10);
      expect(data.totalCount).toBeGreaterThan(0);
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items.length).toBeLessThanOrEqual(10);
      for (const key of ['tagId', 'name', 'color', 'category', 'isActive']) {
        expect(data.items[0], `missing ${key}`).toHaveProperty(key);
      }
    },
  },
  {
    name: 'Dealer tags category filter returns only that category',
    path: '/api/v1/Dealer/Tags/{dealerGuid}',
    query: { PageNumber: 1, PageSize: 10, Category: 'Public' },
    check: (data) => {
      expect(data.items.length).toBeGreaterThan(0);
      for (const tag of data.items) expect(tag.category).toBe('Public');
    },
  },
  {
    name: 'Dealer tags search with no match returns an empty page',
    path: '/api/v1/Dealer/Tags/{dealerGuid}',
    query: { PageNumber: 1, PageSize: 10, Search: 'ZZZZ-NO-SUCH-TAG' },
    check: (data) => {
      expect(data.totalCount).toBe(0);
      expect(data.items).toEqual([]);
    },
  },
  {
    name: 'Job codes (paged) have code and description',
    path: '/api/v1/Dealer/JobCodes',
    query: { DealerGuid: IDS.dealerGuid, PageNumber: 1, PageSize: 10 },
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data.length).toBeLessThanOrEqual(10);
      expect(data[0]).toHaveProperty('jobCode');
      expect(data[0]).toHaveProperty('description');
    },
  },
  {
    name: 'Job code groups',
    path: '/api/v1/Dealer/JobCodes/CodeGroups/{dealerGuid}',
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('codeGroupId');
    },
  },
  {
    name: 'Dealer locations include the test dealer',
    path: '/api/v1/Dealer/Locations/{dealerGuid}',
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data.map((l: any) => l.dealerId)).toContain(IDS.dealerId);
    },
  },
  {
    name: 'Performance metrics for a date range',
    path: '/api/v1/Dealer/PerformanceMetrics/{dealerGuid}',
    query: { StartDate: '2026-01-01', EndDate: '2026-01-01' },
    check: (data) => expect(Array.isArray(data)).toBe(true),
  },
  {
    name: 'Sales reps have id and name',
    path: '/api/v1/Dealer/SalesReps',
    query: { DealerGuid: IDS.dealerGuid },
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('name');
    },
  },
  {
    name: 'Warrantors have id and name',
    path: '/api/v1/Dealer/Warrantors/{dealerGuid}',
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('warrantorId');
      expect(data[0]).toHaveProperty('name');
    },
  },
  {
    name: 'Warranty claims for a work order',
    path: '/api/v1/Dealer/WarrantyClaims/{dealerGuid}',
    query: { WorkOrderId: IDS.workOrderId },
    check: (data) => expect(Array.isArray(data)).toBe(true),
  },
];
