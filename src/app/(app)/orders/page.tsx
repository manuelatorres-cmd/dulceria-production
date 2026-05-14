"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  useOrders, saveOrder, saveOrderItem, deleteOrder,
  useProductsList, useAllOrderItems, useCustomers,
  useCustomer, useCustomerProductPrices, useProductLocationTotals,
  useAllOrderPlanLinks, useAllProductionDayLineItems, useProductionDays,
  useAllPlanStepStatuses, useProductionSteps,
  useVariants, useAllVariantPackagings, useAllVariantPackagingProducts,
  usePackagingList,
} from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { resolveUnitPrice } from "@/lib/pricing";
import { planStepDoneById } from "@/lib/production";
import { ProductPicker } from "@/components/product-picker";
import {
  ORDER_CHANNELS, ORDER_CHANNEL_LABELS,
  ORDER_PRIORITIES, ORDER_PRIORITY_LABELS,
  ORDER_STATUSES, ORDER_STATUS_LABELS,
  STOCK_LOCATION_SHORT_LABELS,
  CHANNEL_FULFILMENT_DEFAULTS,
  type OrderChannel, type OrderPriority, type OrderStatus,
  type StockLocation,
} from "@/types";
import {
  IconPlus as Plus,
  IconSearch as Search,
  IconAlertTriangle as AlertTriangle,
  IconShoppingBag as ShoppingBag,
  IconX as X,
  IconBuildingWarehouse as Warehouse,
  IconFlame as Flame,
} from "@tabler/icons-react";
import { ListRow, StatusTag, PageHeader, Section, DsTabNav, DsButton, type ListRowTier, type StatusTagKind } from "@/components/dulceria";

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending:       "bg-[var(--accent-butter-bg)] text-[var(--accent-butter-ink)]",
  ready_to_pack: "bg-[var(--accent-mint-bg)] text-[var(--accent-mint-ink)]",
  in_production: "bg-[var(--accent-sky-bg)] text-[var(--accent-sky-ink)]",
  done:          "bg-[var(--accent-sage-bg)] text-[var(--accent-sage-ink)]",
  cancelled:     "bg-muted text-muted-foreground/60 line-through",
};

const PRIORITY_STYLE: Record<OrderPriority, string> = {
  low: "text-muted-foreground",
  normal: "text-foreground",
  high: "text-status-warn",
  urgent: "text-destructive font-semibold",
};

type FilterStatus = OrderStatus | "all";

