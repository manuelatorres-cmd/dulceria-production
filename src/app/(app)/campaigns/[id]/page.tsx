"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconChevronDown, IconChevronRight, IconPencil } from "@tabler/icons-react";
import { VolumePlanning } from "@/components/campaign-detail/volume-planning";
import {
  NextUpBanner,
  type NextUpVariant,
  TimelineStrip,
  type TimelineMarker,
  PageHeader as DsPageHeader,
  StatCard,
  StatusTag,
  DsButton,
  type StatCardVariant,
} from "@/components/dulceria";
import { BackButton } from "@/components/back-button";
import { phaseKeyFromStepName } from "@/lib/production";
import {
  useCampaign,
  saveCampaign,
  deleteCampaign,
  useProductsList,
  useProductCategories,
  useProductionPlans,
  useAllPlanProducts,
  useAllPlanStepStatuses,
  useProductionSteps,
  useOrders,
  useAllOrderItems,
} from "@/lib/hooks";
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_STATUSES,
  ORDER_CHANNEL_LABELS,
  type CampaignStatus,
  type CampaignType,
} from "@/types";

/**
 * Campaign detail — view first, edit on request. Summary blocks
 * grouped by product category; each block expands to show each
 * product's current production stage. Clicking a product routes to
 * its in-flight batch.
 */
export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const campaignId = decodeURIComponent(idStr);
  const campaign = useCampaign(campaignId);
  const products = useProductsList();
  const productCategories = useProductCategories(true);
  const allPlans = useProductionPlans();
  const allPlanProducts = useAllPlanProducts();
  const allStepStatuses = useAllPlanStepStatuses();
  const productionSteps = useProductionSteps();
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const router = useRouter();

  const [editing, setEditing] = useState(false);

  if (!campaign) {
    return <div className="py-12 text-center text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="px-6 sm:px-10 pt-8 pb-12 max-w-[1400px] mx-auto">
      <div className="mb-3">
        <BackButton
          fallbackHref="/campaigns"
          fallbackLabel="Campaigns"
          onBack={() => router.back()}
          className="inline-flex items-center gap-1 text-[11px] uppercase text-muted-foreground hover:text-foreground tracking-[0.1em]"
        />
      </div>

      {editing ? (
        <CampaignEditor
          campaign={campaign}
          products={products}
          productCategories={productCategories}
          onDone={() => setEditing(false)}
          onDeleted={() => router.replace("/campaigns")}
        />
      ) : (
        <CampaignView
          campaign={campaign}
          products={products}
          productCategories={productCategories}
          allPlans={allPlans}
          allPlanProducts={allPlanProducts}
          allStepStatuses={allStepStatuses}
          productionSteps={productionSteps}
          orders={orders}
          orderItems={orderItems}
          onEdit={() => setEditing(true)}
        />
      )}
    </div>
  );
}

// ─── View mode ─────────────────────────────────────────────────────────

type CampaignViewProps = {
  campaign: NonNullable<ReturnType<typeof useCampaign>>;
  products: ReturnType<typeof useProductsList>;
  productCategories: ReturnType<typeof useProductCategories>;
  allPlans: ReturnType<typeof useProductionPlans>;
  allPlanProducts: ReturnType<typeof useAllPlanProducts>;
  allStepStatuses: ReturnType<typeof useAllPlanStepStatuses>;
  productionSteps: ReturnType<typeof useProductionSteps>;
  orders: ReturnType<typeof useOrders>;
  orderItems: ReturnType<typeof useAllOrderItems>;
  onEdit: () => void;
};

const CARD = "bg-[color:var(--ds-card-bg)] border border-[color:var(--ds-border-warm)] rounded-[18px] p-4 shadow-[0_1px_2px_rgba(16,18,24,0.04),0_8px_24px_rgba(16,18,24,0.05)]";

