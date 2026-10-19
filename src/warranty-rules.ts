/**
 * Mirror of the web app's warranty checkout rules (TargetDMS.Web: utils/helpers/orderWarranty.ts and
 * ServiceOrderDetail/jobs/hooks/useWarrantyCheckout.ts). The rules live in the front end only; the API just stores
 * moreInfo.WarrantyClaimId on each line item and validates the checkout body.
 */
export type BillingTarget = 'CustomerOnly' | 'CustomerAndWarrantor' | 'WarrantorOnly';

/** Claim id stored in a line item's moreInfo JSON, or null when absent, empty, 0 or not valid JSON. */
export function claimIdOf(moreInfo: string | null | undefined): string | null {
  if (!moreInfo) return null;
  try {
    const parsed = JSON.parse(moreInfo);
    if (parsed && typeof parsed === 'object' && 'WarrantyClaimId' in parsed) {
      const id = parsed.WarrantyClaimId;
      if (id === null || id === undefined || id === '' || id === 0 || id === '0') return null;
      return String(id);
    }
  } catch {
    return null;
  }
  return null;
}

export interface WarrantyState {
  claimIds: number[];
  hasWarranty: boolean;
  allWarrantied: boolean;
}

export function warrantyState(items: { moreInfo?: string | null }[]): WarrantyState {
  const claimed = items.map((i) => claimIdOf(i.moreInfo)).filter((id): id is string => !!id);
  const claimIds = [...new Set(claimed.map(Number).filter((n) => !Number.isNaN(n)))];
  return { claimIds, hasWarranty: claimIds.length > 0, allWarrantied: items.length > 0 && claimed.length === items.length };
}

/** Billing options the Checkout drawer offers (none = no Checkout button at all). */
export function enabledTargets(state: WarrantyState): BillingTarget[] {
  if (!state.hasWarranty) return [];
  if (state.allWarrantied) return ['WarrantorOnly'];
  return ['CustomerOnly', 'CustomerAndWarrantor', 'WarrantorOnly'];
}

/** The part of the checkout request that depends on the chosen billing option. */
export function checkoutParams(target: BillingTarget, claimIds: number[]): { onlyWarrantors: boolean; warrantyClaimIds?: number[] } {
  switch (target) {
    case 'WarrantorOnly': return { onlyWarrantors: true, warrantyClaimIds: claimIds };
    case 'CustomerAndWarrantor': return { onlyWarrantors: false, warrantyClaimIds: claimIds };
    case 'CustomerOnly': return { onlyWarrantors: false };
  }
}
