import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';

/** Dealer-specific records (ids, a stocked part, a warrantor, a wholegood unit ...) live in testdata/dealers/<dealerId>.json - one file per dealer under test. */
const dataFile = path.resolve(__dirname, '..', 'testdata', 'dealers', `${config.dealerId}.json`);
export const DATA: {
  ids: { workOrderId: number; orderId: number; userId: string; roleId: string; inspectionSessionId: string; invoiceGuid: string };
  part: { make: string; number: string; description: string; price: number };
  pricePart: { make: string; number: string };
  warrantor: { id: string; name: string };
  /** A wholegood unit with status Available (units that are Sold, On Order or for rent have no receipt and cannot be added to an order). addable=false when the dealer has none. */
  unit: { inventoryWGId: string; manufacturerId: string; make: string; model: string; serialNumber: string; addable: boolean };
  /** A unit that cannot be sold from stock (Sold / On Order). */
  unavailableUnit: { inventoryWGId: string; manufacturerId: string; make: string; model: string; serialNumber: string };
  purchaseOrderId: number;
  searchPart: { search: string; partNumber: string; inventoryPartId: string };
  categories: { first: { id: string; description: string }; secondId: string; newTotal: number };
  customerCategoryId: string;
  tags: { inventoryTagId: number };
  inspection: { templateId: string; moduleId: string; item1: string; item2: string; workOrderId: number; jobId: number };
} = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : (() => { throw new Error(`No test data for dealer ${config.dealerId}: create ${dataFile}`); })();

/** Fills the placeholders used by the JSON bodies in testdata/: {{NOW}}, {{DEALER_ID}}, {{LOCATION_DMS_ID}}, {{DEALER_GUID}}, {{CUSTOMER_ID}} and {{data:path.in.dealer.file}}. {{RUN}} is left for the caller. */
export function fillPlaceholders(raw: string): string {
  const values: Record<string, string | number> = {
    NOW: new Date().toISOString().slice(0, 19),
    DEALER_ID: config.dealerId,
    LOCATION_DMS_ID: config.locationDmsId,
    DEALER_GUID: config.dealerGuid,
    CUSTOMER_ID: config.customerId,
  };
  return raw
    .replace(/\{\{(NOW|DEALER_ID|LOCATION_DMS_ID|DEALER_GUID|CUSTOMER_ID)\}\}/g, (_, k) => String(values[k]))
    .replace(/\{\{data:([\w.]+)\}\}/g, (_, p) => String(p.split('.').reduce((o: any, k: string) => o?.[k], DATA)));
}

/** Reads testdata/<file> and returns it with the placeholders filled in, as text (for bodies that still have {{RUN}}). */
export function loadTestText(file: string): string {
  return fillPlaceholders(fs.readFileSync(path.resolve(__dirname, '..', 'testdata', file), 'utf8'));
}

export function loadTestBody(file: string): any {
  return JSON.parse(loadTestText(file));
}