function CampaignView({
  campaign, products, productCategories, allPlans, allPlanProducts, allStepStatuses, productionSteps, orders, orderItems, onEdit,
}: CampaignViewProps) {
  const todayIso = toIsoDate(new Date());
  const endMs = campaign.endDate ? new Date(campaign.endDate + "T00:00:00").getTime() : null;
  const startMs = campaign.startDate ? new Date(campaign.startDate + "T00:00:00").getTime() : null;
  const daysLeft = endMs != null
    ? Math.round((endMs - new Date(todayIso + "T00:00:00").getTime()) / 86_400_000)
    : null;

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const categoryMap = useMemo(() => new Map(productCategories.map((c) => [c.id!, c])), [productCategories]);
  const stepMap = useMemo(() => new Map(productionSteps.map((s) => [s.id!, s])), [productionSteps]);

  // Plans that include any of this campaign's products. One product can have
  // multiple draft/active batches — we surface the most relevant: the active
  // one if any, else the latest draft.
  const campaignProductIds = new Set(campaign.productIds);

  // Map product id → batches that include it.
  const plansByProduct = useMemo(() => {
    const m = new Map<string, { plan: typeof allPlans[number]; pp: typeof allPlanProducts[number] }[]>();
    for (const pp of allPlanProducts) {
      if (!campaignProductIds.has(pp.productId)) continue;
      const plan = allPlans.find((p) => p.id === pp.planId);
      if (!plan) continue;
      const arr = m.get(pp.productId) ?? [];
      arr.push({ plan, pp });
      m.set(pp.productId, arr);
    }
    return m;
  }, [allPlans, allPlanProducts, campaignProductIds]);

  const doneKeysByPlan = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const s of allStepStatuses) {
      if (!s.done) continue;
      const set = m.get(s.planId) ?? new Set<string>();
      set.add(s.stepKey);
      m.set(s.planId, set);
    }
    return m;
  }, [allStepStatuses]);

  type Stage = "not_started" | "in_progress" | "done";
  function productStage(productId: string): { stage: Stage; currentStepName: string; progress: number; planId?: string } {
    const entries = plansByProduct.get(productId) ?? [];
    // Only live plans (draft + active) drive campaign progress. Old
    // done/cancelled plans from earlier testing must NOT colour the
    // campaign board green at 100% just because they share the same
    // product id. Without this filter a stale completed batch was
    // picked over a fresh draft, then `completedAt` short-circuited
    // progress to 100.
    const live = entries.filter((e) => e.plan.status === "draft" || e.plan.status === "active");
    if (live.length === 0) return { stage: "not_started", currentStepName: "Not scheduled", progress: 0 };
    // Prefer active > draft (latest by batchNumber desc within tier).
    const sorted = [...live].sort((a, b) => {
      const rank = (s: string | undefined) => (s === "active" ? 0 : s === "draft" ? 1 : 2);
      const ra = rank(a.plan.status);
      const rb = rank(b.plan.status);
      if (ra !== rb) return ra - rb;
      return (b.plan.batchNumber ?? "").localeCompare(a.plan.batchNumber ?? "");
    });
    const { plan } = sorted[0];
    if (plan.completedAt) return { stage: "done", currentStepName: "Completed", progress: 100, planId: plan.id };
    const orderedSteps = productionSteps
      .filter((s) => !s.productType || s.productType === (productMap.get(productId)?.productCategoryId
        ? categoryMap.get(productMap.get(productId)!.productCategoryId!)?.name
        : null))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    let lastDoneIdx = -1;
    orderedSteps.forEach((s, i) => {
      // Phase-key prefix match — bare stepId UUIDs never matched the
      // wizard's `polishing-<ppId>` keys, so campaign progress always
      // read 0% even after operator ticked steps done.
      const phase = phaseKeyFromStepName(s.name);
      if (!phase) return;
      const set = doneKeysByPlan.get(plan.id!);
      if (!set) return;
      const anyDone = [...set].some((k) => k === phase || k.startsWith(`${phase}-`));
      if (anyDone) lastDoneIdx = i;
    });
    const total = orderedSteps.length || 1;
    const currentIdx = lastDoneIdx + 1 < total ? lastDoneIdx + 1 : lastDoneIdx;
    const progress = Math.round(((lastDoneIdx + 1) / total) * 100);
    const currentStepName = orderedSteps[currentIdx]?.name ?? (plan.status === "active" ? "In progress" : "Queued");
    const stage: Stage = lastDoneIdx < 0 ? "not_started" : progress === 100 ? "done" : "in_progress";
    return { stage, currentStepName, progress, planId: plan.id };
  }

  // Group products by category.
  const blocks = useMemo(() => {
    const byCat = new Map<string, { categoryName: string; items: Array<{ productId: string; productName: string; target: number | null } & ReturnType<typeof productStage>> }>();
    const targets = campaign.productTargets ?? {};
    for (const pid of campaign.productIds) {
      const p = productMap.get(pid);
      if (!p) continue;
      const catName = p.productCategoryId
        ? (categoryMap.get(p.productCategoryId)?.name ?? "Uncategorised")
        : "Uncategorised";
      const info = productStage(pid);
      const target = typeof targets[pid] === "number" ? targets[pid] : null;
      const entry = byCat.get(catName) ?? { categoryName: catName, items: [] };
      entry.items.push({ productId: pid, productName: p.name, target, ...info });
      byCat.set(catName, entry);
    }
    return [...byCat.values()].sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  }, [campaign.productIds, campaign.productTargets, productMap, categoryMap, plansByProduct, doneKeysByPlan, productionSteps]); // eslint-disable-line react-hooks/exhaustive-deps

  // Campaign-level rollup.
  const allItems = blocks.flatMap((b) => b.items);
  const totalProducts = allItems.length;
  const doneCount = allItems.filter((i) => i.stage === "done").length;
  const inProgressCount = allItems.filter((i) => i.stage === "in_progress").length;
  const notStartedCount = allItems.filter((i) => i.stage === "not_started").length;
  const overallProgress = totalProducts > 0
    ? Math.round(allItems.reduce((s, i) => s + i.progress, 0) / totalProducts)
    : 0;

  // "In time?" heuristic: if any product is not_started AND daysLeft is small, late.
  const onTime = (() => {
    if (campaign.status === "done") return "done";
    if (endMs == null) return "unknown";
    if (daysLeft! < 0) return "late";
    if (daysLeft! <= 3 && notStartedCount > 0) return "late";
    if (overallProgress === 100) return "done";
    const elapsed = startMs != null && endMs != null ? (Date.now() - startMs) / (endMs - startMs) : 0;
    const expected = Math.max(0, Math.min(1, elapsed));
    if (overallProgress / 100 >= expected - 0.15) return "ok";
    return "behind";
  })();

  const onTimeLabel: Record<string, string> = {
    done: "Completed",
    ok: "On time",
    behind: "Running behind",
    late: "Late",
    unknown: "—",
  };
  const onTimeTone: Record<string, string> = {
    done: "bg-[var(--accent-mint-bg)] text-[var(--accent-mint-ink)]",
    ok: "bg-[var(--accent-mint-bg)] text-[var(--accent-mint-ink)]",
    behind: "bg-[var(--accent-butter-bg)] text-[var(--accent-butter-ink)]",
    late: "bg-[var(--accent-blush-bg)] text-[var(--accent-blush-ink)]",
    unknown: "bg-muted text-muted-foreground",
  };

  const onTimeTagKind: Record<string, "ready" | "pending" | "overdue" | "neutral" | "done"> = {
    done: "done",
    ok: "ready",
    behind: "pending",
    late: "overdue",
    unknown: "neutral",
  };
  void onTimeTone;

  return (
    <div className="ds">
      <DsPageHeader
        title={campaign.name || "Untitled campaign"}
        meta={
          <>
            <span style={{ textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 10 }}>
              {campaign.type}
            </span>
            {(campaign.startDate || campaign.endDate) && (
              <>
                {" · "}
                {campaign.startDate} → {campaign.endDate}
              </>
            )}
          </>
        }
        badges={
          <StatusTag kind={onTimeTagKind[onTime] ?? "neutral"}>
            {onTimeLabel[onTime]}
          </StatusTag>
        }
        actions={
          <>
            <DsButton
              variant="primary"
              size="md"
              onClick={() =>
                window.location.assign(
                  `/campaigns/${encodeURIComponent(campaign.id ?? "")}/production`,
                )
              }
            >
              Production schedule →
            </DsButton>
            {campaign.name && (
              <DsButton
                variant="default"
                size="md"
                onClick={() =>
                  window.location.assign(
                    `/plan?focus=campaign:${encodeURIComponent(campaign.name)}`,
                  )
                }
              >
                Plan in /plan →
              </DsButton>
            )}
            <DsButton variant="default" size="md" onClick={onEdit}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconPencil size={12} stroke={1.5} /> Edit
              </span>
            </DsButton>
          </>
        }
      />

      <div style={{ padding: "16px 32px 40px" }}>

      {/* Next-up banner (Phase 3.2) */}
      {(() => {
        if (campaign.status === "done") return null;
        if (campaign.status === "cancelled") return null;
        const today = new Date();
        const todayMs = today.setHours(0, 0, 0, 0);
        const endTs = endMs;
        const prodMs = campaign.productionStartDate
          ? new Date(campaign.productionStartDate + "T00:00:00").getTime()
          : null;
        const overdue = endTs != null && endTs < todayMs && overallProgress < 100;
        let variant: NextUpVariant = "next";
        let title = `Ramp up ${campaign.name}`;
        let meta = "";
        const firstProduct = allItems.find((i) => i.stage !== "done");
        if (overdue) {
          variant = "behind";
          title = `Behind schedule — ${notStartedCount} batch${notStartedCount === 1 ? "" : "es"} not started`;
          meta = `Launch was ${campaign.endDate} · ${Math.abs(daysLeft ?? 0)} day${Math.abs(daysLeft ?? 0) === 1 ? "" : "s"} overdue`;
        } else if (inProgressCount > 0 && firstProduct) {
          variant = "in-progress";
          title = `Continue ${firstProduct.currentStepName} on ${firstProduct.productName}`;
          meta = `${doneCount}/${totalProducts} products done · ${overallProgress}% overall`;
        } else if (firstProduct) {
          variant = "next";
          title = `Start ${firstProduct.currentStepName} on ${firstProduct.productName}`;
          const daysToProd =
            prodMs != null ? Math.ceil((prodMs - todayMs) / 86_400_000) : null;
          const rampLabel =
            daysToProd != null && daysToProd >= 0
              ? `ramp starts ${campaign.productionStartDate} (${daysToProd} day${daysToProd === 1 ? "" : "s"} from today)`
              : "no ramp date set";
          meta = `${totalProducts} product${totalProducts === 1 ? "" : "s"} planned · ${rampLabel}`;
        } else {
          return null;
        }
        return (
          <div className="mb-3">
            <NextUpBanner
              variant={variant}
              title={title}
              meta={meta}
              action={
                campaign.name ? (
                  <Link
                    href={`/plan?focus=campaign:${encodeURIComponent(campaign.name)}`}
                    style={{
                      fontSize: 12,
                      background: "var(--ds-tier-quarter-focus)",
                      color: "#fff",
                      padding: "6px 14px",
                      borderRadius: 4,
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    Start now →
                  </Link>
                ) : undefined
              }
            />
          </div>
        );
      })()}

      {/* Campaign timeline (Phase 3.2) */}
      {campaign.startDate && campaign.endDate ? (
        <div className="mb-3">
          <TimelineStrip
            startIso={campaign.startDate}
            endIso={campaign.endDate}
            markers={(() => {
              const todayIsoStr = toIsoDate(new Date());
              const out: TimelineMarker[] = [{ iso: todayIsoStr, label: "today", tone: "today" }];
              if (campaign.productionStartDate) {
                out.push({
                  iso: campaign.productionStartDate,
                  label: "production",
                  tone: "primary",
                });
              }
              out.push({ iso: campaign.endDate, label: "launch", tone: "primary" });
              return out;
            })()}
            statusText={onTimeLabel[onTime]}
          />
        </div>
      ) : null}

      {/* KPI strip — DS StatCards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <StatCard
          variant="default"
          label="Products in campaign"
          value={totalProducts}
          meta={`${blocks.length} categor${blocks.length === 1 ? "y" : "ies"}`}
        />
        <StatCard
          variant="ok"
          label="Done"
          value={doneCount}
          meta={totalProducts > 0 ? `${Math.round((doneCount / totalProducts) * 100)}% of target` : "—"}
        />
        <StatCard
          variant="warn"
          label="In progress"
          value={inProgressCount}
          meta={notStartedCount > 0 ? `${notStartedCount} not started` : "all underway"}
        />
        <StatCard
          variant={
            onTime === "late" ? "urgent" : onTime === "behind" ? "warn" : "ok"
          }
          label="Days remaining"
          value={daysLeft ?? "—"}
          meta={
            daysLeft != null
              ? daysLeft < 0
                ? "overdue"
                : daysLeft === 0
                ? "deadline today"
                : `deadline ${campaign.endDate}`
              : undefined
          }
        />
      </div>

      {/* Volume planning (target units × list price → projected revenue) */}
      <VolumePlanning campaign={campaign} products={products} />

      {/* Overall progress bar */}
      <div className={`${CARD} mb-4`}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] tracking-[0.08em] uppercase text-muted-foreground font-semibold">Overall progress</span>
          <span className="text-[13px] tabular-nums font-semibold">{overallProgress}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <i
            className="block h-full"
            style={{
              width: `${overallProgress}%`,
              background: onTime === "late" ? "var(--accent-blush-ink)"
                : onTime === "behind" ? "var(--accent-butter-ink)"
                : "var(--accent-mint-ink)",
            }}
          />
        </div>
      </div>

      {/* Category blocks */}
      {blocks.length === 0 ? (
        <div className={`${CARD} text-center py-10`}>
          <p className="text-sm text-muted-foreground">
            No products assigned yet. Click <span className="font-medium text-foreground">Edit</span> to add some.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {blocks.map((b) => (
            <CategoryBlock key={b.categoryName} block={b} campaignId={campaign.id!} />
          ))}
        </div>
      )}

      {/* Auto-matched orders — deadline in campaign window AND at
          least one ordered product is in this campaign. View-only;
          no explicit campaignId on orders yet. Click to open order. */}
      <OrdersInCampaign
        campaign={campaign}
        orders={orders}
        orderItems={orderItems}
      />

      {/* Notes */}
      {campaign.notes && (
        <section className={`${CARD} mt-4`}>
          <h3 className="text-[10px] tracking-[0.08em] uppercase text-muted-foreground font-semibold mb-2">Notes</h3>
          <p className="text-sm whitespace-pre-wrap">{campaign.notes}</p>
        </section>
      )}
      </div>
    </div>
  );
  void stepMap; // kept for future per-step rendering in the expanded view
}

