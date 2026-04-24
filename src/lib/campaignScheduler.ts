/**
 * Campaign scheduler — pure functions only.
 *
 * Job: for each active campaign, propose ramp-up replenishment batches
 * spread between `productionStartDate` and `startDate` so the catalog
 * is stocked when the campaign opens.
 *
 * Output: an array of replenishment proposal candidates (reason
 * 'campaign-prep'). Caller persists via saveReplenishmentProposal.
 */

import type { Campaign, Product, ReplenishmentProposal } from "@/types";
import { addDays } from "./replenishmentEngine";

/** Default lead time in days when productionStartDate isn't set. */
export const DEFAULT_RAMP_DAYS = 14;

/** Spread `total` units across `daysAvailable` working days, returning
 *  ceil per-day batch sizes rounded to the mould floor. */
export function spreadAcrossDays(args: {
  totalUnits: number;
  daysAvailable: number;
  mouldFloor: number;
}): number[] {
  if (args.daysAvailable <= 0 || args.totalUnits <= 0) return [];
  const perDayRaw = Math.ceil(args.totalUnits / args.daysAvailable);
  const perDay =
    args.mouldFloor > 0
      ? Math.ceil(perDayRaw / args.mouldFloor) * args.mouldFloor
      : perDayRaw;
  const slots: number[] = [];
  let remaining = args.totalUnits;
  for (let i = 0; i < args.daysAvailable && remaining > 0; i++) {
    const qty = Math.min(remaining, perDay);
    slots.push(qty);
    remaining -= qty;
  }
  return slots;
}

/** Resolve the date production ramp should begin for a campaign. */
export function resolveRampStart(campaign: Campaign): string {
  if (campaign.productionStartDate) return campaign.productionStartDate;
  return addDays(campaign.startDate, -DEFAULT_RAMP_DAYS);
}

/** Generate proposal rows for a single campaign. */
export function buildCampaignProposals(args: {
  campaign: Campaign;
  productsById: Map<string, Product>;
  /** Pieces per mould, keyed by productId. Defaults to 40. */
  mouldFloorByProduct: Map<string, number>;
  /** Optional explicit per-product unit split. When absent, splits the
   *  campaign's targetTotalUnits evenly across products. */
  perProductTargets?: Map<string, number>;
}): Array<Omit<ReplenishmentProposal, "id" | "createdAt" | "updatedAt">> {
  if (args.campaign.status === "done" || args.campaign.status === "cancelled") return [];
  if (!args.campaign.productIds.length) return [];
  const rampStart = resolveRampStart(args.campaign);
  const out: Array<Omit<ReplenishmentProposal, "id" | "createdAt" | "updatedAt">> = [];

  for (const productId of args.campaign.productIds) {
    const product = args.productsById.get(productId);
    if (!product) continue;
    const mouldFloor = args.mouldFloorByProduct.get(productId) ?? 40;
    const perProductTarget =
      args.perProductTargets?.get(productId) ??
      (args.campaign.targetTotalUnits
        ? Math.ceil(args.campaign.targetTotalUnits / args.campaign.productIds.length)
        : 0);
    if (perProductTarget <= 0) continue;
    out.push({
      productId,
      suggestedBatchSize:
        Math.ceil(perProductTarget / mouldFloor) * mouldFloor,
      earliestNeededDate: rampStart,
      priorityTier: (product.priorityTier ?? 2) as 1 | 2 | 3,
      reason: "campaign-prep",
      status: "pending",
      notes: `Campaign: ${args.campaign.name}`,
    });
  }
  return out;
}

/** Top-level run across multiple campaigns. */
export function runCampaignScheduler(args: {
  campaigns: Campaign[];
  productsById: Map<string, Product>;
  mouldFloorByProduct: Map<string, number>;
}): Array<Omit<ReplenishmentProposal, "id" | "createdAt" | "updatedAt">> {
  return args.campaigns.flatMap((c) =>
    buildCampaignProposals({
      campaign: c,
      productsById: args.productsById,
      mouldFloorByProduct: args.mouldFloorByProduct,
    }),
  );
}
