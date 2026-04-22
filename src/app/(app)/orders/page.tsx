"use client";

import { useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useOrders, saveOrder, saveOrderItem, deleteOrder,
  useProductsList, useAllOrderItems, useCustomers,
  useCustomer, useCustomerProductPrices, useProductLocationTotals,
  useAllOrderPlanLinks, useAllProductionDayLineItems, useProductionDays,
  useAllPlanStepStatuses, useProductionSteps,
} from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { resolveUnitPrice } from "@/lib/pricing";
import { ProductPicker } from "@/components/product-picker";
import {
  ORDER_CHANNELS, ORDER_CHANNEL_LABELS,
  ORDER_PRIORITIES, ORDER_PRIORITY_LABELS,
  ORDER_STATUSES, ORDER_STATUS_LABELS,
  STOCK_LOCATION_SHORT_LABELS,
  type OrderChannel, type OrderPriority, type OrderStatus,
  type StockLocation,
} from "@/types";
import { Plus, Search, AlertTriangle, ShoppingBag, X, Warehouse, Flame } from "lucide-react";

const STATUS_STYLE: Record<OrderStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  in_production: "bg-status-warn-bg text-status-warn",
  done: "bg-status-ok-bg text-status-ok",
  cancelled: "bg-muted text-muted-foreground/60 line-through",
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
    const stepDoneForPlan = (planId: string, stepId: string): boolean => {
      const done = doneKeysByPlan.get(planId);
      if (!done) return false;
      for (const k of done) {
        if (k === stepId || k.startsWith(`${stepId}-`)) return true;
      }
      return false;
    };

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
      const dateLabel = dDate.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
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
      pending: 0, in_production: 0, done: 0, cancelled: 0,
    };
    for (const o of orders) counts[o.status] += 1;
    return counts;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (filterStatus !== "all" && o.status !== filterStatus) return false;
      if (!q) return true;
      const name = `${o.customerName ?? ""} ${o.eventName ?? ""}`.toLowerCase();
      return name.includes(q);
    });
  }, [orders, search, filterStatus]);

  return (
    <div>
      <PageHeader title="Orders" description="Customer orders that feed the production scheduler" />

      <div className="px-4 pb-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by customer or event"
              className="input !pl-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/orders/online"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm font-medium hover:border-primary hover:text-primary"
            >
              <ShoppingBag className="w-3.5 h-3.5" /> Online
            </Link>
            {!adding && (
              <button
                onClick={() => setAdding(true)}
                className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> New order
              </button>
            )}
          </div>
        </div>

        {/* Status tabs. "All" plus each of the four statuses; count
            badges reflect the unfiltered-by-search totals so the user
            can always see where work is parked. */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(["all", ...ORDER_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                filterStatus === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {s === "all" ? "All" : ORDER_STATUS_LABELS[s]}
              <span className="ml-1.5 opacity-70 tabular-nums">
                {statusCounts[s]}
              </span>
            </button>
          ))}
        </div>

        {adding && <NewOrderForm onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} />}

        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center border border-dashed border-border rounded-lg">
            {orders.length === 0 ? "No orders yet." : "No orders match the filters."}
          </p>
        ) : (
          <ul className="space-y-2">
            {filtered.map((order) => {
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
              return (
                <li key={order.id}>
                  <Link
                    href={`/orders/${encodeURIComponent(order.id!)}`}
                    className="block rounded-lg border border-border bg-card p-3 hover:border-primary/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">
                            {order.customerName || order.eventName || "(unnamed)"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {ORDER_CHANNEL_LABELS[order.channel]}
                          </span>
                          <span className={`text-xs rounded-full px-2 py-0.5 ${STATUS_STYLE[order.status]}`}>
                            {ORDER_STATUS_LABELS[order.status]}
                          </span>
                          {pendingSubState && (
                            <span className={`text-xs rounded-full px-2 py-0.5 border ${
                              pendingSubState === "scheduled"
                                ? "border-status-ok/40 bg-status-ok/10 text-status-ok"
                                : "border-status-warn/40 bg-status-warn/10 text-status-warn"
                            }`}>
                              {pendingSubState === "scheduled" ? "Scheduled" : "Awaiting plan"}
                            </span>
                          )}
                          <span className={`text-xs ${PRIORITY_STYLE[order.priority]}`}>
                            {ORDER_PRIORITY_LABELS[order.priority]}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {lineCount} line{lineCount !== 1 ? "s" : ""} · {totalQty} piece{totalQty !== 1 ? "s" : ""}
                          {items.length > 0 && (
                            <span className="ml-1">· {items.slice(0, 3).map((i) => productMap.get(i.productId)?.name ?? "?").join(", ")}{items.length > 3 && ` +${items.length - 3}`}</span>
                          )}
                        </p>
                        {nextAction && pendingSubState !== "awaiting" && (
                          <p className="text-xs mt-1">
                            <span className="text-muted-foreground">Next: </span>
                            <span className="font-medium text-foreground">{nextAction.label}</span>
                            {nextAction.when && (
                              <span className="text-muted-foreground"> · {nextAction.when}</span>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-medium ${overdue ? "text-destructive" : ""}`}>
                          {formatDeadline(order.deadline)}
                        </p>
                        {overdue ? (
                          <p className="text-xs text-destructive flex items-center gap-1 justify-end">
                            <AlertTriangle className="w-3 h-3" /> overdue
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {daysToDeadline === 0 ? "today" : daysToDeadline === 1 ? "tomorrow" : `in ${daysToDeadline}d`}
                          </p>
                        )}
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
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

  // Data hooks. customerProductPrices + linkedCustomer depend on the
  // live customerId selection so they refetch when the customer changes.
  const customers = useCustomers(false);
  const products = useProductsList(true);
  const locationTotals = useProductLocationTotals();
  const linkedCustomer = useCustomer(customerId);
  const customerProductPrices = useCustomerProductPrices(customerId || undefined);
  const { data: collectionProducts = [] } = useQuery({
    queryKey: ["collection-products", "all-for-new-order"],
    queryFn: async () =>
      assertOk(
        await supabase.from("collectionProducts").select("collectionId, productId, unitPrice"),
      ) as Array<{ collectionId: string; productId: string; unitPrice?: number }>,
  });

  // productId → highest unitPrice across any collection that lists it.
  // Used as the retail fallback in resolveUnitPrice.
  const productRetailPrice = useMemo(() => {
    const map = new Map<string, number>();
    for (const cp of collectionProducts) {
      if (cp.unitPrice == null) continue;
      const prev = map.get(cp.productId);
      if (prev == null || cp.unitPrice > prev) map.set(cp.productId, cp.unitPrice);
    }
    return map;
  }, [collectionProducts]);

  function resolveProductPrice(productId: string) {
    return resolveUnitPrice({
      productId,
      customerId: customerId || undefined,
      customerProductPrices: customerProductPrices.map((p) => ({
        productId: p.productId, unitPrice: p.unitPrice,
      })),
      customerPriceListId: linkedCustomer?.defaultPriceListId,
      priceListEntries: collectionProducts,
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
          fulfilmentMode: line.fulfilmentMode ?? "produce",
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
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
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
      <section className="space-y-2 pt-2 border-t border-border">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={addEmptyLine}
            className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium"
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
          className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save order"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-border px-4 py-2 text-sm">
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
    <div className="rounded-lg border border-border bg-card/50 p-2 space-y-2">
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
            placeholder="Unit price"
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
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:border-border disabled:hover:text-muted-foreground"
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
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="relative w-full max-w-lg rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
        <div className="px-5 pt-5 pb-3 border-b border-border">
          <h3 className="text-base font-bold text-foreground">Not enough in stock</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick what to do for each line. Split keeps the order quantity; Reduce trims it to what's on hand.
          </p>
        </div>
        <ul className="max-h-96 overflow-y-auto px-5 py-3 space-y-3">
          {local.map((l) => (
            <li key={l.key} className="rounded-lg border border-border p-3 space-y-2">
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
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${
                    l.decision === "split"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  Split — {l.available} from stock + produce {l.requested - l.available}
                </button>
                <button
                  type="button"
                  onClick={() => setDecision(l.key, "reduce")}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-xs ${
                    l.decision === "reduce"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-foreground hover:border-primary hover:text-primary"
                  }`}
                >
                  Reduce order to {l.available}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="px-5 py-4 border-t border-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full border border-border px-4 py-2 text-sm"
          >
            Back to edit
          </button>
          <button
            type="button"
            onClick={() => onApply(local)}
            disabled={!allDecided}
            className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
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
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