export default function OrdersPage() {
  const orders = useOrders();
  const products = useProductsList(true);
  const allItems = useAllOrderItems();
  const allLinks = useAllOrderPlanLinks();
  const lineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(120);
  const planStepStatuses = useAllPlanStepStatuses();
  const productionSteps = useProductionSteps();

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);

  const itemsByOrder = useMemo(() => {
    const m = new Map<string, typeof allItems>();
    for (const item of allItems) {
      const arr = m.get(item.orderId) ?? [];
      arr.push(item);
      m.set(item.orderId, arr);
    }
    return m;
  }, [allItems]);

  // orderId → earliest unfinished step across all linked batches in
  // the daily-production model. Step progress lives on planStepStatus
  // (keyed by stepKey, which embeds the planProductId). A step is
  // "done" for a plan if any planStepStatus row matches its id prefix.
  const nextActionByOrder = useMemo(() => {
    const orderIdByItemId = new Map<string, string>();
    for (const item of allItems) {
      if (item.id && item.orderId) orderIdByItemId.set(item.id, item.orderId);
    }
    const planIdsByOrder = new Map<string, Set<string>>();
    for (const link of allLinks) {
      const orderId = orderIdByItemId.get(link.orderItemId);
      if (!orderId || !link.planId) continue;
      let s = planIdsByOrder.get(orderId);
      if (!s) { s = new Set(); planIdsByOrder.set(orderId, s); }
      s.add(link.planId);
    }
    const dayDateById = new Map(productionDays.map((d) => [d.id!, d.date]));
    const stepById = new Map(productionSteps.map((s) => [s.id!, s]));
    const doneKeysByPlan = new Map<string, Set<string>>();
    for (const s of planStepStatuses) {
      if (!s.done) continue;
      const set = doneKeysByPlan.get(s.planId) ?? new Set<string>();
      set.add(s.stepKey);
      doneKeysByPlan.set(s.planId, set);
    }
    // Single source of truth for "step done?" — maps the step row's
    // free-text name down to the wizard's canonical phase key, then
    // prefix-matches against done keys. Comparing the bare stepId
    // (UUID) against keys like "polishing-<ppId>" never matched, so
    // the orders list previously kept reporting steps as pending even
    // after the operator ticked them on /production.
    const stepDoneForPlan = (planId: string, stepId: string): boolean =>
      planStepDoneById(stepId, planId, stepById, doneKeysByPlan);

    const result = new Map<string, { label: string; when: string } | null>();
    for (const order of orders) {
      if (order.status === "done" || order.status === "cancelled") {
        result.set(order.id!, null);
        continue;
      }
      const planIds = planIdsByOrder.get(order.id!);
      if (!planIds || planIds.size === 0) {
        result.set(order.id!, { label: "Awaiting plan regeneration", when: "" });
        continue;
      }

      // Gather all (date, stepId) pairs from the linked plans'
      // lineItems, skipping steps already done. Earliest date → first
      // step in sortOrder wins.
      let best: { date: string; stepId: string } | null = null;
      for (const planId of planIds) {
        const planLineItems = lineItems
          .filter((li) => li.planId === planId)
          .map((li) => ({ li, date: dayDateById.get(li.productionDayId) }))
          .filter((x) => !!x.date) as Array<{ li: typeof lineItems[number]; date: string }>;
        planLineItems.sort((a, b) => a.date.localeCompare(b.date));
        for (const { li, date } of planLineItems) {
          const orderedSteps = [...li.stepIds].sort((a, b) => {
            const sa = stepById.get(a)?.sortOrder ?? 0;
            const sb = stepById.get(b)?.sortOrder ?? 0;
            return sa - sb;
          });
          for (const stepId of orderedSteps) {
            if (stepDoneForPlan(planId, stepId)) continue;
            if (!best || date < best.date) best = { date, stepId };
            break; // first unfinished step on earliest date is enough
          }
        }
      }
      if (!best) {
        result.set(order.id!, { label: "Ready", when: "" });
        continue;
      }
      const step = stepById.get(best.stepId);
      const label = step?.name ?? "Next step";
      const todayIso = (() => {
        const t = new Date(); t.setHours(0, 0, 0, 0);
        const y = t.getFullYear(), m = String(t.getMonth() + 1).padStart(2, "0"), dd = String(t.getDate()).padStart(2, "0");
        return `${y}-${m}-${dd}`;
      })();
      const dDate = new Date(best.date + "T00:00:00");
      const diffDays = Math.round((dDate.getTime() - new Date(todayIso + "T00:00:00").getTime()) / 86_400_000);
      const dateLabel = dDate.toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "short" });
      const when =
        diffDays < 0 ? `overdue — was ${dateLabel}` :
        diffDays === 0 ? "today" :
        diffDays === 1 ? "tomorrow" :
        dateLabel;
      result.set(order.id!, { label, when });
    }
    return result;
  }, [orders, allItems, allLinks, lineItems, productionDays, planStepStatuses, productionSteps]);

  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

  // Per-status counts drive the tab badges. Counted against the full
  // orders list (not the search-filtered list) so switching tabs while
  // a search is active still shows the right totals.
  const statusCounts = useMemo(() => {
    const counts: Record<FilterStatus, number> = {
      all: orders.length,
      pending: 0, ready_to_pack: 0, in_production: 0, done: 0, cancelled: 0,
    };
    for (const o of orders) counts[o.status] += 1;
    return counts;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      // Hide done + cancelled orders by default — they clutter the
      // active list. Only show them when the user explicitly picks
      // "All" or the matching status filter.
      if (filterStatus === "all") {
        if (o.status === "done" || o.status === "cancelled") return false;
      } else if (o.status !== filterStatus) {
        return false;
      }
      if (!q) return true;
      const name = `${o.customerName ?? ""} ${o.eventName ?? ""}`.toLowerCase();
      return name.includes(q);
    });
  }, [orders, search, filterStatus]);

  return (
    <div className="ds" style={{ background: "var(--ds-page-bg)", minHeight: "100vh" }}>
      <PageHeader
        title="Orders"
        meta="Customer orders feeding the production scheduler"
        actions={
          <>
            <Link
              href="/orders/online"
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 12px", fontSize: 13,
                border: "0.5px solid var(--ds-border-warm)", borderRadius: 4,
                background: "var(--ds-card-bg)", color: "var(--ds-text-primary)",
                textDecoration: "none",
              }}
              className="hover:bg-[color:var(--ds-card-bg-hover)]"
            >
              <ShoppingBag size={13} /> Online
            </Link>
            {!adding && (
              <DsButton variant="primary" size="sm" onClick={() => setAdding(true)}>
                <Plus size={13} style={{ marginRight: 4, verticalAlign: "-2px" }} /> New order
              </DsButton>
            )}
          </>
        }
      />
      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Search + status pills toolbar — flat, no card wrapper */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 320 }}>
            <Search size={13} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--ds-text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer or event"
              style={{
                width: "100%", padding: "6px 10px 6px 30px", fontSize: 13,
                border: "0.5px solid var(--ds-border-warm)", borderRadius: 4,
                background: "var(--ds-card-bg)", color: "var(--ds-text-primary)",
                outline: "none",
              }}
            />
          </div>
          <DsTabNav
            variant="pills"
            tabs={(["all", ...ORDER_STATUSES] as const).map((s) => ({
              id: s,
              label: s === "all" ? "All" : ORDER_STATUS_LABELS[s],
              count: statusCounts[s],
            }))}
            activeTab={filterStatus}
            onChange={(id) => setFilterStatus(id as FilterStatus)}
          />
        </div>

        {adding && <NewOrderForm onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />}

        {filtered.length === 0 ? (
          <Section title={orders.length === 0 ? "No orders yet" : "No matches"}>
            <p style={{ padding: "12px 20px", fontSize: 13, color: "var(--ds-text-muted)", fontStyle: "italic", textAlign: "center" }}>
              {orders.length === 0 ? "No orders yet. Click “New order” to add one." : "No orders match the filters."}
            </p>
          </Section>
        ) : (() => {
          // Section orders by channel so online / b2b / event / shop
          // each read as their own block. Within each, sorted by
          // deadline ascending.
          const byChannel = new Map<OrderChannel, typeof filtered>();
          for (const o of filtered) {
            const arr = byChannel.get(o.channel) ?? [];
            arr.push(o);
            byChannel.set(o.channel, arr);
          }
          const sections = ORDER_CHANNELS
            .filter((c) => byChannel.has(c))
            .map((c) => ({
              channel: c,
              orders: byChannel.get(c)!.sort((a, b) =>
                a.deadline.localeCompare(b.deadline),
              ),
            }));
          return sections.map(({ channel, orders: chOrders }) => (
            <Section
              key={channel}
              title={
                <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
                  <span>{ORDER_CHANNEL_LABELS[channel]}</span>
                  <span style={{ fontSize: 11, fontWeight: 400, color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    · {chOrders.length}
                  </span>
                </span>
              }
              noBody
            >
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {chOrders.map((order) => {
              const items = itemsByOrder.get(order.id!) ?? [];
              const lineCount = items.length;
              const totalQty = items.reduce((s, i) => s + i.quantity, 0);
              const deadlineDate = new Date(order.deadline);
              const today = new Date(); today.setHours(0, 0, 0, 0);
              const daysToDeadline = Math.round((deadlineDate.getTime() - today.getTime()) / 86_400_000);
              const overdue = daysToDeadline < 0 && order.status !== "done" && order.status !== "cancelled";

              const nextAction = nextActionByOrder.get(order.id!);
              // Pending orders split into two visual states: "Awaiting plan"
              // (no scheduler output yet — regenerate hasn't linked them) vs
              // "Scheduled" (has a linked batch, waiting on the operator to
              // start physical work). Derived from nextAction since the same
              // data drives both the badge and the next-action line below.
              const pendingSubState: "awaiting" | "scheduled" | null =
                order.status === "pending" && nextAction
                  ? nextAction.label === "Awaiting plan regeneration" ? "awaiting" : "scheduled"
                  : null;
              // Tier + status tag mapping per design-system spec.
              // Rule: max 2 tags per row. Channel info moves to the meta
              // line as plain text. Priority moves to meta.
              const tier: ListRowTier =
                order.status === "cancelled"
                  ? "parked"
                  : order.status === "done"
                  ? "done"
                  : overdue
                  ? "urgent"
                  : "default";
              const statusKind: StatusTagKind = overdue
                ? "overdue"
                : order.status === "ready_to_pack"
                ? "ready"
                : order.status === "in_production"
                ? "scheduled"
                : order.status === "done"
                ? "done"
                : order.status === "cancelled"
                ? "done"
                : "pending";
              const channelLabel = ORDER_CHANNEL_LABELS[order.channel];
              const fulfilmentText = order.fulfillmentType
                ? ` · ${order.fulfillmentType}`
                : "";
              const priorityText =
                order.priority !== "normal"
                  ? ` · ${ORDER_PRIORITY_LABELS[order.priority]}`
                  : "";
              const itemsPreview =
                items.length > 0
                  ? ` · ${items.slice(0, 3).map((i) => productMap.get(i.productId)?.name ?? "?").join(", ")}${items.length > 3 ? ` +${items.length - 3}` : ""}`
                  : "";
              const title = (
                <>
                  <span style={{ flex: "0 1 auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {order.customerName || order.eventName || "(unnamed)"}
                  </span>
                  {order.sourceRef && (
                    <span
                      className="text-ds-meta tabular-nums"
                      style={{ fontStyle: "normal", fontSize: 11 }}
                      title="Source order reference"
                    >
                      {order.sourceRef}
                    </span>
                  )}
                  <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                    <StatusTag kind={statusKind}>
                      {overdue ? "Overdue" : ORDER_STATUS_LABELS[order.status]}
                    </StatusTag>
                    {pendingSubState && !overdue && (
                      <StatusTag kind={pendingSubState === "scheduled" ? "scheduled" : "pending"}>
                        {pendingSubState === "scheduled" ? "Scheduled" : "Awaiting plan"}
                      </StatusTag>
                    )}
                  </span>
                </>
              );
              const meta = (
                <>
                  {channelLabel}
                  {fulfilmentText}
                  {priorityText}
                  {" · "}
                  {lineCount} line{lineCount !== 1 ? "s" : ""} · {totalQty} piece{totalQty !== 1 ? "s" : ""}
                  {itemsPreview}
                </>
              );
              const secondary =
                nextAction && pendingSubState !== "awaiting" ? (
                  <>
                    <span style={{ color: "var(--ds-text-muted)" }}>Next: </span>
                    <span style={{ fontWeight: 500, color: "var(--ds-text-primary)", fontStyle: "normal" }}>
                      {nextAction.label}
                    </span>
                    {nextAction.when && (
                      <span style={{ color: "var(--ds-text-muted)" }}> · {nextAction.when}</span>
                    )}
                  </>
                ) : undefined;
              const side = (
                <>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: overdue ? "var(--ds-tier-urgent)" : "var(--ds-text-primary)",
                    }}
                  >
                    {formatDeadline(order.deadline)}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: overdue ? "var(--ds-tier-urgent)" : "var(--ds-text-muted)",
                      fontStyle: overdue ? "normal" : "italic",
                    }}
                  >
                    {overdue
                      ? "overdue"
                      : daysToDeadline === 0
                      ? "today"
                      : daysToDeadline === 1
                      ? "tomorrow"
                      : `in ${daysToDeadline}d`}
                  </span>
                </>
              );
              return (
                <li key={order.id} style={{ background: "var(--ds-card-bg)" }}>
                  <Link
                    href={`/orders/${encodeURIComponent(order.id!)}`}
                    className="block"
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    <ListRow
                      tier={tier}
                      title={title}
                      meta={meta}
                      secondary={secondary}
                      side={side}
                    />
                  </Link>
                </li>
              );
            })}
              </ul>
            </Section>
          ));
        })()}
      </div>
    </div>
  );
}

