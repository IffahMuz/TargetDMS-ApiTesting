import { customerPostCalls } from './customer';
import { dealerPostCalls } from './dealer';
import { inventoryPostCalls } from './inventory';
import { inventoryWritePostCalls } from './inventory-write';
import { notificationPostCalls } from './notification';
import { PostCall } from './types';
import { userPostCalls } from './user';

export const postAreas: Record<string, PostCall[]> = {
  Customer: customerPostCalls,
  Dealer: dealerPostCalls,
  Inventory: inventoryPostCalls,
  InventoryWrite: inventoryWritePostCalls,
  Notification: notificationPostCalls,
  User: userPostCalls,
};

/** "POST /api/v1/..." ids that have an explicit test, so the generic Swagger suite can skip them. */
export const explicitPostIds = new Set(
  Object.values(postAreas).flatMap((calls) => calls.map((c) => `POST ${c.path}`)),
);
