import { authCalls } from './auth';
import { customerCalls } from './customer';
import { dealerCalls } from './dealer';
import { inspectionCalls } from './inspection';
import { inventoryCalls } from './inventory';
import { orderCalls } from './order';
import { otherCalls } from './other';
import { userCalls } from './user';
import { GetCall } from './types';

export const areas: Record<string, GetCall[]> = {
  Auth: authCalls,
  Customer: customerCalls,
  Dealer: dealerCalls,
  Inspection: inspectionCalls,
  Inventory: inventoryCalls,
  Order: orderCalls,
  Other: otherCalls,
  User: userCalls,
};

/** "GET /api/v1/..." ids that have an explicit test, so the generic Swagger suite can skip them. */
export const explicitGetIds = new Set(
  Object.values(areas).flatMap((calls) => calls.map((c) => `GET ${c.path}`)),
);