/**
 * Draft line held in local state. Nothing here is persisted until the
 * user clicks Save order.
 *
 *   productId "" means the line hasn't picked a product yet — rendered
 *   but not included in the save payload.
 *   fulfilmentMode undefined means the operator hasn't picked yet — the
 *   save button stays disabled until every product-bearing line has a
 *   choice. There's NO auto-default; silently marking borrow was the
 *   old bug we're fixing.
 */
type DraftLine = {
  key: string;
  productId: string;
  productName: string;   // picker display; set on pick to keep the input in sync
  quantity: number;
  unitPrice?: number;
  fulfilmentMode?: "produce" | "borrow";
  notes?: string;
  /** Set when this line was generated by picking a variant + size on the
   *  Add Variant panel. Production ignores both — they exist for the order
   *  UI to group lines by their originating variant/size. */
  variantId?: string;
  variantPackagingId?: string;
};

/** State for the partial-stock prompt. Fires on Save when at least one
 *  'Take from stock' line has available < requested. The operator
 *  resolves each line via one of the two actions below. */
type PartialLine = {
  key: string;
  productId: string;
  productName: string;
  requested: number;
  available: number;
  /** User's choice. When every row has a choice, the prompt's Apply
   *  button becomes active. */
  decision?: "split" | "reduce";
};