function CategoryBlock({
  block,
  campaignId,
}: {
  block: {
    categoryName: string;
    items: Array<{
      productId: string;
      productName: string;
      target: number | null;
      stage: "not_started" | "in_progress" | "done";
      currentStepName: string;
      progress: number;
      planId?: string;
    }>;
  };
  campaignId: string;
}) {
  const [open, setOpen] = useState(false);
  const total = block.items.length;
  const done = block.items.filter((i) => i.stage === "done").length;
  const inProg = block.items.filter((i) => i.stage === "in_progress").length;
  const avgProgress = total > 0 ? Math.round(block.items.reduce((s, i) => s + i.progress, 0) / total) : 0;
  const worstStage = block.items.some((i) => i.stage === "not_started") && done < total
    ? "not_started"
    : inProg > 0
    ? "in_progress"
    : "done";
  const stageTone = {
    not_started: "bg-muted text-muted-foreground",
    in_progress: "bg-[var(--accent-butter-bg)] text-[var(--accent-butter-ink)]",
    done: "bg-[var(--accent-mint-bg)] text-[var(--accent-mint-ink)]",
  }[worstStage];

  return (
    <section className={CARD}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 text-left"
      >
        {open ? <IconChevronDown size={16} stroke={1.5} className="text-muted-foreground shrink-0" /> : <IconChevronRight size={16} stroke={1.5} className="text-muted-foreground shrink-0" />}
        <div className="flex-1 min-w-0">
          <h3
            className="text-[17px] tracking-[-0.02em]"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}
          >
            {block.categoryName}
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {done}/{total} done · {inProg} in progress · {avgProgress}% avg
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] ${stageTone}`}>
          {worstStage === "not_started" ? "Not started" : worstStage === "in_progress" ? "In progress" : "Done"}
        </span>
      </button>

      {/* Category-level bar */}
      <div className="h-1 mt-3 rounded-full bg-border overflow-hidden">
        <i
          className="block h-full"
          style={{
            width: `${avgProgress}%`,
            background: worstStage === "done" ? "var(--accent-mint-ink)" :
              worstStage === "in_progress" ? "var(--accent-butter-ink)" :
              "var(--color-border)",
          }}
        />
      </div>

      {open && (
        <ul className="mt-3 space-y-1.5">
          {block.items.map((i) => (
            <li key={i.productId}>
              <Link
                href={i.planId ? `/production/${encodeURIComponent(i.planId)}?from=campaigns&fromId=${encodeURIComponent(campaignId)}` : `/products/${encodeURIComponent(i.productId)}?from=campaigns&fromId=${encodeURIComponent(campaignId)}`}
                className="flex items-center gap-3 rounded-[10px] border border-border bg-card px-3 py-2 hover:border-foreground/30 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">
                    {i.productName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {i.currentStepName}
                  </p>
                </div>
                <div className="w-24">
                  <div className="h-1 rounded-full bg-border overflow-hidden">
                    <i
                      className="block h-full"
                      style={{
                        width: `${i.progress}%`,
                        background: i.stage === "done" ? "var(--accent-mint-ink)" :
                          i.stage === "in_progress" ? "var(--accent-butter-ink)" :
                          "var(--color-border)",
                      }}
                    />
                  </div>
                  <p className="text-[10px] text-muted-foreground text-right mt-0.5 tabular-nums">{i.progress}%</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function OrdersInCampaign({
  campaign, orders, orderItems,
}: {
  campaign: NonNullable<ReturnType<typeof useCampaign>>;
  orders: ReturnType<typeof useOrders>;
  orderItems: ReturnType<typeof useAllOrderItems>;
}) {
  const campaignProductIds = new Set(campaign.productIds);
  const matched = useMemo(() => {
    if (!campaign.startDate || !campaign.endDate) return [];
    const startIso = campaign.startDate;
    const endIso = campaign.endDate;
    const itemsByOrder = new Map<string, typeof orderItems>();
    for (const oi of orderItems) {
      const arr = itemsByOrder.get(oi.orderId) ?? [];
      arr.push(oi);
      itemsByOrder.set(oi.orderId, arr);
    }
    return orders
      .filter((o) => {
        if (!o.deadline) return false;
        const d = o.deadline.slice(0, 10);
        if (d < startIso || d > endIso) return false;
        const items = itemsByOrder.get(o.id!) ?? [];
        return items.some((oi) => oi.productId && campaignProductIds.has(oi.productId));
      })
      .sort((a, b) => a.deadline.localeCompare(b.deadline));
  }, [orders, orderItems, campaign.startDate, campaign.endDate, campaignProductIds]);

  if (matched.length === 0) return null;

  return (
    <section className={`${CARD} mt-4`}>
      <h3 className="text-[10px] tracking-[0.08em] uppercase text-muted-foreground font-semibold mb-3">
        Orders in this window · {matched.length}
      </h3>
      <ul className="space-y-1.5">
        {matched.slice(0, 12).map((o) => {
          const deadlineLabel = new Date(o.deadline).toLocaleDateString("de-AT", { day: "numeric", month: "short" });
          return (
            <li key={o.id}>
              <Link
                href={`/orders/${encodeURIComponent(o.id!)}?from=campaigns&fromId=${encodeURIComponent(campaign.id!)}`}
                className="flex items-center gap-3 rounded-[10px] border border-border bg-card/80 px-3 py-2 hover:border-foreground/30"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">
                    {o.customerName || o.eventName || "(unnamed order)"}
                    <span className="ml-1.5 text-[10px] uppercase tracking-[0.05em] text-muted-foreground">
                      {ORDER_CHANNEL_LABELS[o.channel]}
                    </span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">{o.status}</p>
                </div>
                <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">{deadlineLabel}</span>
              </Link>
            </li>
          );
        })}
        {matched.length > 12 && (
          <li className="text-[11px] text-muted-foreground text-center">+{matched.length - 12} more</li>
        )}
      </ul>
    </section>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ─── Edit mode (same form as before) ──────────────────────────────────

function CampaignEditor({
  campaign, products, productCategories, onDone, onDeleted,
}: {
  campaign: NonNullable<ReturnType<typeof useCampaign>>;
  products: ReturnType<typeof useProductsList>;
  productCategories: ReturnType<typeof useProductCategories>;
  onDone: () => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(campaign.name);
  const [type, setType] = useState<CampaignType>(campaign.type);
  const [status, setStatus] = useState<CampaignStatus>(campaign.status);
  const [startDate, setStartDate] = useState(campaign.startDate);
  const [endDate, setEndDate] = useState(campaign.endDate);
  const [productionStartDate, setProductionStartDate] = useState(campaign.productionStartDate ?? "");
  const [targetTotalUnits, setTargetTotalUnits] = useState<number | "">(campaign.targetTotalUnits ?? "");
  const [productIds, setProductIds] = useState<string[]>(campaign.productIds);
  const [productTargets, setProductTargets] = useState<Record<string, number>>(campaign.productTargets ?? {});
  const [notes, setNotes] = useState(campaign.notes ?? "");
  const [isolated, setIsolated] = useState<boolean>(campaign.isolated ?? false);
  const [businessHubCampaignId, setBusinessHubCampaignId] = useState<string>(
    campaign.businessHubCampaignId ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setName(campaign.name);
    setType(campaign.type);
    setStatus(campaign.status);
    setStartDate(campaign.startDate);
    setEndDate(campaign.endDate);
    setProductionStartDate(campaign.productionStartDate ?? "");
    setTargetTotalUnits(campaign.targetTotalUnits ?? "");
    setProductIds(campaign.productIds);
    setProductTargets(campaign.productTargets ?? {});
    setNotes(campaign.notes ?? "");
    setIsolated(campaign.isolated ?? false);
    setBusinessHubCampaignId(campaign.businessHubCampaignId ?? "");
  }, [campaign]);

  async function save() {
    setSaving(true);
    try {
      // Empty-string dates blow up Postgres with "invalid input syntax
      // for type date". Coerce empties → undefined so PostgREST drops
      // the field. Required start/end fall back to today if blank, but
      // tell the user.
      const today = new Date().toISOString().slice(0, 10);
      const safeStart = (startDate || "").trim() || today;
      const safeEnd = (endDate || "").trim() || today;
      const safeRamp = (productionStartDate || "").trim() || undefined;

      await saveCampaign({
        id: campaign.id,
        name: name.trim() || "Untitled",
        type,
        status,
        startDate: safeStart,
        endDate: safeEnd,
        productionStartDate: safeRamp,
        targetTotalUnits: targetTotalUnits === "" ? undefined : Number(targetTotalUnits),
        productIds,
        // Strip stale targets for products no longer in the campaign so
        // we don't carry orphaned numbers across edits.
        productTargets: Object.fromEntries(
          Object.entries(productTargets).filter(([pid, n]) => productIds.includes(pid) && n > 0),
        ),
        notes: notes.trim() || undefined,
        isolated,
        businessHubCampaignId: businessHubCampaignId.trim() || undefined,
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!campaign.id) return;
    await deleteCampaign(campaign.id);
    onDeleted();
  }

  function toggleProduct(id: string) {
    setProductIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  // Glass-style input chrome — matches site-wide iOS direction. Input
  // sits on the gradient body, not a flat white rectangle.
  const glassInput = "w-full rounded-[10px] border border-[color:var(--ds-border-warm)] bg-white/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-foreground/30 transition-colors";

  const categoryMap = useMemo(() => new Map(productCategories.map((c) => [c.id!, c])), [productCategories]);
  const [productSearch, setProductSearch] = useState("");
  const [hiddenCategories, setHiddenCategories] = useState<Set<string>>(new Set());

  const productsByCategory = useMemo(() => {
    const m = new Map<string, ReturnType<typeof useProductsList>>();
    const q = productSearch.trim().toLowerCase();
    for (const p of products) {
      if (p.archived) continue;
      if (q && !p.name.toLowerCase().includes(q)) continue;
      const catName = p.productCategoryId
        ? (categoryMap.get(p.productCategoryId)?.name ?? "Uncategorised")
        : "Uncategorised";
      const arr = m.get(catName) ?? [];
      arr.push(p);
      m.set(catName, arr);
    }
    // Sort each bucket alphabetically.
    for (const [, arr] of m) arr.sort((a, b) => a.name.localeCompare(b.name));
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [products, productSearch, categoryMap]);

  function toggleCategoryVisibility(cat: string) {
    setHiddenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  function toggleCategorySelection(cat: string, ids: string[]) {
    const allSelected = ids.every((id) => productIds.includes(id));
    if (allSelected) {
      setProductIds((prev) => prev.filter((id) => !ids.includes(id)));
    } else {
      setProductIds((prev) => Array.from(new Set([...prev, ...ids])));
    }
    void cat;
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-3 mb-4">
        <h1
          className="text-[26px] tracking-[-0.025em]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400 }}
        >
          {name || "Untitled campaign"}
        </h1>
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{type}</span>
        <span className="text-[12px] text-muted-foreground">
          {startDate} → {endDate}
        </span>
      </div>

      {/* Narrow form left, wide product picker right — glass style. */}
      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        <section className={`${CARD} space-y-3`}>
          <Field label="Name">
            <input className={glassInput} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <select className={glassInput} value={type} onChange={(e) => setType(e.target.value as CampaignType)}>
                {CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className={glassInput} value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus)}>
                {CAMPAIGN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Start">
              <input type="date" className={glassInput} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field label="End">
              <input type="date" className={glassInput} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>

          <Field label="Ramp-up (optional)">
            <input type="date" className={glassInput} value={productionStartDate} onChange={(e) => setProductionStartDate(e.target.value)} />
          </Field>

          <Field label="Target units (optional)">
            <input type="number" min={0} className={glassInput} value={targetTotalUnits}
              onChange={(e) => setTargetTotalUnits(e.target.value === "" ? "" : Number(e.target.value))}
            />
          </Field>

          <Field label="Notes">
            <textarea className={`${glassInput} resize-none`} value={notes} rows={3} onChange={(e) => setNotes(e.target.value)} />
          </Field>

          <Field label="Business Hub campaign id (optional)">
            <input
              type="text"
              className={glassInput}
              value={businessHubCampaignId}
              onChange={(e) => setBusinessHubCampaignId(e.target.value)}
              placeholder="Paste BH campaign id"
            />
          </Field>

          <label className="flex items-start gap-2.5 cursor-pointer select-none rounded-[10px] border border-[color:var(--ds-border-warm)] bg-white/40 px-3 py-2.5">
            <input
              type="checkbox"
              checked={isolated}
              onChange={(e) => setIsolated(e.target.checked)}
              className="mt-0.5 accent-[#4a6b5b]"
            />
            <span className="text-[12.5px] leading-snug">
              <span className="block font-medium">Keep production isolated</span>
              <span className="block text-muted-foreground text-[11px]">
                Batches for this campaign stay separate — won't share moulds with replen/other orders, won't be folded into combined plans for the same product.
              </span>
            </span>
          </label>

          <div className="flex justify-between items-center pt-3 border-t border-white/40 flex-wrap gap-2">
            <div className="flex gap-2">
              <button type="button" onClick={save} disabled={saving} className="btn-primary">
                {saving ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={onDone} className="btn-secondary">Cancel</button>
            </div>
            {confirmDelete ? (
              <span className="flex items-center gap-2 text-[11.5px]">
                <span className="text-muted-foreground">Delete?</span>
                <button
                  onClick={doDelete}
                  className="text-[color:var(--color-status-alert)] font-medium hover:underline"
                >
                  Yes
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-muted-foreground hover:underline">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-[11px] uppercase text-muted-foreground hover:text-[color:var(--color-status-alert)]"
                style={{ letterSpacing: "0.1em" }}
              >
                Delete
              </button>
            )}
          </div>
        </section>

        <aside className={CARD}>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h3
              className="text-[15px]"
              style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
            >
              Products
              <span className="ml-2 text-[10px] text-muted-foreground uppercase font-normal" style={{ letterSpacing: "0.12em" }}>
                {productIds.length} selected
              </span>
            </h3>
            <input
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Filter products…"
              className={`${glassInput} max-w-[220px]`}
            />
          </div>

          {productsByCategory.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No products match.</p>
          ) : (
            <div className="space-y-2">
              {productsByCategory.map(([catName, catProducts]) => {
                const catIds = catProducts.map((p) => p.id!).filter(Boolean);
                const selectedInCat = catIds.filter((id) => productIds.includes(id)).length;
                const hidden = hiddenCategories.has(catName);
                const allSelected = selectedInCat === catIds.length && catIds.length > 0;
                return (
                  <div key={catName} className="rounded-[10px] border border-[color:var(--ds-border-warm)] bg-white/40 overflow-hidden">
                    <div className="flex items-center gap-2 px-3 py-2">
                      <button
                        type="button"
                        onClick={() => toggleCategoryVisibility(catName)}
                        className="flex items-center gap-1.5 text-left flex-1 min-w-0"
                      >
                        {hidden
                          ? <IconChevronRight size={14} stroke={1.5} className="text-muted-foreground" />
                          : <IconChevronDown size={14} stroke={1.5} className="text-muted-foreground" />}
                        <span
                          className="text-[13px] truncate capitalize"
                          style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}
                        >
                          {catName}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                          {selectedInCat}/{catIds.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleCategorySelection(catName, catIds)}
                        className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground hover:text-foreground"
                      >
                        {allSelected ? "None" : "All"}
                      </button>
                    </div>
                    {!hidden && (
                      <ul className="px-2 pb-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {catProducts.map((p) => {
                          const checked = productIds.includes(p.id ?? "");
                          return (
                            <li key={p.id}>
                              <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[color:var(--ds-card-bg)] text-[13px] cursor-pointer">
                                <input
                                  type="checkbox"
                                  className="w-3.5 h-3.5"
                                  checked={checked}
                                  onChange={() => p.id && toggleProduct(p.id)}
                                />
                                <span className="truncate">{p.name}</span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
