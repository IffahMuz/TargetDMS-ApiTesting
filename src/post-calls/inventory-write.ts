import { expect } from '@playwright/test';
import { IDS, PostCall } from './types';

// POST /Inventory/CustomersPrices is a read-only price lookup.
const prices = '/api/v1/Inventory/CustomersPrices/{dealerGuid}';
const priceBody = { customerID: String(IDS.customerId), products: [{ mfrID: 'ARC', partNumber: '0100-032' }] };

// POST /Inventory/Unit and /Inventory/Model create PERMANENT records (there is no delete endpoint),
// so only validation failures are tested: each body below breaks exactly ONE rule and must be rejected before anything is saved.
const unit = '/api/v1/Inventory/Unit';
const model = '/api/v1/Inventory/Model';
const unitBody = {
  dealerId: IDS.dealerId, dealerGuid: IDS.dealerGuid, categoryId: 'ATV', model: 'QAMODEL', manufacturerId: 'AHI',
  description: 'QA validation', serialNumber: 'QA-VALIDATION', hours: '1', currentOwnerId: IDS.customerId,
};
const modelBody = { dealerId: IDS.dealerId, dealerGuid: IDS.dealerGuid, manufacturerId: 'AHI', categoryId: 'ATV', modelNumber: 'QAMODEL' };
const rejected = (needle: string) => (body: any) => expect(JSON.stringify(body)).toContain(needle);

const unitCases: [string, Record<string, unknown>, string][] = [
  ['dealerId 0', { dealerId: 0 }, 'DealerId must be greater than 0'],
  ['no dealerGuid', { dealerGuid: '' }, 'DealerGuid is required'],
  ['no categoryId', { categoryId: '' }, 'CategoryId is required'],
  ['no model', { model: '' }, 'Model is required'],
  ['a model over 20 characters', { model: 'M'.repeat(21) }, 'Model must not exceed 20 characters'],
  ['no manufacturerId', { manufacturerId: '' }, 'ManufacturerId is required'],
  ['a manufacturerId over 20 characters', { manufacturerId: 'F'.repeat(21) }, 'ManufacturerId must not exceed 20 characters'],
  ['a description over 100 characters', { description: 'D'.repeat(101) }, 'Description must not exceed 100 characters'],
  ['a serial number over 64 characters', { serialNumber: 'S'.repeat(65) }, 'SerialNumber must not exceed 64 characters'],
  ['hours over 12 characters', { hours: '1'.repeat(13) }, 'Hours must not exceed 12 characters'],
  ['currentOwnerId 0', { currentOwnerId: 0 }, 'CurrentOwnerId is required'],
  ['an engineMfr over 4 characters', { engineMfr: 'ENGIN' }, 'EngineMfr must not exceed 4 characters'],
];

const modelCases: [string, Record<string, unknown>, string][] = [
  ['dealerId 0', { dealerId: 0 }, 'Dealer ID must be greater than 0'],
  ['no dealerGuid', { dealerGuid: '' }, 'Dealer GUID is required'],
  ['no manufacturerId', { manufacturerId: '' }, 'Manufacturer ID is required'],
  ['no categoryId', { categoryId: '' }, 'Category ID is required'],
  ['no modelNumber', { modelNumber: '' }, 'Model Number is required'],
];

export const inventoryWritePostCalls: PostCall[] = [
  {
    name: 'Customer price for a real part is returned',
    path: prices,
    body: priceBody,
    check: (data) => {
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ mfrID: 'ARC', partNumber: '0100-032', success: true });
      expect(data[0].price).toBeGreaterThan(0);
    },
  },
  {
    name: 'Customer price for an unknown part says it was not found',
    path: prices,
    body: { ...priceBody, products: [{ mfrID: 'ARC', partNumber: 'ZZZ-NO-SUCH-PART' }] },
    check: (data) => {
      expect(data[0].success).toBe(false);
      expect(data[0].error).toContain('Product not found');
    },
  },
  { name: 'Customer price without a customerID is rejected with 400', path: prices, body: { products: priceBody.products }, expectStatus: [400], check: rejected('CustomerID') },
  { name: 'Customer price with no products is rejected with 400', path: prices, body: { ...priceBody, products: [] }, expectStatus: [400], check: rejected('At least one product is required') },
  { name: 'Customer price for a product without a partNumber is rejected with 400', path: prices, body: { ...priceBody, products: [{ mfrID: 'ARC' }] }, expectStatus: [400], check: rejected('PartNumber') },
  ...unitCases.map(([what, over, message]): PostCall => ({
    name: `Creating a unit with ${what} is rejected with 400`, path: unit, body: { ...unitBody, ...over }, expectStatus: [400], check: rejected(message),
  })),
  ...modelCases.map(([what, over, message]): PostCall => ({
    name: `Creating a model with ${what} is rejected with 400`, path: model, body: { ...modelBody, ...over }, expectStatus: [400], check: rejected(message),
  })),
  {
    // dealerGuid is taken from the body (not the path) and the endpoint has no dealer authorization attribute.
    // A GUID that is not ours must be refused, never create a model for another dealer. Uses a GUID that matches no dealer.
    name: 'Creating a model for a dealerGuid that is not ours is refused',
    path: model,
    body: { ...modelBody, dealerGuid: '00000000-0000-4000-8000-000000000001' },
    expectStatus: [400, 401, 403, 404, 502],
    check: () => {},
  },
];