let draftLineCounter = 0;
function newDraftLineKey(): string {
  draftLineCounter += 1;
  return `dl-${draftLineCounter}`;
}

function makeEmptyLine(): DraftLine {
  return {
    key: newDraftLineKey(),
    productId: "",
    productName: "",
    quantity: 1,
  };
}

function NewOrderForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const router = useRouter();
  const [channel, setChannel] = useState<OrderChannel>("b2b");
  const [customerId, setCustomerId] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [eventName, setEventName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<OrderPriority>("normal");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [lines, setLines] = useState<DraftLine[]>(() => [makeEmptyLine()]);
  const [partialPrompt, setPartialPrompt] = useState<PartialLine[] | null>(null);

  // Add-Variant panel state. When open, lets the user pick a variant +
  // size + box count and expands into DraftLines stamped with the
  // originating variantId/variantPackagingId. Production reads only
  // productId+qty so the variant fields are pure traceability.
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [pickedVariantId, setPickedVariantId] = useState<string>("");
  const [pickedSizeId, setPickedSizeId] = useState<string>("");
  const [pickedBoxCount, setPickedBoxCount] = useState<number>(1);

  const variants = useVariants();
  const allVariantPackagings = useAllVariantPackagings();
  const allVariantPackagingProducts = useAllVariantPackagingProducts();
  const allPackaging = usePackagingList(true);

  // Data hooks. customerProductPrices + linkedCustomer depend on the
  // live customerId selection so they refetch when the customer changes.
  const customers = useCustomers(false);
  const products = useProductsList(true);
  const locationTotals = useProductLocationTotals();
  const linkedCustomer = useCustomer(customerId);
  const customerProductPrices = useCustomerProductPrices(customerId || undefined);
  const { data: variantProducts = [] } = useQuery({
    queryKey: ["variant-products", "all-for-new-order"],
    queryFn: async () =>
      assertOk(
        await supabase.from("variantProducts").select("variantId, productId, unitPrice"),
      ) as Array<{ variantId: string; productId: string; unitPrice?: number }>,
  });

  // productId → highest unitPrice across any variant that lists it.
  // Used as the retail fallback in resolveUnitPrice.
  const productRetailPrice = useMemo(() => {
    const map = new Map<string, number>();
    for (const cp of variantProducts) {
      if (cp.unitPrice == null) continue;
      const prev = map.get(cp.productId);
      if (prev == null || cp.unitPrice > prev) map.set(cp.productId, cp.unitPrice);
    }
    return map;
  }, [variantProducts]);

  function resolveProductPrice(productId: string) {
    return resolveUnitPrice({
      productId,
      customerId: customerId || undefined,
      customerProductPrices: customerProductPrices.map((p) => ({
        productId: p.productId, unitPrice: p.unitPrice,
      })),
      customerPriceListId: linkedCustomer?.defaultPriceListId,
      priceListEntries: variantProducts,
      customerDiscountPercent: linkedCustomer?.defaultDiscountPercent,
      retailPrice: productRetailPrice.get(productId),
    });
  }

  function availableFor(productId: string): number {
    const t = locationTotals.get(productId);
    if (!t) return 0;
    return Math.max(0, (t.store ?? 0) + (t.production ?? 0));
  }

  function locationsFor(productId: string): Record<StockLocation, number> | null {
    return locationTotals.get(productId) ?? null;
  }

  // ── Line operations ──────────────────────────────────────────────
  function updateLine(key: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    setLines((prev) => {
      const next = prev.filter((l) => l.key !== key);
      return next.length > 0 ? next : [makeEmptyLine()];
    });
  }

  function addEmptyLine() {
    setLines((prev) => [...prev, makeEmptyLine()]);
  }

  // ── Variant pick: expand a (variant, size, boxCount) into DraftLines
  // stamped with originating variantId/variantPackagingId. For curated
  // variants, per-box product mix comes from variantPackagingProducts.
  // For free-pick, append one empty line the user fills in manually.
  function applyVariantPick() {
    if (!pickedVariantId || !pickedSizeId || pickedBoxCount < 1) return;
    const variant = variants.find((v) => v.id === pickedVariantId);
    const size = allVariantPackagings.find((vp) => vp.id === pickedSizeId);
    if (!variant || !size) return;
    const packaging = allPackaging.find((p) => p.id === size.packagingId);
    const capacity = packaging?.capacity ?? 0;

    // Channel-aware gross price (VAT-inc); fall back to the default
    // price if the current order channel has no override.
    const channelOverride = size.channelPrices?.[channel];
    const boxPrice = channelOverride ?? size.price ?? size.sellPrice ?? 0;
    // Distribute the box price across the per-box piece count so
    // orderItems unit prices sum back to the box total. (Kept on the
    // gross scale — the order-item vat pipeline stays as-is.)
    const perPieceUnitPrice = capacity > 0 ? boxPrice / capacity : undefined;

    // Always pull composition rows if present — works for curated AND
    // free-pick variants where the user pre-set a default composition.
    // Free-pick with no composition still falls back to the
    // single-stamped-line flow so the user can pick chocolates manually.
    const comp = allVariantPackagingProducts
      .filter((vpp) => vpp.variantPackagingId === pickedSizeId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (comp.length > 0) {
      const newLines: DraftLine[] = comp.map((vpp) => {
        const prod = products.find((p) => p.id === vpp.productId);
        return {
          key: newDraftLineKey(),
          productId: vpp.productId,
          productName: prod?.name ?? "",
          quantity: vpp.qty * pickedBoxCount,
          unitPrice: perPieceUnitPrice,
          fulfilmentMode: CHANNEL_FULFILMENT_DEFAULTS[channel],
          variantId: pickedVariantId,
          variantPackagingId: pickedSizeId,
        };
      });
      // Drop any blank empty-line at the end then append the new set,
      // plus a trailing empty for further free-form product picks.
      setLines((prev) => {
        const trimmed = prev.filter((l) => l.productId || l.variantPackagingId);
        return [...trimmed, ...newLines, makeEmptyLine()];
      });
    } else if (variant.kind === "curated") {
      alert(
        `"${variant.name}" — this size has no product composition yet. Open the variant page and set the chocolates that go in this box, then re-add it.`,
      );
      return;
    } else {
      // free-pick with no composition: add a single empty line stamped
      // with the variant so the user's next product pick is attributed
      // to this size.
      const freePickLine: DraftLine = {
        key: newDraftLineKey(),
        productId: "",
        productName: "",
        quantity: 1,
        unitPrice: perPieceUnitPrice,
        fulfilmentMode: CHANNEL_FULFILMENT_DEFAULTS[channel],
        variantId: pickedVariantId,
        variantPackagingId: pickedSizeId,
      };
      setLines((prev) => {
        const trimmed = prev.filter((l) => l.productId || l.variantPackagingId);
        return [...trimmed, freePickLine, makeEmptyLine()];
      });
    }

    // Reset the panel for the next pick.
    setPickedVariantId("");
    setPickedSizeId("");
    setPickedBoxCount(1);
    setShowAddVariant(false);
  }

  function pickProductForLine(key: string, productId: string, name: string) {
    const price = resolveProductPrice(productId).unitPrice ?? undefined;
    setLines((prev) => {
      const next = prev.map((l) =>
        l.key === key
          ? { ...l, productId, productName: name, unitPrice: l.unitPrice ?? price }
          : l,
      );
      // Auto-append an empty line when the picked line is the last
      // one — keeps the user moving forward without needing to click
      // "Add product" after each pick.
      const idx = next.findIndex((l) => l.key === key);
      if (idx === next.length - 1) next.push(makeEmptyLine());
      return next;
    });
  }

  // ── Validation ───────────────────────────────────────────────────
  const productBearingLines = lines.filter((l) => l.productId);
  const missingMode = productBearingLines.some((l) => !l.fulfilmentMode);
  const missingPrice = productBearingLines.some((l) => l.unitPrice == null);
  const headerValid = !!deadline
    && (channel === "shop" ? true : (customerName.trim() || eventName.trim()));
  const canSave = !!headerValid
    && productBearingLines.length > 0
    && !missingMode
    && !saving;

  // ── Save flow ────────────────────────────────────────────────────
  async function handleSave() {
    if (!canSave) return;
    setSaveError("");

    // Detect partial-stock rows (Take from stock + available < requested).
    const partial: PartialLine[] = [];
    for (const line of productBearingLines) {
      if (line.fulfilmentMode !== "borrow") continue;
      const avail = availableFor(line.productId);
      if (avail < line.quantity) {
        const p = products.find((x) => x.id === line.productId);
        partial.push({
          key: line.key,
          productId: line.productId,
          productName: p?.name ?? line.productName,
          requested: line.quantity,
          available: avail,
        });
      }
    }

    if (partial.length > 0) {
      setPartialPrompt(partial);
      return;
    }

    await performSave(productBearingLines);
  }

  async function performSave(finalLines: DraftLine[]) {
    setSaving(true);
    setSaveError("");
    let createdOrderId: string | undefined;
    try {
      createdOrderId = await saveOrder({
        channel,
        customerId: customerId || undefined,
        customerName: customerName.trim() || undefined,
        eventName: channel === "event" && eventName.trim() ? eventName.trim() : undefined,
        deadline: new Date(deadline).toISOString(),
        priority,
        status: "pending",
        notes: notes.trim() || undefined,
      });

      // Insert lines sequentially so the existing allocation / reconcile
      // machinery inside saveOrderItem fires per-line. fulfilmentMode is
      // required on every new line — the user picked it explicitly.
      let sortOrder = 0;
      for (const line of finalLines) {
        await saveOrderItem({
          orderId: createdOrderId,
          productId: line.productId,
          quantity: line.quantity,
          sortOrder: sortOrder++,
          notes: line.notes?.trim() || undefined,
          unitPrice: line.unitPrice,
          fulfilmentMode: line.fulfilmentMode ?? CHANNEL_FULFILMENT_DEFAULTS[channel],
          variantId: line.variantId,
          variantPackagingId: line.variantPackagingId,
        });
      }

      onSaved();
      router.push(`/orders/${encodeURIComponent(createdOrderId)}`);
    } catch (err) {
      // Roll back the partially-created order so retry is clean.
      if (createdOrderId) {
        try { await deleteOrder(createdOrderId); } catch {
          // swallow — the user can clean up on the orders list if this
          // also fails; we still surface the original error.
        }
      }
      const raw: { message?: string; code?: string; details?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      setSaveError(`${raw.message || raw.details || "Save failed"}${code}`);
      console.error("saveOrder failed:", err);
    } finally {
      setSaving(false);
    }
  }

  // Partial-stock prompt resolution → rebuild lines with splits /
  // reductions and re-run save.
  async function applyPartialResolutions(resolved: PartialLine[]) {
    const resolvedByKey = new Map(resolved.map((r) => [r.key, r]));
    const finalLines: DraftLine[] = [];
    for (const line of productBearingLines) {
      const r = resolvedByKey.get(line.key);
      if (!r || !r.decision) {
        finalLines.push(line);
        continue;
      }
      if (r.decision === "reduce") {
        finalLines.push({ ...line, quantity: r.available });
        continue;
      }
      // split: borrow <available> + produce <rest>.
      if (r.available > 0) {
        finalLines.push({ ...line, quantity: r.available, fulfilmentMode: "borrow" });
      }
      const rest = line.quantity - r.available;
      if (rest > 0) {
        finalLines.push({
          ...line,
          key: newDraftLineKey(),
          quantity: rest,
          fulfilmentMode: "produce",
        });
      }
    }
    setPartialPrompt(null);
    await performSave(finalLines);
  }

  return (
    <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-4">
      <p className="text-sm font-medium">New order</p>

      {/* Header fields */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Type</label>
            <select value={channel} onChange={(e) => setChannel(e.target.value as OrderChannel)} className="input">
              {ORDER_CHANNELS.map((c) => <option key={c} value={c}>{ORDER_CHANNEL_LABELS[c]}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value as OrderPriority)} className="input">
              {ORDER_PRIORITIES.map((p) => <option key={p} value={p}>{ORDER_PRIORITY_LABELS[p]}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Customer {channel === "shop" && <span className="text-muted-foreground font-normal">(optional for shop)</span>}</label>
          {customers.length > 0 && (
            <select
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                const c = customers.find((x) => x.id === e.target.value);
                if (c) setCustomerName(c.companyName);
              }}
              className="input mb-1.5"
            >
              <option value="">— no linked customer —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>{c.companyName}</option>
              ))}
            </select>
          )}
          <input
            type="text"
            value={customerName}
            onChange={(e) => { setCustomerName(e.target.value); setCustomerId(""); }}
            placeholder="e.g. Hotel Sacher"
            className="input"
          />
        </div>

        {channel === "event" && (
          <div>
            <label className="label">Event name</label>
            <input
              type="text"
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              placeholder="e.g. Veganmania 2026"
              className="input"
            />
          </div>
        )}

        <div>
          <label className="label">Deadline</label>
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="input"
          />
        </div>

        <div>
          <label className="label">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Delivery address, packaging preferences…"
            className="input resize-none"
          />
        </div>
      </div>

      {/* Products — "Add product" button sits on the LEFT of the
          section header per the new spec. */}
      <section className="space-y-2 pt-2 border-t border-[color:var(--ds-border-warm)]">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => setShowAddVariant((v) => !v)}
            className="flex items-center gap-1.5 rounded-[4px] bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium"
          >
            <Plus className="w-3.5 h-3.5" /> Add variant
          </button>
          <button
            type="button"
            onClick={addEmptyLine}
            className="flex items-center gap-1.5 rounded-[4px] border border-[color:var(--ds-border-warm)] px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <Plus className="w-3.5 h-3.5" /> Add product
          </button>
          <h3 className="text-sm font-semibold text-primary">Products</h3>
          {productBearingLines.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {productBearingLines.length} line{productBearingLines.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {showAddVariant && (() => {
          const variantSizes = allVariantPackagings.filter((vp) => vp.variantId === pickedVariantId);
          const pickedVariant = variants.find((v) => v.id === pickedVariantId);
          return (
            <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3 space-y-2">
              <p className="text-xs text-muted-foreground">
                Pick a variant, its size, and how many boxes. Price uses{" "}
                <strong>{ORDER_CHANNEL_LABELS[channel]}</strong> — change the Type above first if wrong.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="text-[11px] text-muted-foreground">Variant</label>
                  <select
                    value={pickedVariantId}
                    onChange={(e) => { setPickedVariantId(e.target.value); setPickedSizeId(""); }}
                    className="input text-sm"
                  >
                    <option value="">Select variant…</option>
                    {variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} {v.kind === "free-pick" ? "(free pick)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Size</label>
                  <select
                    value={pickedSizeId}
                    onChange={(e) => setPickedSizeId(e.target.value)}
                    disabled={!pickedVariantId}
                    className="input text-sm disabled:opacity-50"
                  >
                    <option value="">Select size…</option>
                    {variantSizes.map((vp) => {
                      const pkg = allPackaging.find((p) => p.id === vp.packagingId);
                      const override = vp.channelPrices?.[channel];
                      const price = override ?? vp.price ?? vp.sellPrice ?? 0;
                      return (
                        <option key={vp.id} value={vp.id}>
                          {pkg?.name ?? "?"} ({pkg?.capacity ?? 0} pcs) — €{price.toFixed(2)}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Box count</label>
                  <input
                    type="number"
                    min={1}
                    value={pickedBoxCount}
                    onChange={(e) => setPickedBoxCount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="input text-sm"
                  />
                </div>
              </div>
              {pickedVariantId && pickedVariant?.kind === "free-pick" && pickedSizeId && (
                <p className="text-[11px] text-muted-foreground">
                  Free-pick variant — after adding you can fill in the products below (one line stamped with this variant will appear).
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={applyVariantPick}
                  disabled={!pickedVariantId || !pickedSizeId || pickedBoxCount < 1}
                  className="btn-primary px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddVariant(false);
                    setPickedVariantId("");
                    setPickedSizeId("");
                    setPickedBoxCount(1);
                  }}
                  className="btn-secondary px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          );
        })()}

        <ul className="space-y-2">
          {lines.map((line) => (
            <li key={line.key}>
              <DraftLineRow
                line={line}
                products={products}
                priceFor={(id) => resolveProductPrice(id).unitPrice}
                availableFor={availableFor}
                locationsFor={locationsFor}
                onPickProduct={(id, p) => pickProductForLine(line.key, id, p.name)}
                onPatch={(patch) => updateLine(line.key, patch)}
                onRemove={() => removeLine(line.key)}
                onEnterFromLastField={() => {
                  // Enter on the last field of the last line → add
                  // another empty line. Only useful once the current
                  // line has a product picked (otherwise it's a no-op
                  // — we already have an empty line).
                  if (line.productId && lines[lines.length - 1].key === line.key) {
                    addEmptyLine();
                  }
                }}
              />
            </li>
          ))}
        </ul>
        {missingMode && productBearingLines.length > 0 && (
          <p className="text-xs text-status-warn flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Pick a stock source for every line.
          </p>
        )}
        {missingPrice && productBearingLines.length > 0 && !missingMode && (
          <p className="text-xs text-muted-foreground">
            Some lines have no price resolved — enter one manually or leave it blank (the order will save without a line total).
          </p>
        )}
      </section>

      {/* Save actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="rounded-[4px] bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save order"}
        </button>
        <button onClick={onCancel} className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
      {saveError && (
        <p className="text-xs text-status-alert pt-1">{saveError}</p>
      )}

      {partialPrompt && (
        <PartialStockPrompt
          lines={partialPrompt}
          onApply={applyPartialResolutions}
          onCancel={() => setPartialPrompt(null)}
        />
      )}
    </div>
  );
}

function DraftLineRow({
  line, products, priceFor, availableFor, locationsFor, onPickProduct, onPatch, onRemove, onEnterFromLastField,
}: {
  line: DraftLine;
  products: Array<{ id?: string; name: string; archived?: boolean }>;
  priceFor: (productId: string) => number | null;
  availableFor: (productId: string) => number;
  locationsFor: (productId: string) => Record<StockLocation, number> | null;
  onPickProduct: (productId: string, product: { id?: string; name: string }) => void;
  onPatch: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
  onEnterFromLastField: () => void;
}) {
  const available = line.productId ? availableFor(line.productId) : 0;
  const short = line.productId && available < line.quantity;
  const locs = line.productId ? locationsFor(line.productId) : null;
  const visibleLocs = (["store", "production", "freezer"] as const)
    .filter((k) => (locs?.[k] ?? 0) > 0);

  return (
    <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]/50 p-2 space-y-2">
      <div className="grid grid-cols-12 gap-2 items-start">
        <div className="col-span-6">
          <ProductPicker
            products={products}
            selectedProductId={line.productId || undefined}
            selectedName={line.productName}
            onSelect={(id, p) => onPickProduct(id, p)}
            priceForProduct={priceFor}
            placeholder="Search or tap to list…"
          />
        </div>
        <div className="col-span-2">
          <input
            type="number"
            min="1"
            step="1"
            value={line.quantity}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              onPatch({ quantity: isNaN(n) || n < 1 ? 1 : n });
            }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnterFromLastField(); } }}
            placeholder="Qty"
            className="input"
          />
        </div>
        <div className="col-span-3">
          <input
            type="number"
            min="0"
            step="0.01"
            value={line.unitPrice != null ? line.unitPrice : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "") { onPatch({ unitPrice: undefined }); return; }
              const n = parseFloat(v);
              onPatch({ unitPrice: isNaN(n) || n < 0 ? undefined : n });
            }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnterFromLastField(); } }}
            placeholder="Unit price, net"
            className="input"
          />
        </div>
        <div className="col-span-1 flex items-center justify-end">
          <button
            type="button"
            onClick={onRemove}
            className="text-muted-foreground/50 hover:text-destructive"
            aria-label="Remove line"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {line.productId && (
        <div className="flex items-center gap-3 flex-wrap pl-1 text-xs">
          {visibleLocs.length === 0 ? (
            <span className="text-muted-foreground">No stock in any location</span>
          ) : (
            <span className="text-muted-foreground">
              {visibleLocs.map((k, i) => (
                <span key={k}>
                  {i > 0 && <span className="mx-1.5 text-muted-foreground/50">·</span>}
                  {STOCK_LOCATION_SHORT_LABELS[k]}{" "}
                  <span className="font-medium tabular-nums text-foreground">{locs![k]}</span>
                </span>
              ))}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <StockSourceButton
              icon={<Warehouse className="w-3 h-3" />}
              label="Take from stock"
              active={line.fulfilmentMode === "borrow"}
              disabled={available === 0}
              onClick={() => onPatch({ fulfilmentMode: "borrow" })}
            />
            <StockSourceButton
              icon={<Flame className="w-3 h-3" />}
              label="Produce fresh"
              active={line.fulfilmentMode === "produce"}
              onClick={() => onPatch({ fulfilmentMode: "produce" })}
            />
          </div>
          {!line.fulfilmentMode && (
            <span className="text-status-warn">Pick one</span>
          )}
          {short && line.fulfilmentMode === "borrow" && (
            <span className="text-status-warn">
              Only {available} available — the rest will prompt on Save.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function StockSourceButton({ icon, label, active, disabled, onClick }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-[color:var(--ds-border-warm)] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-[color:var(--ds-border-warm)] disabled:hover:text-muted-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function PartialStockPrompt({ lines, onApply, onCancel }: {
  lines: PartialLine[];
  onApply: (resolved: PartialLine[]) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [local, setLocal] = useState<PartialLine[]>(lines);
  const allDecided = local.every((l) => !!l.decision);

  function setDecision(key: string, decision: "split" | "reduce") {
    setLocal((prev) => prev.map((l) => (l.key === key ? { ...l, decision } : l)));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 " onClick={onCancel} />
      <div className="relative w-full max-w-lg rounded border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-xl overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-[color:var(--ds-border-warm)]">
          <h3 className="text-base font-bold text-foreground">Not enough in stock</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick what to do for each line. Split keeps the order quantity; Reduce trims it to what's on hand.
          </p>
        </div>
        <ul className="max-h-96 overflow-y-auto px-5 py-3 space-y-3">
          {local.map((l) => (
            <li key={l.key} className="rounded-[4px] border border-[color:var(--ds-border-warm)] p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium">{l.productName}</p>
                <p className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {l.available} / {l.requested}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setDecision(l.key, "split")}
                  className={`flex-1 rounded-[6px] border px-3 py-1.5 text-xs ${
                    l.decision === "split"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-[color:var(--ds-border-warm)] text-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  Split — {l.available} from stock + produce {l.requested - l.available}
                </button>
                <button
                  type="button"
                  onClick={() => setDecision(l.key, "reduce")}
                  className={`flex-1 rounded-[6px] border px-3 py-1.5 text-xs ${
                    l.decision === "reduce"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-[color:var(--ds-border-warm)] text-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  Reduce order to {l.available}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="px-5 py-4 border-t border-[color:var(--ds-border-warm)] flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[4px] border border-[color:var(--ds-border-warm)] px-4 py-2 text-sm"
          >
            Back to edit
          </button>
          <button
            type="button"
            onClick={() => onApply(local)}
            disabled={!allDecided}
            className="rounded-[4px] bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            Apply &amp; save
          </button>
        </div>
      </div>
    </div>
  );
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" });
}
