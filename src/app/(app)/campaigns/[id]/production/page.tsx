"use client";

import { use, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCampaign,
  useProductionPlans,
  useAllPlanProducts,
  useProductsList,
  useAllPlanStepStatuses,
  useProductionDays,
  useAllProductionDayLineItems,
} from "@/lib/hooks";
import { IconArrowLeft as ArrowLeft, IconChevronRight as ChevronRight } from "@tabler/icons-react";

/**
 * Campaign-scoped production view — thin redirector to the canonical
 * `/production/<planId>` wizard. Single source of truth for ticking
 * steps, yield, allocation split + instructions.
 */
export default function CampaignProductionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const campaignId = decodeURIComponent(idStr);
  const router = useRouter();

  const campaign = useCampaign(campaignId);
  const allPlans = useProductionPlans();
  const allPlanProducts = useAllPlanProducts();
  const products = useProductsList(true);
  const allStatuses = useAllPlanStepStatuses();
  const productionDays = useProductionDays(120);
  const allLineItems = useAllProductionDayLineItems();

  const linkedPlans = useMemo(() => {
    if (!campaign) return [];
    const namePrefix = `Campaign: ${campaign.name} —`;
    return allPlans
      .filter((p) => p.id && (p.name ?? "").startsWith(namePrefix))
      .filter((p) => p.status !== "cancelled" && p.status !== "orphaned")
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [campaign, allPlans]);

  useEffect(() => {
    if (linkedPlans.length === 1 && linkedPlans[0].id) {
      router.replace(`/production/${encodeURIComponent(linkedPlans[0].id)}`);
    }
  }, [linkedPlans, router]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const dayById = useMemo(() => new Map(productionDays.map((d) => [d.id!, d])), [productionDays]);

  const planMeta = useMemo(() => {
    return linkedPlans.map((plan) => {
      const pps = allPlanProducts.filter((pp) => pp.planId === plan.id);
      const productNames = pps
        .map((pp) => productById.get(pp.productId)?.name)
        .filter((n): n is string => !!n)
        .join(", ");
      const totalQty = pps.reduce((s, pp) => s + (pp.quantity ?? 0), 0);
      const planLineItems = allLineItems.filter((li) => li.planId === plan.id);
      const dates = planLineItems
        .map((li) => dayById.get(li.productionDayId)?.date)
        .filter((d): d is string => !!d);
      const earliestDate = dates.sort()[0] ?? null;
      const planStatuses = allStatuses.filter((s) => s.planId === plan.id && s.done);
      const doneCount = planStatuses.length;
      return {
        plan,
        productNames: productNames || plan.name,
        totalQty,
        earliestDate,
        doneCount,
        status: plan.status,
      };
    });
  }, [linkedPlans, allPlanProducts, productById, allLineItems, dayById, allStatuses]);

  if (!campaign) {
    return (
      <div className="px-4 py-6 text-muted-foreground">Loading…</div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto">
      <div className="mb-4">
        <Link
          href={`/campaigns/${encodeURIComponent(campaignId)}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to campaign
        </Link>
      </div>

      <h1
        className="text-[26px] tracking-[-0.025em] mb-1"
        style={{ fontFamily: "var(--font-serif)", fontWeight: 400 }}
      >
        Production · {campaign.name}
      </h1>
      <p className="text-[12px] text-muted-foreground mb-5">
        {linkedPlans.length === 0
          ? "No batches linked to this campaign yet."
          : `${linkedPlans.length} batch${linkedPlans.length === 1 ? "" : "es"} — click any to open the production wizard.`}
      </p>

      {linkedPlans.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-[color:var(--ds-border-warm)] bg-card/60 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No batches scheduled. Run <Link href="/plan" className="text-primary hover:underline">Regenerate plan</Link> on /plan.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {planMeta.map(({ plan, productNames, totalQty, earliestDate, doneCount, status }) => (
            <li key={plan.id}>
              <Link
                href={`/production/${encodeURIComponent(plan.id!)}`}
                className="flex items-center gap-3 rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]/80 px-4 py-3 hover:border-foreground/30 transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 15 }}>
                      {productNames}
                    </span>
                    <span className="text-[10.5px] uppercase opacity-60" style={{ letterSpacing: "0.08em" }}>
                      {status}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-muted-foreground mt-0.5 tabular-nums">
                    {plan.batchNumber ?? "—"}
                    {totalQty > 0 && ` · ${totalQty} mould${totalQty === 1 ? "" : "s"}`}
                    {earliestDate && ` · ${new Date(earliestDate).toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" })}`}
                    {doneCount > 0 && ` · ${doneCount} step${doneCount === 1 ? "" : "s"} done`}
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
