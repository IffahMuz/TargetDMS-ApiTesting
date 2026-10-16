import { customerPostCalls } from './customer';
import { inventoryPostCalls } from './inventory';
import { PostCall } from './types';

export const postAreas: Record<string, PostCall[]> = {
  Customer: customerPostCalls,
  Inventory: inventoryPostCalls,
};

/** "POST /api/v1/..." ids that have an explicit test, so the generic Swagger suite can skip them. */
export const explicitPostIds = new Set(
  Object.values(postAreas).flatMap((calls) => calls.map((c) => `POST ${c.path}`)),
);
