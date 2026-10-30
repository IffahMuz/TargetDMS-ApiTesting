/**
 * The modules the runner page offers. `files` are test files (or folders) under the project; `grep` narrows the run to matching test titles.
 * `env` is added for that run only. A module with `finalizes: true` really checks orders out (RUN_CHECKOUT) and asks for a confirmation first.
 */
const T = 'tests/';
const MODULES = [
  { id: 'all', name: 'Everything', description: 'The whole suite: every module below, the generic GET checks and the known-defect tests.', files: [], finalizes: true, env: { RUN_CHECKOUT: 'true' } },
  { id: 'get', name: 'Read-only endpoint checks', description: 'Every GET endpoint from the Swagger file: status, shape and the fields each one must return. Changes nothing.', files: [T + 'get', T + 'api.spec.ts'] },
  { id: 'login', name: 'Login and tokens', description: 'Login, token use, validate, refresh and the refused cases. Makes one login call of its own (revoke stays off).', files: [T + 'flows/auth.flow.spec.ts'], env: { SINGLE_LOGIN: 'false' } },
  { id: 'customers', name: 'Customers', description: 'Create, read, update and balance of customers, plus the customer POST checks.', files: [T + 'flows/customer.flow.spec.ts', T + 'post/customer.post.spec.ts'] },
  { id: 'orders', name: 'Work orders and sales orders', description: 'Create, read, delete, line items (parts, labor, misc, wholegoods), tags and the order flows.', files: [T + 'flows/order.flow.spec.ts', T + 'flows/work-order.flow.spec.ts', T + 'flows/order-line-items.flow.spec.ts', T + 'flows/order-tag.flow.spec.ts', T + 'flows/order-wholegood.flow.spec.ts'] },
  { id: 'inspections', name: 'Inspections', description: 'Templates, inspections on work orders (draft, complete, add to job, delete), negative cases and per-location rules.', files: [T + 'flows/inspection.flow.spec.ts', T + 'flows/inspection-workorder.flow.spec.ts', T + 'flows/inspection-negative.spec.ts'] },
  { id: 'locations', name: 'Locations', description: 'Two locations of one company keep their orders and lists apart; bad location ids and GUIDs are refused.', files: [T + 'flows/location.flow.spec.ts', T + 'flows/location-negative.spec.ts'] },
  { id: 'deposits', name: 'Payment deposits (cash)', description: 'A $10 cash deposit on work orders and sales orders, split deposits, negative cases, and the PAY-DEF known defects. Leaves payments on two standing orders.', files: [T + 'flows/payment-deposit.flow.spec.ts', T + 'flows/payment-deposit-negative.spec.ts', T + 'defects/server-defects.spec.ts'], grep: 'Deposit|deposit|PAY-DEF' },
  { id: 'checkout-payments', name: 'Checkout with deposits and overpay', description: 'Checks out new work orders with exact cash, a deposit taken first, and a $10 overpay (GiveChange, LeaveAsDeposit, CreditAccount).', files: [T + 'flows/payment-deposit-checkout.flow.spec.ts'], finalizes: true, env: { RUN_CHECKOUT: 'true' } },
  { id: 'warranty', name: 'Warranty claims', description: 'Claims on work orders, billing options, deleted claims and the checkout validation.', files: [T + 'flows/warranty.flow.spec.ts', T + 'flows/warranty/billing-options.flow.spec.ts', T + 'flows/warranty/deleted-claim.flow.spec.ts', T + 'flows/warranty/checkout-validation.spec.ts'] },
  { id: 'warranty-checkout', name: 'Warranty checkouts', description: 'Customer only, warrantor only and customer-and-warrantor checkouts.', files: [T + 'flows/warranty'], finalizes: true, env: { RUN_CHECKOUT: 'true' } },
  { id: 'inventory', name: 'Inventory', description: 'Inventory reads and writes, tags, counts and units.', files: [T + 'post/inventory.post.spec.ts', T + 'post/inventory-write.post.spec.ts', T + 'flows/inventory-tag.flow.spec.ts', T + 'flows/inventory-count.flow.spec.ts', T + 'flows/tag.flow.spec.ts'] },
  { id: 'purchase', name: 'Purchase orders and time clock', description: 'Purchase order receive flow and technician clock in/out on work orders.', files: [T + 'flows/purchase-order.flow.spec.ts', T + 'flows/time-clock.flow.spec.ts'] },
  { id: 'receipts', name: 'Receipts and notifications', description: 'Receipt links and receipts, plus the notification and transaction POST checks.', files: [T + 'flows/receipt.flow.spec.ts', T + 'post/notification.post.spec.ts', T + 'post/transaction.post.spec.ts'] },
  { id: 'dealer-user', name: 'Dealer and user', description: 'Dealer, job code and user POST checks.', files: [T + 'post/dealer.post.spec.ts', T + 'post/user.post.spec.ts'] },
  { id: 'defects', name: 'Known server defects', description: 'Every known-defect test (purple when they still fail). Creates and cleans up a few orders.', files: [T + 'defects'] },
];
module.exports = { MODULES };
