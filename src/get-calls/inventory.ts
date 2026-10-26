import { expect } from '@playwright/test';
import { GetCall, IDS } from './types';
import { DATA } from '../testdata';

const pagedItems = (data: any) => {
  expect(data.pageNumber).toBe(1);
  expect(data.pageSize).toBe(10);
  expect(data).toHaveProperty('totalCount');
  expect(data).toHaveProperty('totalPages');
  expect(Array.isArray(data.items)).toBe(true);
};

export const inventoryCalls: GetCall[] = [
  {
    name: 'Inventory counts (paged)',
    path: '/api/v1/Inventory/Count/{dealerGuid}',
    query: { PageNumber: 1, PageSize: 10 },
    check: pagedItems,
  },
  {
    name: 'Inventory count detail (paged)',
    path: '/api/v1/Inventory/Count/Detail/{dealerGuid}/{countId}',
    pathParams: { countId: 1 },
    query: { PageNumber: 1, PageSize: 10 },
    check: pagedItems,
  },
  {
    name: 'Inventory categories have id and description',
    path: '/api/v1/Inventory/GetInventoryCategories/{dealerId}',
    pathParams: { dealerId: IDS.dealerId },
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('categoryId');
      expect(data[0]).toHaveProperty('description');
    },
  },
  {
    name: 'Inventory manufacturers have id and name',
    path: '/api/v1/Inventory/GetInventoryManufacturers/{dealerId}',
    pathParams: { dealerId: IDS.dealerId },
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty('manufacturerId');
      expect(data[0]).toHaveProperty('name');
    },
  },
  {
    name: 'Model codes for a manufacturer',
    path: '/api/v1/Inventory/GetInventoryModelCodes/{dealerId}/{manufacturerId}',
    pathParams: { dealerId: IDS.dealerId, manufacturerId: 'STI' },
    check: (data) => expect(Array.isArray(data)).toBe(true),
  },
  {
    name: 'Miscellaneous items (paged)',
    path: '/api/v1/Inventory/Miscellaneous/{dealerGuid}',
    query: { PageNumber: 1, PageSize: 10 },
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data.length).toBeLessThanOrEqual(10);
      expect(data[0]).toHaveProperty('inventoryMiscellaneousId');
      expect(data[0]).toHaveProperty('price');
    },
  },
  {
    name: 'Parts (paged)',
    path: '/api/v1/Inventory/Parts/{dealerGuid}',
    query: { PageNumber: 1, PageSize: 10 },
    check: (data) => {
      expect(data.length).toBeGreaterThan(0);
      expect(data.length).toBeLessThanOrEqual(10);
      expect(data[0]).toHaveProperty('inventoryPartId');
      expect(data[0]).toHaveProperty('partNumber');
    },
  },
  {
    // currentOwnerId must be a real owner (here the test customer); without it the API returns 500.
    name: 'Wholegoods owned by the test customer (paged)',
    path: '/api/v1/Inventory/Wholegoods/{dealerGuid}',
    query: { pageNumber: 1, pageSize: 10, search: '', currentOwnerId: IDS.customerId },
    check: (data) => {
      expect(data.totalCount).toBeGreaterThan(0);
      expect(data.units.length).toBeGreaterThan(0);
      for (const unit of data.units) {
        expect(unit).toHaveProperty('inventoryWGId');
        expect(unit.currentOwnerId).toBe(IDS.customerId);
      }
    },
  },
  {
    name: 'Wholegood detail for a known unit',
    path: '/api/v1/Inventory/Wholegood/Detail/{dealerGuid}',
    query: { InventoryWgId: DATA.unit.inventoryWGId, DealerId: IDS.dealerId },
    check: (data) => {
      expect(data.inventoryWGId).toBe(DATA.unit.inventoryWGId);
      expect(data.dealerId).toBe(IDS.dealerId);
      expect(data).toHaveProperty('serialNumber');
    },
  },
];
