import { expect } from '@playwright/test';
import { DATA } from '../testdata';
import { IDS, PostCall } from './types';

// POST /Inventory/GetInventory is a read-only search (POST only carries the filter body).
// Paging is 0-based: pageNumber 0 is the first page. All string filters are required but may be empty.
const path = '/api/v1/Inventory/GetInventory';
const filters = {
  dealerId: String(IDS.dealerId),
  itemType: '',
  search: '',
  mfrCode: '',
  availability: '',
  categoryId: '',
  condition: 'New',
  modelCode: '',
  tag: '',
  pageNumber: 0,
  pageSize: 25,
};
const without = (key: string) => {
  const { [key]: _omitted, ...rest } = filters as Record<string, unknown>;
  return rest;
};

export const inventoryPostCalls: PostCall[] = [
  {
    name: 'Default search returns a page of items with price and quantity',
    path,
    body: filters,
    check: (data) => {
      expect(data.totalCount).toBeGreaterThan(0);
      expect(data.inventory.length).toBeGreaterThan(0);
      expect(data.inventory.length).toBeLessThanOrEqual(25);
      for (const key of ['itemType', 'lineCode', 'partNumber', 'description', 'price', 'availableQty']) {
        expect(data.inventory[0], `missing ${key}`).toHaveProperty(key);
      }
    },
  },
  {
    name: 'pageSize limits the number of items returned',
    path,
    body: { ...filters, pageSize: 5 },
    check: (data) => {
      expect(data.inventory).toHaveLength(5);
      expect(data.totalCount).toBeGreaterThan(5);
    },
  },
  {
    name: 'Search by part number finds it (case-insensitive)',
    path,
    body: { ...filters, search: DATA.searchPart.search },
    check: (data) => {
      expect(data.totalCount).toBe(1);
      expect(data.inventory[0].partNumber).toBe(DATA.searchPart.partNumber);
    },
  },
  {
    name: 'Search with no match returns an empty list',
    path,
    body: { ...filters, search: 'ZZZZ-NO-SUCH-PART' },
    check: (data) => {
      expect(data.totalCount).toBe(0);
      expect(data.inventory).toEqual([]);
    },
  },
  {
    name: 'itemType P returns only parts',
    path,
    body: { ...filters, itemType: 'P', pageSize: 10 },
    check: (data) => {
      expect(data.inventory.length).toBeGreaterThan(0);
      for (const item of data.inventory) expect(item.itemType).toBe('P');
    },
  },
  {
    // Valid itemType values (backend enum + front end): "" = all, "P" = part, "WG" = wholegood.
    name: 'itemType WG returns only wholegoods',
    path,
    body: { ...filters, itemType: 'WG', pageSize: 10 },
    check: (data) => {
      expect(data.totalCount).toBeGreaterThan(0);
      expect(data.inventory.length).toBeGreaterThan(0);
      for (const item of data.inventory) expect(item.itemType).toBe('WG');
    },
  },
  {
    // Front end sends "StockIn" / "StockOut" (empty = all).
    name: 'availability StockIn returns only items with quantity on hand',
    path,
    body: { ...filters, availability: 'StockIn', pageSize: 10 },
    check: (data) => {
      expect(data.totalCount).toBeGreaterThan(0);
      for (const item of data.inventory) expect(item.availableQty).toBeGreaterThan(0);
    },
  },
  {
    name: 'availability StockOut returns only items with no quantity',
    path,
    body: { ...filters, availability: 'StockOut', pageSize: 10 },
    check: (data) => {
      expect(data.totalCount).toBeGreaterThan(0);
      for (const item of data.inventory) expect(item.availableQty).toBeLessThanOrEqual(0);
    },
  },
  {
    name: 'categoryId filter narrows the results',
    path,
    body: { ...filters, categoryId: DATA.categories.first.id, pageSize: 10 },
    check: (data) => {
      expect(data.totalCount).toBeGreaterThan(0);
      expect(data.totalCount).toBeLessThan(DATA.categories.newTotal);
      for (const item of data.inventory) expect(item.category).toBe(DATA.categories.first.description);
    },
  },
  {
    // The front end joins multi-select values with commas.
    name: 'Comma-joined categoryId returns the union of both categories',
    path,
    body: { ...filters, categoryId: `${DATA.categories.first.id},${DATA.categories.secondId}`, pageSize: 10 },
    check: (data) => expect(data.totalCount).toBeGreaterThan(0),
  },
  {
    // The front end sends the tag id as a string.
    name: 'tag filter returns only items carrying that tag',
    path,
    body: { ...filters, tag: String(DATA.tags.inventoryTagId), pageSize: 10 },
    check: (data) => {
      expect(data.totalCount).toBeGreaterThan(0);
      for (const item of data.inventory) {
        expect(item.tagDetails.map((t: any) => t.tagId)).toContain(DATA.tags.inventoryTagId);
      }
    },
  },
  {
    // Used and New are the only conditions the search knows. A dealer without used stock gets an empty list, which is fine.
    name: 'condition Used returns a valid list (empty when the dealer has no used items)',
    path,
    body: { ...filters, condition: 'Used', pageSize: 10 },
    check: (data) => {
      expect(data.totalCount).toBeGreaterThanOrEqual(0);
      expect(data.inventory.length).toBeLessThanOrEqual(Math.min(10, data.totalCount));
    },
  },
  {
    name: 'mfrCode filter returns only that line code',
    path,
    body: { ...filters, mfrCode: '****', pageSize: 10 },
    check: (data) => {
      expect(data.totalCount).toBeGreaterThan(0);
      for (const item of data.inventory) expect(item.lineCode).toBe('****');
    },
  },
  {
    name: 'A page past the end of a small result set is empty but keeps the total',
    path,
    body: { ...filters, search: 'CARD', pageNumber: 5 },
    check: (data) => {
      expect(data.inventory).toEqual([]);
      expect(data.totalCount).toBeGreaterThan(0);
    },
  },
  {
    name: 'Unknown dealer returns an empty result',
    path,
    body: { ...filters, dealerId: '1' },
    check: (data) => {
      expect(data.totalCount).toBe(0);
      expect(data.inventory).toEqual([]);
    },
  },
  {
    name: 'Empty dealerId is rejected with 400',
    path,
    body: { ...filters, dealerId: '' },
    expectStatus: [400],
    check: (body) => expect(JSON.stringify(body)).toMatch(/dealer/i),
  },
  {
    name: 'Missing required search field is rejected with 400',
    path,
    body: without('search'),
    expectStatus: [400],
    check: (body) => expect(JSON.stringify(body)).toContain('Search'),
  },
  {
    name: 'pageSize 0 is rejected with 400',
    path,
    body: { ...filters, pageSize: 0 },
    expectStatus: [400],
    check: (body) => expect(JSON.stringify(body)).toContain('PageSize'),
  },
  {
    name: 'Negative pageNumber is rejected with 400',
    path,
    body: { ...filters, pageNumber: -1 },
    expectStatus: [400],
    check: (body) => expect(JSON.stringify(body)).toContain('PageNumber'),
  },
];
