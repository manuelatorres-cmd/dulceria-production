"use client";

import { use, useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  useOrder, useOrderItems, useProductsList, saveOrder, deleteOrder,
  saveOrderItem, deleteOrderItem, useCustomers, useCustomer, saveCustomer,
  useVariants, useVariantPackagings, useVariantPackagingProducts,
  useOrderVariantLines, addVariantToOrder, removeVariantFromOrder,
  usePackagingList, useOrderPackagingLines, saveOrderPackagingLine, deleteOrderPackagingLine,
  useProductActiveMinutesMap, useCapacityConfig,
  usePeople, usePersonUnavailability, useBlockedDays,
  useProductLocationTotals,
  useReplenishmentOrderFor,
  useCustomerProductPrices,
  useProductionPlans, useOrderPlanLinks, useAllPlanStepStatuses,
  useAllProductionDayLineItems, useProductionDays, useProductionSteps,
  useAllocatedForOrder, markOrderAsPacked,
  computeReassignmentProposals, reassignBatchLink,
  useOrders,
  type ReassignmentProposal,
} from "@/lib/hooks";
import { batchPhaseProgress } from "@/lib/batch-progress";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { latestPackagingUnitCost } from "@/lib/variantPricing";
import {
  computeOrderLabourHours, computeOrderCalculatedCost, checkOrderFeasibility,
  type OrderProductLine, type OrderPackagingRollupLine, type ProductStockState,
} from "@/lib/orderRollup";
import { computeMissingRequiredCustomerFields } from "@/lib/customerRequiredFields";
import { OrderStepPipeline } from "@/components/order-step-pipeline";
import {
  resolveUnitPrice, effectiveVatRate,
  aggregateVatByRate, computeOrderMargin,
  computeVatFromGross,
  type VatBreakdown,
} from "@/lib/pricing";
import {
  ORDER_CHANNELS, ORDER_CHANNEL_LABELS,
  ORDER_STATUSES, ORDER_STATUS_LABELS,
  DELIVERY_TYPES, DELIVERY_TYPE_LABELS,
  CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS,
  type OrderChannel, type OrderStatus,
  type DeliveryType,
  type Packaging, type OrderPackagingLine,
  type ProductCostSnapshot, type PackagingOrder,
  type OrderItem, type Customer, type CustomerType,
  type ProductionPlan,
  type Order,
} from "@/types";
import {
  IconPlus as Plus, IconTrash as Trash2, IconX as X,
  IconAlertTriangle as AlertTriangle, IconCheck as Check,
  IconPackage as Package, IconUserPlus as UserPlus,
  IconUser as User, IconCopy as Copy, IconSearch as Search,
  IconCalendar as Calendar,
} from "@tabler/icons-react";
import { newId } from "@/lib/supabase";
import {
  DsDetailPage, Section, ListRow, DsButton, DsDialog, DsDrawer,
  DsInlineField, DsInlineTextarea, DsInlineSelect, DsInlineToggle,
  StatusTag, type StatusTagKind,
} from "@/components/dulceria";

/* ─────────────────────────────────────────────────────────────
 * Order detail (Phase B refit)
 * DsDetailPage shell + B.1 metadata + B.2 unified lines grid
 * + B.3 history (✗ deferred) + B.4 related (batches + ✗).
 * ───────────────────────────────────────────────────────────── */

type LineKind = "variant" | "single" | "decoration";
type LineFilter = "all" | "variant" | "single" | "decoration";

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const orderId = decodeURIComponent(idStr);
  const router = useRouter();

  const order = useOrder(orderId);
  const items = useOrderItems(orderId);
  const variantLines = useOrderVariantLines(orderId);
  const allVariants = useVariants();
  const products = useProductsList(true);
  const packaging = usePackagingList(true);
  const replenishmentOrder = useReplenishmentOrderFor(orderId);
  const parentOrder = useOrder(order?.sourceOrderId);
  const linkedCustomer = useCustomer(order?.customerId);
  const packagingLines = useOrderPackagingLines(orderId);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const packagingMap = useMemo(() => new Map(packaging.map((p) => [p.id!, p])), [packaging]);
  const allOrders = useOrders();

  const activeMinutesMap = useProductActiveMinutesMap();
  const allLineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(120);
  const productionSteps = useProductionSteps();
  const capacityConfig = useCapacityConfig();
  const people = usePeople(false);
  const unavailability = usePersonUnavailability();
  const blocked = useBlockedDays();
  const productLocationTotals = useProductLocationTotals();
  const orderPlanLinks = useOrderPlanLinks(orderId);
  const allPlans = useProductionPlans();
  const allPlanStepStatuses = useAllPlanStepStatuses();
  const plansById = useMemo(() => new Map(allPlans.map((p) => [p.id!, p])), [allPlans]);

  // Cost + price hierarchy (preserved from previous implementation).
  const { data: costSnapshots = [] } = useQuery({
    queryKey: ["product-cost-snapshots", "all-for-order-detail"],
    queryFn: async () =>
      assertOk(await supabase.from("productCostSnapshots").select("*")) as ProductCostSnapshot[],
  });
  const { data: packagingOrders = [] } = useQuery({
    queryKey: ["packaging-orders", "all-for-order-detail"],
    queryFn: async () =>
      assertOk(await supabase.from("packagingOrders").select("*")) as PackagingOrder[],
  });
  const { data: variantProducts = [] } = useQuery({
    queryKey: ["variant-products", "all-for-order-detail"],
    queryFn: async () =>
      assertOk(
        await supabase.from("variantProducts").select("variantId, productId, unitPrice"),
      ) as Array<{ variantId: string; productId: string; unitPrice?: number }>,
  });
  const customerProductPrices = useCustomerProductPrices(order?.customerId);

  const productUnitCost = useMemo(() => {
    const latest = new Map<string, ProductCostSnapshot>();
    for (const s of costSnapshots) {
      const existing = latest.get(s.productId);
      if (!existing || new Date(s.recordedAt) > new Date(existing.recordedAt)) {
        latest.set(s.productId, s);
      }
    }
    const map = new Map<string, number>();
    for (const [pid, snap] of latest) map.set(pid, snap.costPerProduct);
    return map;
  }, [costSnapshots]);

  const packagingUnitCost = useMemo(() => {
    const byPackaging = new Map<string, PackagingOrder[]>();
    for (const o of packagingOrders) {
      const arr = byPackaging.get(o.packagingId) ?? [];
      arr.push(o);
      byPackaging.set(o.packagingId, arr);
    }
    const map = new Map<string, number>();
    for (const [pid, orders] of byPackaging) {
      const cost = latestPackagingUnitCost(orders);
      if (cost != null) map.set(pid, cost);
    }
    return map;
  }, [packagingOrders]);

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
      customerId: order?.customerId,
      customerProductPrices: customerProductPrices.map((p) => ({
        productId: p.productId, unitPrice: p.unitPrice,
      })),
      customerPriceListId: linkedCustomer?.defaultPriceListId,
      priceListEntries: variantProducts,
      customerDiscountPercent: linkedCustomer?.defaultDiscountPercent,
      retailPrice: productRetailPrice.get(productId),
    });
  }

  // ── UI state ──────────────────────────────────────────────────
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reassignProposals, setReassignProposals] = useState<ReassignmentProposal[] | null>(null);
  const [reassignBusy, setReassignBusy] = useState<string | null>(null);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [addLineDrawerOpen, setAddLineDrawerOpen] = useState(false);
  const [customerDrawerOpen, setCustomerDrawerOpen] = useState(false);
  const [lineSearch, setLineSearch] = useState("");
  const [lineFilter, setLineFilter] = useState<LineFilter>("all");
  const [removeLineTarget, setRemoveLineTarget] = useState<
    | { kind: LineKind; id: string; name: string }
    | null
  >(null);
  const [showAllHistory, setShowAllHistory] = useState(false);

  if (order === undefined) {
    return <div className="ds p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (order === null) {
    return <div className="ds p-6 text-sm text-muted-foreground">Order not found.</div>;
  }

  // ── Derived data ──────────────────────────────────────────────
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const deadlineDate = new Date(order.deadline);

  const linksByItemId = new Map<string, typeof orderPlanLinks>();
  for (const lk of orderPlanLinks) {
    const arr = linksByItemId.get(lk.orderItemId) ?? [];
    arr.push(lk);
    linksByItemId.set(lk.orderItemId, arr);
  }

  // Labour + cost rollup.
  const orderProductLines: OrderProductLine[] = items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    activeMinutesPerUnit: activeMinutesMap.get(i.productId) ?? 0,
    unitCost: productUnitCost.get(i.productId) ?? 0,
    isBorrow: i.fulfilmentMode === "borrow",
  }));
  const orderPackagingRollupLines: OrderPackagingRollupLine[] = packagingLines.map((l) => ({
    packagingId: l.packagingId,
    quantity: l.quantity,
    packingMinutesPerUnit: packagingMap.get(l.packagingId)?.packingTimePerUnit ?? 0,
    unitCost: packagingUnitCost.get(l.packagingId) ?? 0,
  }));
  const labourRollup = computeOrderLabourHours(orderProductLines, orderPackagingRollupLines);
  const calculatedCost = computeOrderCalculatedCost(
    orderProductLines,
    orderPackagingRollupLines,
    labourRollup,
    capacityConfig?.labourHourlyRate ?? 0,
  );

  // Feasibility.
  const activePeople = people.filter((p) => !p.archived);
  const dailyCapacityHours = activePeople.reduce((s, p) => s + (p.defaultHoursPerDay ?? 0), 0);
  const blockedDates = new Set<string>();
  for (const b of blocked) {
    const start = new Date(b.startDate);
    const end = new Date(b.endDate);
    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
      blockedDates.add(d.toISOString().slice(0, 10));
    }
  }
  const nowRef = new Date();
  nowRef.setHours(0, 0, 0, 0);
  let workingDays = 0;
  {
    const cursor = new Date(nowRef);
    while (cursor.getTime() < deadlineDate.getTime()) {
      const iso = cursor.toISOString().slice(0, 10);
      if (!blockedDates.has(iso)) workingDays += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  const unavailabilityAdj = unavailability.filter((u) => {
    const from = new Date(u.startDate).getTime();
    const to = new Date(u.endDate).getTime();
    return to >= nowRef.getTime() && from <= deadlineDate.getTime();
  }).length;
  const dayDateById = new Map(productionDays.map((d) => [d.id!, d.date]));
  const thisOrdersPlanIds = new Set(
    orderPlanLinks.map((l) => l.planId).filter(Boolean) as string[],
  );
  const fromIsoWin = nowRef.toISOString().slice(0, 10);
  const toIsoWin = deadlineDate.toISOString().slice(0, 10);
  const committedMinutes = allLineItems
    .map((li) => ({
      date: dayDateById.get(li.productionDayId),
      minutes: li.plannedMinutes,
      planId: li.planId,
    }))
    .filter((x) => x.date && x.date >= fromIsoWin && x.date <= toIsoWin)
    .filter((x) => !thisOrdersPlanIds.has(x.planId))
    .reduce((acc, x) => acc + x.minutes, 0);

  const stockState: ProductStockState[] = items.map((i) => {
    const totals = productLocationTotals.get(i.productId);
    const availablePieces = totals ? (totals.production ?? 0) + (totals.store ?? 0) : 0;
    const perUnitMin = activeMinutesMap.get(i.productId) ?? 0;
    const capacityMinutes = dailyCapacityHours * 60 * Math.max(0, workingDays - unavailabilityAdj);
    const producibleBeforeDeadlinePieces = perUnitMin > 0
      ? Math.floor(Math.max(0, capacityMinutes - committedMinutes) / perUnitMin)
      : Number.POSITIVE_INFINITY;
    return { productId: i.productId, availablePieces, producibleBeforeDeadlinePieces };
  });

  const feasibility = checkOrderFeasibility({
    productLines: orderProductLines,
    stock: stockState,
    totalLabourHours: labourRollup.totalHours,
    dailyCapacityHours: Math.max(0, dailyCapacityHours),
    workingDaysToDeadline: Math.max(0, workingDays - unavailabilityAdj),
    committedHoursToDeadline: committedMinutes / 60,
  });

  // Customer-facing totals (net + VAT).
  const productLineTotals = items.map((i) => {
    const p = productMap.get(i.productId);
    const resolved = resolveProductPrice(i.productId);
    const unitPrice = i.unitPrice ?? resolved.unitPrice ?? 0;
    const rate = effectiveVatRate(i.vatRate, p?.defaultVatRate);
    return { net: unitPrice * i.quantity, rate };
  });
  const packagingLineTotals = packagingLines.map((l) => {
    const p = packagingMap.get(l.packagingId);
    const unitPrice = l.unitPrice ?? packagingUnitCost.get(l.packagingId) ?? 0;
    const rate = effectiveVatRate(l.vatRate, p?.defaultVatRate);
    return { net: unitPrice * l.quantity, rate };
  });
  const productsSubtotalNet = productLineTotals.reduce((s, l) => s + l.net, 0);
  const packagingSubtotalNet = packagingLineTotals.reduce((s, l) => s + l.net, 0);
  const variantLineTotals = variantLines.map((vl) => {
    const rate = effectiveVatRate(undefined, undefined);
    const gross = vl.unitPrice * vl.quantity;
    const net = gross / (1 + rate / 100);
    return { net, rate };
  });
  const variantsSubtotalNet = variantLineTotals.reduce((s, l) => s + l.net, 0);
  const totalNet = productsSubtotalNet + packagingSubtotalNet + variantsSubtotalNet;
  const vatBreakdown = aggregateVatByRate([...productLineTotals, ...packagingLineTotals, ...variantLineTotals]);
  const totalVat = vatBreakdown.reduce((s, b) => s + b.vat, 0);
  const totalGross = Math.round((totalNet + totalVat) * 100) / 100;
  const marginResult = computeOrderMargin(totalNet, calculatedCost.totalCost);

  // Prev/next nav by createdAt desc.
  const sortedOrders = useMemo(() => {
    return [...allOrders].sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });
  }, [allOrders]);
  const orderIndex = sortedOrders.findIndex((o) => o.id === orderId);
  const prevOrder = orderIndex > 0 ? sortedOrders[orderIndex - 1] : null;
  const nextOrder = orderIndex >= 0 && orderIndex < sortedOrders.length - 1
    ? sortedOrders[orderIndex + 1]
    : null;
  function labelFor(o: Order) {
    return o.customerName || o.eventName || o.sourceRef || o.id?.slice(0, 6) || "—";
  }

  // Status badge mapping.
  const statusKind: StatusTagKind = (() => {
    switch (order.status) {
      case "pending": return "pending";
      case "in_production": return "scheduled";
      case "done": return "done";
      case "cancelled": return "neutral";
      default: return "neutral";
    }
  })();

  // ── Handlers ──────────────────────────────────────────────────
  async function patchOrder(patch: Partial<Order>) {
    if (!order) return;
    await saveOrder({ ...order, ...patch });
  }

  async function handleDelete() {
    try {
      const proposals = await computeReassignmentProposals(orderId);
      if (proposals.length > 0) {
        setReassignProposals(proposals);
        setDeleteOpen(false);
        return;
      }
    } catch (err) {
      console.warn("Reassignment lookup failed, proceeding with plain delete:", err);
    }
    await performDelete();
  }

  async function performDelete() {
    try {
      await deleteOrder(orderId);
      router.replace("/orders");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Delete failed: ${msg}`);
    }
  }

  async function handleCancel() {
    await patchOrder({ status: "cancelled" });
    setCancelOpen(false);
  }

  async function handleReassign(proposal: ReassignmentProposal, targetOrderItemId: string) {
    setReassignBusy(proposal.orderPlanLinkId);
    try {
      await reassignBatchLink(proposal.orderPlanLinkId, targetOrderItemId);
      const next = await computeReassignmentProposals(orderId);
      setReassignProposals(next);
    } catch (err) {
      alert(`Reassign failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setReassignBusy(null);
    }
  }

  async function performRemoveLine() {
    if (!removeLineTarget) return;
    try {
      if (removeLineTarget.kind === "single") await deleteOrderItem(removeLineTarget.id);
      else if (removeLineTarget.kind === "variant") await removeVariantFromOrder(removeLineTarget.id);
      else if (removeLineTarget.kind === "decoration") await deleteOrderPackagingLine(removeLineTarget.id);
    } catch (err) {
      alert(`Remove failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRemoveLineTarget(null);
    }
  }

  // ── B.3 History — schema-deferred ──────────────────────────────
  // No `orderEvent` / audit-log table exists yet. We synthesize what
  // we have: created (from createdAt), confirmed/in-production/done
  // (status transitions can't be replayed without history rows —
  // surface only the current status), and a single linked-batch
  // creation event per batch link (from plan.createdAt).
  type HistoryEvent = {
    id: string;
    time: Date;
    eventType: "created" | "status" | "batch-linked" | "note";
    actor: string;
    detail: string;
  };
  const history: HistoryEvent[] = [];
  if (order.createdAt) {
    history.push({
      id: `created-${order.id}`,
      time: new Date(order.createdAt),
      eventType: "created",
      actor: "system",
      detail: "Order created",
    });
  }
  for (const lk of orderPlanLinks) {
    const plan = plansById.get(lk.planId);
    if (!plan?.createdAt) continue;
    history.push({
      id: `link-${lk.id ?? lk.planId}`,
      time: new Date(plan.createdAt),
      eventType: "batch-linked",
      actor: "system",
      detail: `Linked batch ${plan.batchNumber ?? plan.name ?? "—"} (${lk.allocatedQuantity} pcs)`,
    });
  }
  history.sort((a, b) => b.time.getTime() - a.time.getTime());
  const visibleHistory = showAllHistory ? history : history.slice(0, 10);

  // ── Header title + meta ───────────────────────────────────────
  const headerTitle = order.customerName || order.eventName || "(unnamed)";
  const headerMeta = `Order #${order.sourceRef ?? order.id?.slice(0, 8) ?? "—"} · ${totalQty} pc · €${totalGross.toFixed(2)}`;

  return (
    <DsDetailPage
      title={headerTitle}
      meta={headerMeta}
      breadcrumb={{ label: "All orders", href: "/orders" }}
      statusBadge={<StatusTag kind={statusKind}>{ORDER_STATUS_LABELS[order.status]}</StatusTag>}
      navAdjacent={{
        prev: prevOrder?.id ? { id: prevOrder.id, label: labelFor(prevOrder), href: `/orders/${encodeURIComponent(prevOrder.id)}` } : undefined,
        next: nextOrder?.id ? { id: nextOrder.id, label: labelFor(nextOrder), href: `/orders/${encodeURIComponent(nextOrder.id)}` } : undefined,
      }}
      actions={
        <div style={{ display: "inline-flex", gap: 8 }}>
          <DsButton size="sm" onClick={() => setReplaceOpen(true)} title="Replace + credit">
            <Copy size={12} style={{ marginRight: 4 }} /> Duplicate
          </DsButton>
          {order.status !== "cancelled" && (
            <DsButton size="sm" onClick={() => setCancelOpen(true)} title="Cancel order (sets status)">
              Cancel
            </DsButton>
          )}
          <DsButton
            size="sm"
            onClick={() => setDeleteOpen(true)}
            style={{ color: "var(--ds-tier-urgent)" }}
          >
            <Trash2 size={12} style={{ marginRight: 4 }} /> Delete
          </DsButton>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Customer-preferences banner. */}
        {linkedCustomer && (
          linkedCustomer.allergenNotes
          || linkedCustomer.packagingPrefs
          || linkedCustomer.language
          || linkedCustomer.paymentTerms
        ) && (
          <div
            style={{
              borderRadius: 8,
              border: "0.5px solid var(--ds-border-warm)",
              background: "var(--ds-card-bg-hover)",
              padding: "10px 14px",
              fontSize: 12,
              color: "var(--ds-text-primary)",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--ds-text-muted)", fontWeight: 500 }}>
              <User size={13} /> Customer preferences
            </div>
            {linkedCustomer.allergenNotes && (
              <p><span style={{ color: "var(--ds-text-muted)" }}>Allergens:</span> {linkedCustomer.allergenNotes}</p>
            )}
            {linkedCustomer.packagingPrefs && (
              <p><span style={{ color: "var(--ds-text-muted)" }}>Packaging:</span> {linkedCustomer.packagingPrefs}</p>
            )}
            {(linkedCustomer.language || linkedCustomer.paymentTerms) && (
              <p style={{ color: "var(--ds-text-muted)" }}>
                {linkedCustomer.language && <>Lang: <span style={{ color: "var(--ds-text-primary)", textTransform: "uppercase" }}>{linkedCustomer.language}</span> </>}
                {linkedCustomer.paymentTerms && <>Payment: <span style={{ color: "var(--ds-text-primary)" }}>{linkedCustomer.paymentTerms}</span></>}
              </p>
            )}
          </div>
        )}

        {/* Replenishment / borrow linkage banners. */}
        {parentOrder && (
          <Link
            href={`/orders/${encodeURIComponent(parentOrder.id!)}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "0.5px solid var(--ds-tier-quarter-focus)",
              background: "var(--ds-tint-info)",
              padding: "8px 12px",
              fontSize: 13,
              borderRadius: 6,
              textDecoration: "none",
              color: "var(--ds-text-primary)",
            }}
          >
            <Package size={14} />
            <span style={{ flex: 1 }}>
              <b>Shop Replenishment</b> for order {parentOrder.customerName || parentOrder.id?.slice(0, 8)}
            </span>
            <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>View parent →</span>
          </Link>
        )}
        {replenishmentOrder && (
          <Link
            href={`/orders/${encodeURIComponent(replenishmentOrder.id!)}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: "0.5px solid var(--ds-tier-positive)",
              background: "rgba(93,202,165,0.08)",
              padding: "8px 12px",
              fontSize: 13,
              borderRadius: 6,
              textDecoration: "none",
              color: "var(--ds-text-primary)",
            }}
          >
            <Package size={14} />
            <span style={{ flex: 1 }}>
              Linked replenishment (deadline{" "}
              {new Date(replenishmentOrder.deadline).toLocaleDateString("de-AT", { day: "numeric", month: "short" })})
              {" · "}{replenishmentOrder.status}
            </span>
            <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>View →</span>
          </Link>
        )}

        {/* Production pipeline + quick links. */}
        <OrderStepPipeline orderId={orderId} needByDate={order.deadline} />
        {orderPlanLinks.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Link
              href={`/orders/${encodeURIComponent(orderId)}/production`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 6,
                background: "var(--ds-tier-quarter-focus)",
                color: "#fff",
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              <Calendar size={14} /> Production schedule →
            </Link>
            <Link
              href={`/plan?focus=order:${encodeURIComponent(orderId)}`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                borderRadius: 6,
                background: "var(--accent-mint-bg)",
                color: "var(--accent-mint-ink)",
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                textDecoration: "none",
              }}
            >
              Plan this →
            </Link>
          </div>
        )}

        {/* ───── B.1 Metadata section (two-column inline edit) ───── */}
        <Section title="Order details">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 20,
              padding: "12px 20px",
            }}
          >
            {/* Left column. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="text-ds-label">Customer</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => setCustomerDrawerOpen(true)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: "0.5px solid var(--ds-border-warm)",
                      background: "var(--ds-card-bg)",
                      fontSize: 13,
                      color: order.customerId
                        ? "var(--ds-text-primary)"
                        : "var(--ds-text-muted)",
                      cursor: "pointer",
                    }}
                    className="hover:bg-[color:var(--ds-card-bg-hover)]"
                  >
                    {order.customerName || order.eventName || "— pick customer —"}
                  </button>
                  {linkedCustomer && computeMissingRequiredCustomerFields(linkedCustomer).length > 0 && (
                    <span
                      title={`Missing: ${computeMissingRequiredCustomerFields(linkedCustomer).join(", ")}`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 16, height: 16,
                        borderRadius: 999,
                        background: "var(--ds-semantic-warn)",
                        color: "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                      }}
                    >
                      {computeMissingRequiredCustomerFields(linkedCustomer).length}
                    </span>
                  )}
                  {order.customerId && (
                    <Link
                      href={`/customers/${encodeURIComponent(order.customerId)}`}
                      style={{ fontSize: 11, color: "var(--ds-tier-quarter-focus)" }}
                      className="hover:underline"
                    >
                      Profile →
                    </Link>
                  )}
                </div>
              </div>

              {/* "Order date" — schema has no editable orderDate column; surface createdAt read-only. */}
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span className="text-ds-label" title="Schema has no orderDate column — showing createdAt">
                  Order date <span style={{ opacity: 0.55 }}>✗</span>
                </span>
                <span style={{ fontSize: 13, color: "var(--ds-text-muted)" }}>
                  {order.createdAt
                    ? new Date(order.createdAt).toLocaleDateString("de-AT", { day: "numeric", month: "short", year: "numeric" })
                    : "—"}
                </span>
              </div>

              <DsInlineField
                label="Due date (deadline)"
                value={toLocalDate(order.deadline)}
                type="date"
                onSave={async (next) => {
                  if (!next) return;
                  // Preserve time-of-day from existing deadline.
                  const cur = new Date(order.deadline);
                  const [y, m, d] = next.split("-").map(Number);
                  cur.setFullYear(y, m - 1, d);
                  await patchOrder({ deadline: cur.toISOString() });
                }}
              />

              <DsInlineSelect<OrderChannel>
                label="Channel"
                value={order.channel}
                options={ORDER_CHANNELS.map((c) => ({ value: c, label: ORDER_CHANNEL_LABELS[c] }))}
                onSave={async (v) => patchOrder({ channel: v })}
              />

              <DsInlineSelect<OrderStatus>
                label="Status"
                value={order.status}
                options={ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }))}
                onSave={async (v) => patchOrder({ status: v })}
              />

              <DsInlineTextarea
                label="Notes"
                value={order.notes ?? ""}
                rows={2}
                onSave={async (v) => patchOrder({ notes: v.trim() || undefined })}
              />
            </div>

            {/* Right column. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <DsInlineField
                label="PO / invoice ref"
                value={order.invoiceExternalRef ?? ""}
                onSave={async (v) => patchOrder({ invoiceExternalRef: v.trim() || undefined })}
                placeholder="—"
              />

              <DsInlineTextarea
                label="Shipping address"
                value={order.deliveryAddress ?? ""}
                rows={2}
                onSave={async (v) => patchOrder({ deliveryAddress: v.trim() || undefined })}
              />

              <DsInlineSelect<DeliveryType | "">
                label="Delivery method"
                value={order.deliveryType ?? ""}
                options={[
                  { value: "" as DeliveryType | "", label: "— none —" },
                  ...DELIVERY_TYPES.map((t) => ({ value: t as DeliveryType | "", label: DELIVERY_TYPE_LABELS[t] })),
                ]}
                onSave={async (v) => patchOrder({ deliveryType: v === "" ? undefined : (v as DeliveryType) })}
              />

              <DsInlineField
                label="Requested delivery / pickup"
                value={order.deliveryAt ? toLocalDate(order.deliveryAt) : ""}
                type="date"
                onSave={async (next) => {
                  if (!next) return patchOrder({ deliveryAt: undefined });
                  const [y, m, d] = next.split("-").map(Number);
                  const cur = order.deliveryAt ? new Date(order.deliveryAt) : new Date();
                  cur.setFullYear(y, m - 1, d);
                  await patchOrder({ deliveryAt: cur.toISOString() });
                }}
              />

              {/* Gift wrap toggle — schema has no giftWrap column; deferred. */}
              <DsInlineToggle
                label="Gift wrap ✗"
                checked={false}
                onChange={async () => {
                  alert("Gift wrap toggle deferred — schema has no giftWrap column on Order.");
                }}
                description="Deferred — add giftWrap column on Order to enable."
                disabled
              />

              <DsInlineTextarea
                label="Customer / delivery note"
                value={order.deliveryNotes ?? ""}
                rows={2}
                onSave={async (v) => patchOrder({ deliveryNotes: v.trim() || undefined })}
              />
            </div>
          </div>
        </Section>

        {/* ───── B.2 Unified lines grid ───── */}
        <OrderLinesGrid
          items={items}
          variantLines={variantLines}
          packagingLines={packagingLines}
          productMap={productMap}
          packagingMap={packagingMap}
          variantsMap={new Map(allVariants.map((v) => [v.id!, v]))}
          resolveProductPrice={resolveProductPrice}
          packagingUnitCost={packagingUnitCost}
          search={lineSearch}
          onSearch={setLineSearch}
          filter={lineFilter}
          onFilter={setLineFilter}
          onAddLine={() => setAddLineDrawerOpen(true)}
          onRemove={(target) => setRemoveLineTarget(target)}
          productsSubtotalNet={productsSubtotalNet}
          packagingSubtotalNet={packagingSubtotalNet}
          variantsSubtotalNet={variantsSubtotalNet}
          totalNet={totalNet}
          totalVat={totalVat}
          totalGross={totalGross}
          vatBreakdown={vatBreakdown}
        />

        {/* Pricing / cost rollup + feasibility (preserved). */}
        <OrderSummaryCard
          order={order}
          labour={labourRollup}
          calculatedCost={calculatedCost}
          feasibility={feasibility}
          labourHourlyRate={capacityConfig?.labourHourlyRate ?? null}
          productNameById={productMap}
          totalNet={totalNet}
          totalGross={totalGross}
          vatBreakdown={vatBreakdown}
          margin={marginResult}
        />

        {/* Ready-to-pack section for borrow lines (preserved). */}
        <OrderReadyToPackSection orderId={orderId} />

        {/* ───── B.3 History ───── */}
        <Section
          title="History"
          action={
            history.length > 10 && (
              <button
                type="button"
                onClick={() => setShowAllHistory((v) => !v)}
                className="text-ds-meta hover:underline"
                style={{ background: "transparent", border: 0, cursor: "pointer" }}
              >
                {showAllHistory ? "Show last 10" : `Show all (${history.length})`}
              </button>
            )
          }
        >
          {history.length === 0 ? (
            <p style={{ padding: "8px 20px", fontStyle: "italic", color: "var(--ds-text-muted)", fontSize: 13 }}>
              No history events recorded yet.
            </p>
          ) : (
            visibleHistory.map((e) => (
              <ListRow
                key={e.id}
                tier="default"
                title={
                  <>
                    <span style={{ marginRight: 8 }}>{e.detail}</span>
                    <HistoryChip kind={e.eventType} />
                  </>
                }
                meta={<span style={{ color: "var(--ds-text-muted)", fontStyle: "italic" }}>{e.actor}</span>}
                side={<HistoryTime time={e.time} />}
              />
            ))
          )}
          <div style={{ padding: "8px 20px", borderTop: "0.5px solid var(--ds-border-warm)", color: "var(--ds-text-muted)", fontSize: 11, fontStyle: "italic" }}>
            Note: full audit log (Confirmed / Edited / Status-changed / Note-added events) deferred — schema has no orderEvent table. Currently surfacing order creation + batch-link creation only. ✗
          </div>
        </Section>

        {/* ───── B.4 Related ───── */}
        <Section title="Related">
          <div style={{ padding: "12px 20px" }}>
            <p className="text-ds-label" style={{ marginBottom: 6 }}>Production batches</p>
            {orderPlanLinks.length === 0 ? (
              <p style={{ fontStyle: "italic", color: "var(--ds-text-muted)", fontSize: 12 }}>
                No batches linked yet. Visit /plan and regenerate.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", marginLeft: -20, marginRight: -20 }}>
                {orderPlanLinks.map((lk) => {
                  const plan = plansById.get(lk.planId);
                  const progress = plan ? batchPhaseProgress(plan.id!, allPlanStepStatuses) : null;
                  const status = plan?.status ?? "draft";
                  return (
                    <ListRow
                      key={lk.id ?? lk.planId}
                      tier="default"
                      onClick={() =>
                        plan?.id && router.push(`/production/${encodeURIComponent(plan.id)}?from=orders&fromId=${encodeURIComponent(orderId)}`)
                      }
                      title={plan?.batchNumber || plan?.name || "(batch missing)"}
                      meta={
                        <>
                          <span style={{ marginRight: 8 }}>{lk.allocatedQuantity} pcs allocated</span>
                          {progress && (
                            <span style={{ color: "var(--ds-text-muted)" }}>
                              · Step {progress.index}/{progress.total} {progress.label}
                            </span>
                          )}
                        </>
                      }
                      side={
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 7px",
                            borderRadius: 999,
                            background: PLAN_STATUS_BG[status],
                            color: PLAN_STATUS_INK[status],
                            border: `0.5px solid ${PLAN_STATUS_INK[status]}`,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                          }}
                        >
                          {PLAN_STATUS_LABEL[status]}
                        </span>
                      }
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div style={{ padding: "12px 20px", borderTop: "0.5px solid var(--ds-border-warm)" }}>
            <p className="text-ds-label" style={{ marginBottom: 6 }}>
              Invoices <span style={{ opacity: 0.55 }}>✗</span>
            </p>
            <p style={{ fontStyle: "italic", color: "var(--ds-text-muted)", fontSize: 12 }}>
              Linked invoices deferred — no `invoices` table; external refs live on the order itself:
              {" "}
              {order.invoiceExternalRef
                ? <span style={{ color: "var(--ds-text-primary)", fontStyle: "normal" }}>{order.invoiceExternalRef}</span>
                : "(none set)"}
              {order.creditReference && (
                <> · credit ref <span style={{ color: "var(--ds-text-primary)", fontStyle: "normal" }}>{order.creditReference}</span></>
              )}
            </p>
          </div>

          <div style={{ padding: "12px 20px", borderTop: "0.5px solid var(--ds-border-warm)" }}>
            <p className="text-ds-label" style={{ marginBottom: 6 }}>
              Picking jobs <span style={{ opacity: 0.55 }}>✗</span>
            </p>
            <p style={{ fontStyle: "italic", color: "var(--ds-text-muted)", fontSize: 12 }}>
              Linked picking jobs deferred — no `pickingJob` table. Borrow lines surface in &quot;Ready to pack&quot; above.
            </p>
          </div>
        </Section>
      </div>

      {/* Modals + drawers. */}
      <DsDialog
        open={deleteOpen}
        tone="destructive"
        title="Delete this order?"
        description="All line items will be removed. If any batches have shelling-or-later progress, you'll be offered the option to reassign first."
        confirmLabel="Delete"
        onConfirm={async () => { setDeleteOpen(false); await handleDelete(); }}
        onCancel={() => setDeleteOpen(false)}
      />

      <DsDialog
        open={cancelOpen}
        title="Cancel this order?"
        description="Status will be set to cancelled. Order stays in the database; batches keep their state. You can switch the status back from the Order details section."
        confirmLabel="Set cancelled"
        onConfirm={handleCancel}
        onCancel={() => setCancelOpen(false)}
      />

      <DsDialog
        open={!!removeLineTarget}
        tone="destructive"
        title="Remove this line?"
        description={removeLineTarget ? `${removeLineTarget.name} — this also drains any allocation tied to the line.` : ""}
        confirmLabel="Remove"
        onConfirm={performRemoveLine}
        onCancel={() => setRemoveLineTarget(null)}
      />

      <DsDrawer
        open={customerDrawerOpen}
        onClose={() => setCustomerDrawerOpen(false)}
        title="Change customer"
        width={460}
      >
        <CustomerPickerDrawerBody
          order={order}
          onPicked={async (c) => {
            await patchOrder({
              customerId: c.id,
              customerName: c.companyName,
            });
            setCustomerDrawerOpen(false);
          }}
        />
      </DsDrawer>

      <DsDrawer
        open={addLineDrawerOpen}
        onClose={() => setAddLineDrawerOpen(false)}
        title="Add line"
        width={560}
      >
        <AddLineDrawerBody
          orderId={orderId}
          products={products}
          packaging={packaging.filter((p) => !p.archived)}
          packagingUnitCost={packagingUnitCost}
          allVariants={allVariants}
          resolveProductPrice={resolveProductPrice}
          nextSortOrderProducts={items.length}
          nextSortOrderPackaging={packagingLines.length}
          availableFor={(id) => {
            const t = productLocationTotals.get(id);
            return t ? Math.max(0, (t.store ?? 0) + (t.production ?? 0)) : 0;
          }}
          onDone={() => setAddLineDrawerOpen(false)}
        />
      </DsDrawer>

      {replaceOpen && order && (
        <ReplaceAndCreditModal
          order={order}
          items={items}
          packagingLines={packagingLines}
          onClose={() => setReplaceOpen(false)}
          onDone={(newOrderId) => {
            setReplaceOpen(false);
            router.push(`/orders/${newOrderId}`);
          }}
        />
      )}

      {reassignProposals && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setReassignProposals(null)} />
          <div className="relative w-full max-w-lg rounded border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-xl overflow-hidden">
            <div className="px-5 pt-5 pb-3 border-b border-[color:var(--ds-border-warm)] bg-[color:var(--ds-tint-warn)]">
              <h3 className="text-base font-bold text-[color:var(--ds-semantic-warn)] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> In-flight work — reassign or discard?
              </h3>
              <p className="text-xs text-[color:var(--ds-semantic-warn)]/80 mt-1">
                One or more batches have production progress. Reassign them to another open order with the same product, or Delete anyway to discard sunk work.
              </p>
            </div>
            <ul className="px-5 py-3 space-y-3 max-h-80 overflow-y-auto">
              {reassignProposals.map((p) => (
                <li key={p.orderPlanLinkId} className="rounded border border-[color:var(--ds-border-warm)] p-3 space-y-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">{p.productName}</p>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {p.allocatedQuantity} pcs · batch {p.batchNumber ?? p.planName}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Progress reached <span className="font-medium">{p.progressStepKey.split("-")[0]}</span>.
                  </p>
                  {p.candidates.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground italic">No open orders for this product.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {p.candidates.slice(0, 6).map((c) => (
                        <button
                          key={c.orderItemId}
                          onClick={() => handleReassign(p, c.orderItemId)}
                          disabled={reassignBusy === p.orderPlanLinkId}
                          className="inline-flex items-center gap-1 rounded border border-[color:var(--ds-tier-quarter-focus)] bg-[color:var(--ds-tint-info)] text-primary px-2 py-0.5 text-[11px] font-medium disabled:opacity-50"
                          title={`Needs ${c.itemRemainingDemand} pcs · deadline ${c.deadline.slice(0, 10)}`}
                        >
                          → {c.orderLabel} · {c.itemRemainingDemand} pcs
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="px-5 py-3 border-t border-[color:var(--ds-border-warm)] flex justify-end gap-2 bg-muted/20">
              <button onClick={() => setReassignProposals(null)} className="rounded border border-[color:var(--ds-border-warm)] px-4 py-2 text-sm">Keep order</button>
              <button
                onClick={async () => { setReassignProposals(null); await performDelete(); }}
                className="rounded bg-destructive text-destructive-foreground px-4 py-2 text-sm font-medium"
              >
                Delete anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </DsDetailPage>
  );
}

// ────────────────────────────────────────────────────────────────
// B.2 — Unified lines grid
// ────────────────────────────────────────────────────────────────

interface LinesGridProps {
  items: OrderItem[];
  variantLines: import("@/types").OrderVariantLine[];
  packagingLines: OrderPackagingLine[];
  productMap: Map<string, { id?: string; name: string; defaultVatRate?: number }>;
  packagingMap: Map<string, Packaging>;
  variantsMap: Map<string, ReturnType<typeof useVariants>[number]>;
  resolveProductPrice: (id: string) => ReturnType<typeof resolveUnitPrice>;
  packagingUnitCost: Map<string, number>;
  search: string;
  onSearch: (q: string) => void;
  filter: LineFilter;
  onFilter: (f: LineFilter) => void;
  onAddLine: () => void;
  onRemove: (target: { kind: LineKind; id: string; name: string }) => void;
  productsSubtotalNet: number;
  packagingSubtotalNet: number;
  variantsSubtotalNet: number;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  vatBreakdown: VatBreakdown[];
}

function OrderLinesGrid(props: LinesGridProps) {
  const {
    items, variantLines, packagingLines,
    productMap, packagingMap, variantsMap,
    resolveProductPrice, packagingUnitCost,
    search, onSearch, filter, onFilter,
    onAddLine, onRemove,
    productsSubtotalNet, packagingSubtotalNet, variantsSubtotalNet,
    totalNet, totalVat, totalGross, vatBreakdown,
  } = props;

  // Build unified rows.
  type GridRow =
    | {
        key: string;
        kind: "single";
        line: OrderItem;
        name: string;
        notes?: string;
        priceSource: string;
        unitPrice: number | null;
        vatRate: number;
        subtotal: number;
      }
    | {
        key: string;
        kind: "variant";
        line: import("@/types").OrderVariantLine;
        name: string;
        notes?: string;
        priceSource: string;
        unitPrice: number | null;
        vatRate: number;
        subtotal: number;
      }
    | {
        key: string;
        kind: "decoration";
        line: OrderPackagingLine;
        name: string;
        notes?: string;
        priceSource: string;
        unitPrice: number | null;
        vatRate: number;
        subtotal: number;
      };

  const rows: GridRow[] = [];
  for (const v of variantLines) {
    const variant = variantsMap.get(v.variantId);
    rows.push({
      key: `v-${v.id}`,
      kind: "variant",
      line: v,
      name: variant?.name ?? "Variant",
      notes: v.notes ?? undefined,
      priceSource: "variant price",
      unitPrice: v.unitPrice,
      vatRate: effectiveVatRate(undefined, undefined),
      subtotal: Math.round(v.quantity * v.unitPrice * 100) / 100,
    });
  }
  for (const i of items) {
    const product = productMap.get(i.productId);
    const resolved = resolveProductPrice(i.productId);
    const unitPrice = i.unitPrice ?? resolved.unitPrice ?? null;
    const rate = effectiveVatRate(i.vatRate, product?.defaultVatRate);
    rows.push({
      key: `s-${i.id}`,
      kind: "single",
      line: i,
      name: product?.name ?? i.productId,
      notes: i.notes ?? undefined,
      priceSource: priceSourceLabel(i.unitPrice, resolved.source),
      unitPrice,
      vatRate: rate,
      subtotal: unitPrice != null ? Math.round(unitPrice * i.quantity * 100) / 100 : 0,
    });
  }
  for (const l of packagingLines) {
    const p = packagingMap.get(l.packagingId);
    const cost = packagingUnitCost.get(l.packagingId);
    const unitPrice = l.unitPrice ?? cost ?? null;
    const rate = effectiveVatRate(l.vatRate, p?.defaultVatRate);
    rows.push({
      key: `d-${l.id}`,
      kind: "decoration",
      line: l,
      name: p?.name ?? l.packagingId,
      notes: l.notes ?? undefined,
      priceSource: l.unitPrice != null ? "per-line override" : "latest purchase cost",
      unitPrice,
      vatRate: rate,
      subtotal: unitPrice != null ? Math.round(unitPrice * l.quantity * 100) / 100 : 0,
    });
  }

  const q = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (filter !== "all" && r.kind !== filter) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || (r.notes ?? "").toLowerCase().includes(q);
  });

  // VAT line(s) for footer.
  const vatRows = vatBreakdown.length === 0
    ? [{ rate: 10, vat: 0, net: 0 }]
    : vatBreakdown;

  return (
    <Section
      title={`Lines (${rows.length})`}
      action={
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <DsButton variant="primary" size="sm" onClick={onAddLine}>
            <Plus size={12} style={{ marginRight: 4 }} /> Add line
          </DsButton>
        </div>
      }
      noBody
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 20px",
          borderBottom: "0.5px solid var(--ds-border-warm)",
          flexWrap: "wrap",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            border: "0.5px solid var(--ds-border-warm)",
            background: "var(--ds-card-bg)",
            borderRadius: 4,
            padding: "4px 8px",
            flex: "0 1 280px",
          }}
        >
          <Search size={13} style={{ color: "var(--ds-text-muted)" }} />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search lines…"
            style={{
              flex: 1, minWidth: 0,
              border: "none", outline: "none", background: "transparent",
              fontSize: 13, color: "var(--ds-text-primary)",
            }}
          />
        </div>
        <div style={{ display: "inline-flex", gap: 4 }}>
          {(["all", "variant", "single", "decoration"] as LineFilter[]).map((f) => {
            const on = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => onFilter(f)}
                style={{
                  fontSize: 11,
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: on ? `0.5px solid var(--ds-tier-quarter-focus)` : `0.5px solid var(--ds-border-warm)`,
                  background: on ? "var(--ds-tier-quarter-focus)" : "var(--ds-card-bg)",
                  color: on ? "#fff" : "var(--ds-text-muted)",
                  cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >
                {f === "all" ? "All" : f === "variant" ? "Variants" : f === "single" ? "Singles" : "Decoration"}
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <p style={{ padding: "16px 20px", fontStyle: "italic", color: "var(--ds-text-muted)", fontSize: 13 }}>
          {rows.length === 0 ? "No lines yet — click \"Add line\" to begin." : "No lines match search / filter."}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "separate",
              borderSpacing: 0,
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  position: "sticky",
                  top: 0,
                  background: "var(--ds-card-bg-hover)",
                  zIndex: 1,
                }}
              >
                <Th>Product / Variant</Th>
                <Th align="right">Qty</Th>
                <Th align="right">Unit price</Th>
                <Th align="right" title="No discountPercent column on OrderItem — deferred">
                  Disc. % <span style={{ opacity: 0.55 }}>✗</span>
                </Th>
                <Th align="right">VAT %</Th>
                <Th align="right">Subtotal</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <GridLineRow
                  key={row.key}
                  row={row}
                  onRemove={() =>
                    onRemove({ kind: row.kind, id: ((row.line as { id?: string }).id ?? row.key), name: row.name })
                  }
                />
              ))}
            </tbody>
            {/* Sticky footer rows. */}
            <tfoot>
              <tr>
                <Td colSpan={5} align="right" style={{ borderTop: "0.5px solid var(--ds-border-warm)", fontWeight: 500 }}>
                  Subtotal (net)
                </Td>
                <Td align="right" style={{ borderTop: "0.5px solid var(--ds-border-warm)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                  €{(productsSubtotalNet + packagingSubtotalNet + variantsSubtotalNet).toFixed(2)}
                </Td>
                <Td style={{ borderTop: "0.5px solid var(--ds-border-warm)" }} />
              </tr>
              {vatRows.map((b) => (
                <tr key={b.rate}>
                  <Td colSpan={5} align="right" style={{ color: "var(--ds-text-muted)" }}>
                    VAT {b.rate}%
                  </Td>
                  <Td align="right" style={{ color: "var(--ds-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                    €{b.vat.toFixed(2)}
                  </Td>
                  <Td />
                </tr>
              ))}
              <tr>
                <Td colSpan={5} align="right" style={{ borderTop: "0.5px solid var(--ds-border-warm)", fontWeight: 600 }}>
                  Total (gross)
                </Td>
                <Td align="right" style={{ borderTop: "0.5px solid var(--ds-border-warm)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  €{totalGross.toFixed(2)}
                </Td>
                <Td style={{ borderTop: "0.5px solid var(--ds-border-warm)" }} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Section>
  );
}

function priceSourceLabel(override: number | undefined, source: string): string {
  if (override != null) return "per-line override";
  if (source === "customer") return "from customer price";
  if (source === "priceList") return "from price list";
  if (source === "retail") return "retail fallback";
  if (source === "discount") return "customer discount";
  if (source === "none") return "no price set";
  return source;
}

function Th({
  children, align = "left", title,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  title?: string;
}) {
  return (
    <th
      title={title}
      style={{
        padding: "8px 12px",
        textAlign: align,
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--ds-text-muted)",
        fontWeight: 600,
        borderBottom: "0.5px solid var(--ds-border-warm)",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children, align = "left", colSpan, style,
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
  colSpan?: number;
  style?: React.CSSProperties;
}) {
  return (
    <td colSpan={colSpan} style={{ padding: "8px 12px", textAlign: align, fontSize: 13, ...style }}>
      {children}
    </td>
  );
}

function GridLineRow({
  row, onRemove,
}: {
  row:
    | { key: string; kind: "single"; line: OrderItem; name: string; notes?: string; priceSource: string; unitPrice: number | null; vatRate: number; subtotal: number; }
    | { key: string; kind: "variant"; line: import("@/types").OrderVariantLine; name: string; notes?: string; priceSource: string; unitPrice: number | null; vatRate: number; subtotal: number; }
    | { key: string; kind: "decoration"; line: OrderPackagingLine; name: string; notes?: string; priceSource: string; unitPrice: number | null; vatRate: number; subtotal: number; };
  onRemove: () => void;
}) {
  const kindLabel = row.kind === "single" ? "Single" : row.kind === "variant" ? "Variant" : "Decoration";
  return (
    <tr style={{ borderBottom: "0.5px solid var(--ds-border-warm)" }}>
      <Td>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 500 }}>{row.name}</span>
          <span style={{ fontSize: 10, color: "var(--ds-text-muted)" }}>
            <span style={{ textTransform: "uppercase", letterSpacing: "0.06em", marginRight: 6 }}>{kindLabel}</span>
            {row.notes && <span style={{ fontStyle: "italic" }}>· {row.notes}</span>}
          </span>
        </div>
      </Td>
      <Td align="right">
        {row.kind === "single" ? (
          <NumberCell
            value={row.line.quantity}
            min={1}
            step={1}
            onSave={async (n) => {
              if (!row.line.id) return;
              await saveOrderItem({
                id: row.line.id,
                orderId: row.line.orderId,
                productId: row.line.productId,
                quantity: n,
                sortOrder: row.line.sortOrder,
                notes: row.line.notes,
                fulfilmentMode: row.line.fulfilmentMode,
                unitPrice: row.line.unitPrice,
                vatRate: row.line.vatRate,
              });
            }}
          />
        ) : row.kind === "decoration" ? (
          <NumberCell
            value={row.line.quantity}
            min={1}
            step={1}
            onSave={async (n) => {
              if (!row.line.id) return;
              await saveOrderPackagingLine({
                id: row.line.id,
                orderId: row.line.orderId,
                packagingId: row.line.packagingId,
                quantity: n,
                sortOrder: row.line.sortOrder,
                notes: row.line.notes,
                unitPrice: row.line.unitPrice,
                vatRate: row.line.vatRate,
              });
            }}
          />
        ) : (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.line.quantity}</span>
        )}
      </Td>
      <Td align="right">
        {row.kind === "variant" ? (
          // OrderVariantLine has no save endpoint exposed today; flag deferred.
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            €{row.line.unitPrice.toFixed(2)}
            <span style={{ display: "block", fontSize: 10, color: "var(--ds-text-muted)" }}>variant set ✗</span>
          </span>
        ) : row.kind === "single" ? (
          <PriceCell
            value={row.line.unitPrice ?? null}
            source={row.priceSource}
            onSave={async (next) => {
              if (!row.line.id) return;
              await saveOrderItem({
                id: row.line.id,
                orderId: row.line.orderId,
                productId: row.line.productId,
                quantity: row.line.quantity,
                sortOrder: row.line.sortOrder,
                notes: row.line.notes,
                fulfilmentMode: row.line.fulfilmentMode,
                unitPrice: next ?? undefined,
                vatRate: row.line.vatRate,
              });
            }}
          />
        ) : (
          <PriceCell
            value={row.line.unitPrice ?? null}
            source={row.priceSource}
            onSave={async (next) => {
              if (!row.line.id) return;
              await saveOrderPackagingLine({
                id: row.line.id,
                orderId: row.line.orderId,
                packagingId: row.line.packagingId,
                quantity: row.line.quantity,
                sortOrder: row.line.sortOrder,
                notes: row.line.notes,
                unitPrice: next ?? undefined,
                vatRate: row.line.vatRate,
              });
            }}
          />
        )}
      </Td>
      <Td align="right">
        <span style={{ color: "var(--ds-text-muted)", fontSize: 11, fontStyle: "italic" }}>—</span>
      </Td>
      <Td align="right">
        {row.kind === "single" ? (
          <VatCell
            value={row.vatRate}
            onSave={async (next) => {
              if (!row.line.id) return;
              await saveOrderItem({
                id: row.line.id,
                orderId: row.line.orderId,
                productId: row.line.productId,
                quantity: row.line.quantity,
                sortOrder: row.line.sortOrder,
                notes: row.line.notes,
                fulfilmentMode: row.line.fulfilmentMode,
                unitPrice: row.line.unitPrice,
                vatRate: next ?? undefined,
              });
            }}
          />
        ) : row.kind === "decoration" ? (
          <VatCell
            value={row.vatRate}
            onSave={async (next) => {
              if (!row.line.id) return;
              await saveOrderPackagingLine({
                id: row.line.id,
                orderId: row.line.orderId,
                packagingId: row.line.packagingId,
                quantity: row.line.quantity,
                sortOrder: row.line.sortOrder,
                notes: row.line.notes,
                unitPrice: row.line.unitPrice,
                vatRate: next ?? undefined,
              });
            }}
          />
        ) : (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.vatRate}%</span>
        )}
      </Td>
      <Td align="right" style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
        €{row.subtotal.toFixed(2)}
      </Td>
      <Td align="right">
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove line"
          style={{
            background: "transparent",
            border: "none",
            color: "var(--ds-text-muted)",
            cursor: "pointer",
            padding: 4,
          }}
          className="hover:text-[color:var(--ds-tier-urgent)]"
        >
          <X size={14} />
        </button>
      </Td>
    </tr>
  );
}

function NumberCell({
  value, min, step, onSave,
}: {
  value: number;
  min?: number;
  step?: number;
  onSave: (next: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  if (editing) {
    return (
      <input
        type="number"
        min={min}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          const n = parseFloat(draft);
          if (Number.isFinite(n) && n !== value) await onSave(n);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setDraft(String(value)); setEditing(false); }
        }}
        autoFocus
        style={{
          width: 60, padding: "2px 4px", textAlign: "right",
          fontSize: 13, border: "0.5px solid var(--ds-tier-quarter-focus)",
          borderRadius: 3, background: "var(--ds-card-bg)",
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      style={{
        background: "transparent", border: "none", cursor: "pointer",
        fontSize: 13, fontVariantNumeric: "tabular-nums",
        color: "var(--ds-text-primary)",
        padding: "2px 4px", borderRadius: 3,
      }}
      className="hover:bg-[color:var(--ds-card-bg-hover)]"
    >
      {value}
    </button>
  );
}

function PriceCell({
  value, source, onSave,
}: {
  value: number | null;
  source: string;
  onSave: (next: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value != null ? value.toFixed(2) : "");
  useEffect(() => { if (!editing) setDraft(value != null ? value.toFixed(2) : ""); }, [value, editing]);
  if (editing) {
    return (
      <input
        type="number"
        min={0}
        step={0.01}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          const trimmed = draft.trim();
          const next = trimmed === "" ? null : parseFloat(trimmed);
          if (next !== null && (!Number.isFinite(next) || next < 0)) {
            setDraft(value != null ? value.toFixed(2) : "");
            setEditing(false);
            return;
          }
          await onSave(next);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setDraft(value != null ? value.toFixed(2) : ""); setEditing(false); }
        }}
        autoFocus
        style={{
          width: 80, padding: "2px 4px", textAlign: "right",
          fontSize: 13, border: "0.5px solid var(--ds-tier-quarter-focus)",
          borderRadius: 3, background: "var(--ds-card-bg)",
        }}
      />
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      <button
        type="button"
        onClick={() => setEditing(true)}
        style={{
          background: "transparent", border: "none", cursor: "pointer",
          fontSize: 13, fontVariantNumeric: "tabular-nums",
          color: "var(--ds-text-primary)",
          padding: "2px 4px", borderRadius: 3,
        }}
        className="hover:bg-[color:var(--ds-card-bg-hover)]"
      >
        {value != null ? `€${value.toFixed(2)}` : "—"}
      </button>
      <span style={{ fontSize: 10, color: "var(--ds-text-muted)" }}>{source}</span>
    </div>
  );
}

function VatCell({
  value, onSave,
}: {
  value: number;
  onSave: (next: number | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);
  if (editing) {
    return (
      <input
        type="number"
        min={0} max={100} step={0.5}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          const trimmed = draft.trim();
          const next = trimmed === "" ? null : parseFloat(trimmed);
          if (next !== null && (!Number.isFinite(next) || next < 0 || next > 100)) {
            setDraft(String(value));
            setEditing(false);
            return;
          }
          await onSave(next);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setDraft(String(value)); setEditing(false); }
        }}
        autoFocus
        style={{
          width: 50, padding: "2px 4px", textAlign: "right",
          fontSize: 13, border: "0.5px solid var(--ds-tier-quarter-focus)",
          borderRadius: 3, background: "var(--ds-card-bg)",
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      style={{
        background: "transparent", border: "none", cursor: "pointer",
        fontSize: 13, fontVariantNumeric: "tabular-nums",
        color: "var(--ds-text-primary)",
        padding: "2px 4px", borderRadius: 3,
      }}
      className="hover:bg-[color:var(--ds-card-bg-hover)]"
    >
      {value}%
    </button>
  );
}

// ────────────────────────────────────────────────────────────────
// Customer picker drawer (search-aware replacement for select)
// ────────────────────────────────────────────────────────────────

function CustomerPickerDrawerBody({
  order, onPicked,
}: {
  order: Order;
  onPicked: (c: Customer) => Promise<void>;
}) {
  const customers = useCustomers(false);
  const [query, setQuery] = useState("");
  const [addingNew, setAddingNew] = useState(false);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers.slice(0, 30);
    return customers
      .filter((c) =>
        c.companyName.toLowerCase().includes(q)
        || (c.contactName ?? "").toLowerCase().includes(q)
        || (c.email ?? "").toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [customers, query]);

  if (addingNew) {
    return (
      <InlineNewCustomer
        initialName={query}
        onCreated={async (c) => { setAddingNew(false); await onPicked(c); }}
        onCancel={() => setAddingNew(false)}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input
        type="text"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search customers…"
        className="input"
      />
      {order.customerId && (
        <div style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>
          Currently linked: {order.customerName ?? order.customerId}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {matches.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPicked(c)}
            style={{
              textAlign: "left",
              padding: "8px 10px",
              borderRadius: 4,
              border: "0.5px solid var(--ds-border-warm)",
              background: "var(--ds-card-bg)",
              marginBottom: 4,
              cursor: "pointer",
              fontSize: 13,
            }}
            className="hover:bg-[color:var(--ds-card-bg-hover)]"
          >
            <span style={{ fontWeight: 500 }}>{c.companyName}</span>
            {c.type && (
              <span style={{ marginLeft: 8, fontSize: 10, color: "var(--ds-text-muted)", textTransform: "uppercase" }}>
                {CUSTOMER_TYPE_LABELS[c.type]}
              </span>
            )}
            {c.contactName && (
              <div style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>{c.contactName}{c.email ? ` · ${c.email}` : ""}</div>
            )}
          </button>
        ))}
      </div>
      <DsButton
        variant="primary"
        onClick={() => setAddingNew(true)}
      >
        <UserPlus size={12} style={{ marginRight: 4 }} />
        {query.trim() ? `Add "${query.trim()}"` : "Add new customer"}
      </DsButton>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Add line drawer (toggles between Product / Variant / Decoration)
// ────────────────────────────────────────────────────────────────

function AddLineDrawerBody({
  orderId, products, packaging, packagingUnitCost, allVariants,
  resolveProductPrice, nextSortOrderProducts, nextSortOrderPackaging,
  availableFor, onDone,
}: {
  orderId: string;
  products: { id?: string; name: string; archived?: boolean }[];
  packaging: Packaging[];
  packagingUnitCost: Map<string, number>;
  allVariants: ReturnType<typeof useVariants>;
  resolveProductPrice: (id: string) => ReturnType<typeof resolveUnitPrice>;
  nextSortOrderProducts: number;
  nextSortOrderPackaging: number;
  availableFor: (id: string) => number;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<LineKind>("single");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "inline-flex", gap: 4, alignSelf: "flex-start" }}>
        {(["single", "variant", "decoration"] as LineKind[]).map((k) => {
          const on = kind === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              style={{
                fontSize: 11,
                padding: "5px 12px",
                borderRadius: 999,
                border: on ? `0.5px solid var(--ds-tier-quarter-focus)` : `0.5px solid var(--ds-border-warm)`,
                background: on ? "var(--ds-tier-quarter-focus)" : "var(--ds-card-bg)",
                color: on ? "#fff" : "var(--ds-text-muted)",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {k === "single" ? "Product" : k === "variant" ? "Variant" : "Decoration"}
            </button>
          );
        })}
      </div>

      {kind === "single" && (
        <AddOrderLine
          orderId={orderId}
          nextSortOrder={nextSortOrderProducts}
          products={products}
          resolveProductPrice={resolveProductPrice}
          availableFor={availableFor}
          onSaved={onDone}
          onCancel={onDone}
        />
      )}
      {kind === "variant" && (
        <AddVariantForm
          orderId={orderId}
          allVariants={allVariants}
          onDone={onDone}
        />
      )}
      {kind === "decoration" && (
        <AddOrderPackagingLine
          orderId={orderId}
          nextSortOrder={nextSortOrderPackaging}
          packaging={packaging}
          packagingUnitCost={packagingUnitCost}
          onCancel={onDone}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// History helpers
// ────────────────────────────────────────────────────────────────

function HistoryChip({ kind }: { kind: "created" | "status" | "batch-linked" | "note" }) {
  const label =
    kind === "created" ? "Created"
      : kind === "status" ? "Status changed"
      : kind === "batch-linked" ? "Batch linked"
      : "Note";
  const bg =
    kind === "created" ? "var(--accent-mint-bg)"
      : kind === "status" ? "var(--ds-tint-info)"
      : kind === "batch-linked" ? "var(--accent-butter-bg)"
      : "var(--ds-card-bg-hover)";
  const ink =
    kind === "created" ? "var(--accent-mint-ink)"
      : kind === "status" ? "var(--ds-tier-quarter-focus)"
      : kind === "batch-linked" ? "var(--accent-butter-ink)"
      : "var(--ds-text-muted)";
  return (
    <span
      style={{
        fontSize: 10, padding: "1px 7px",
        borderRadius: 999, background: bg, color: ink,
        textTransform: "uppercase", letterSpacing: "0.06em",
      }}
    >
      {label}
    </span>
  );
}

function HistoryTime({ time }: { time: Date }) {
  const now = Date.now();
  const diffMs = now - time.getTime();
  const mins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(mins / 60);
  const days = Math.floor(hrs / 24);
  let rel: string;
  if (mins < 1) rel = "just now";
  else if (mins < 60) rel = `${mins}m ago`;
  else if (hrs < 24) rel = `${hrs}h ago`;
  else if (days < 30) rel = `${days}d ago`;
  else rel = time.toLocaleDateString("de-AT", { day: "numeric", month: "short" });
  const abs = time.toLocaleString("de-AT", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  return (
    <span title={abs} style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
      {rel}
    </span>
  );
}

// ────────────────────────────────────────────────────────────────
// Plan-status badge maps
// ────────────────────────────────────────────────────────────────

const PLAN_STATUS_LABEL: Record<ProductionPlan["status"], string> = {
  draft: "Pending",
  active: "In production",
  done: "Done",
  cancelled: "Cancelled",
  orphaned: "Orphaned",
};
const PLAN_STATUS_BG: Record<ProductionPlan["status"], string> = {
  draft: "var(--ds-card-bg-hover)",
  active: "rgba(218,183,63,0.18)",
  done: "rgba(93,202,165,0.18)",
  cancelled: "rgba(153,53,86,0.12)",
  orphaned: "rgba(153,53,86,0.12)",
};
const PLAN_STATUS_INK: Record<ProductionPlan["status"], string> = {
  draft: "var(--ds-text-muted)",
  active: "var(--ds-semantic-warn)",
  done: "var(--accent-mint-ink)",
  cancelled: "var(--ds-tier-urgent)",
  orphaned: "var(--ds-tier-urgent)",
};

// ────────────────────────────────────────────────────────────────
// AddOrderLine (kept from previous build, used inside drawer)
// ────────────────────────────────────────────────────────────────

function AddOrderLine({ orderId, nextSortOrder, products, resolveProductPrice, availableFor, onSaved, onCancel }: {
  orderId: string;
  nextSortOrder: number;
  products: { id?: string; name: string; archived?: boolean }[];
  resolveProductPrice: (productId: string) => ReturnType<typeof resolveUnitPrice>;
  availableFor: (productId: string) => number;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(true);
  const [quantity, setQuantity] = useState("1");
  const [unitPriceInput, setUnitPriceInput] = useState("");
  const [notes, setNotes] = useState("");
  const [fulfilmentMode, setFulfilmentMode] = useState<"produce" | "borrow" | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const productInputRef = useRef<HTMLInputElement>(null);

  const qty = parseInt(quantity, 10);
  const available = productId ? availableFor(productId) : 0;
  const canSave = !!productId && !isNaN(qty) && qty > 0 && !!fulfilmentMode && !saving;
  void productInputRef;

  const matches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    const active = products.filter((p) => p.id && !p.archived);
    if (!q) return active.slice(0, 20);
    return active.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [products, productQuery]);

  function pickProduct(p: { id?: string; name: string }) {
    if (!p.id) return;
    setProductId(p.id);
    setProductQuery(p.name);
    setPickerOpen(false);
    const r = resolveProductPrice(p.id);
    if (r.unitPrice != null) setUnitPriceInput(r.unitPrice.toFixed(2));
    else setUnitPriceInput("");
  }

  async function handleAdd() {
    if (!canSave) return;
    setSaving(true);
    setSaveError("");
    try {
      const priceNum = parseFloat(unitPriceInput);
      await saveOrderItem({
        orderId,
        productId,
        quantity: qty,
        sortOrder: nextSortOrder,
        notes: notes.trim() || undefined,
        unitPrice: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : undefined,
        fulfilmentMode,
      });
      onSaved();
    } catch (err) {
      const raw: { message?: string; code?: string; details?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      setSaveError(`${raw.message || raw.details || "Save failed"}${code}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ position: "relative" }}>
        <input
          ref={productInputRef}
          type="text"
          value={productQuery}
          onChange={(e) => { setProductQuery(e.target.value); setProductId(""); setPickerOpen(true); }}
          onFocus={() => setPickerOpen(true)}
          placeholder="Search product…"
          className="input"
          autoFocus
          autoComplete="off"
        />
        {pickerOpen && matches.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 rounded border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-lg max-h-56 overflow-y-auto">
            {matches.map((p) => {
              const r = resolveProductPrice(p.id!);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickProduct(p)}
                  className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="flex-1 truncate">{p.name}</span>
                  {r.unitPrice != null && (
                    <span className="text-xs text-muted-foreground tabular-nums">€{r.unitPrice.toFixed(2)}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Qty" className="input" />
        <input type="number" min={0} step={0.01} value={unitPriceInput} onChange={(e) => setUnitPriceInput(e.target.value)} placeholder="€ net / unit" className="input" />
      </div>
      <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Line notes (optional)" className="input" />
      {productId && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 11 }}>
          <span style={{ color: "var(--ds-text-muted)" }}>
            Stock available: <b style={{ color: "var(--ds-text-primary)" }}>{available}</b>
          </span>
          <button
            type="button"
            onClick={() => setFulfilmentMode("borrow")}
            disabled={available === 0}
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-medium ${
              fulfilmentMode === "borrow"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-[color:var(--ds-border-warm)] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            }`}
          >
            Take from stock
          </button>
          <button
            type="button"
            onClick={() => setFulfilmentMode("produce")}
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-medium ${
              fulfilmentMode === "produce"
                ? "bg-primary text-primary-foreground border-primary"
                : "border-[color:var(--ds-border-warm)] text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            Produce fresh
          </button>
          {!fulfilmentMode && <span style={{ color: "var(--ds-semantic-warn)" }}>Pick one</span>}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <DsButton variant="primary" onClick={handleAdd} disabled={!canSave}>
          {saving ? "Adding…" : "Add line"}
        </DsButton>
        <DsButton onClick={onCancel}>Done</DsButton>
      </div>
      {saveError && <p style={{ fontSize: 11, color: "var(--ds-tier-urgent)" }}>{saveError}</p>}
    </div>
  );
}

function AddOrderPackagingLine({ orderId, nextSortOrder, packaging, packagingUnitCost, onCancel }: {
  orderId: string;
  nextSortOrder: number;
  packaging: Packaging[];
  packagingUnitCost: Map<string, number>;
  onCancel: () => void;
}) {
  const [packagingId, setPackagingId] = useState("");
  const [packagingQuery, setPackagingQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(true);
  const [quantity, setQuantity] = useState("1");
  const [unitPriceInput, setUnitPriceInput] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [saveError, setSaveError] = useState("");

  const qty = parseInt(quantity, 10);
  const canSave = !!packagingId && Number.isFinite(qty) && qty > 0 && !saving;

  const matches = useMemo(() => {
    const q = packagingQuery.trim().toLowerCase();
    if (!q) return packaging.slice(0, 20);
    return packaging.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [packaging, packagingQuery]);

  function pickPackaging(p: Packaging) {
    setPackagingId(p.id!);
    setPackagingQuery(p.name);
    setPickerOpen(false);
    const latest = packagingUnitCost.get(p.id!);
    if (latest != null) setUnitPriceInput(latest.toFixed(2));
  }

  async function handleAdd() {
    if (!canSave) return;
    setSaving(true);
    setSaveError("");
    try {
      const priceNum = parseFloat(unitPriceInput);
      await saveOrderPackagingLine({
        orderId,
        packagingId,
        quantity: qty,
        sortOrder: nextSortOrder + addedCount,
        notes: notes.trim() || undefined,
        unitPrice: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : undefined,
      });
      setPackagingId(""); setPackagingQuery(""); setPickerOpen(true);
      setQuantity("1"); setUnitPriceInput(""); setNotes("");
      setAddedCount((n) => n + 1);
    } catch (err) {
      const raw: { message?: string } = err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      setSaveError(raw.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ position: "relative" }}>
        <input
          type="text"
          value={packagingQuery}
          onChange={(e) => { setPackagingQuery(e.target.value); setPackagingId(""); setPickerOpen(true); }}
          onFocus={() => setPickerOpen(true)}
          placeholder="Search packaging…"
          className="input"
          autoFocus
          autoComplete="off"
        />
        {pickerOpen && matches.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 rounded border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-lg max-h-56 overflow-y-auto">
            {matches.map((p) => {
              const cost = packagingUnitCost.get(p.id!);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickPackaging(p)}
                  className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted"
                >
                  <span className="flex-1 truncate">{p.name}</span>
                  {cost != null && <span className="text-xs text-muted-foreground tabular-nums">€{cost.toFixed(2)}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Qty" className="input" />
        <input type="number" min={0} step={0.01} value={unitPriceInput} onChange={(e) => setUnitPriceInput(e.target.value)} placeholder="€ net / unit" className="input" />
      </div>
      <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Line notes (optional)" className="input" />
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <DsButton variant="primary" onClick={handleAdd} disabled={!canSave}>
          {saving ? "Adding…" : "Add"}
        </DsButton>
        <DsButton onClick={onCancel}>Done</DsButton>
        {addedCount > 0 && (
          <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>{addedCount} added</span>
        )}
      </div>
      {saveError && <p style={{ fontSize: 11, color: "var(--ds-tier-urgent)" }}>{saveError}</p>}
    </div>
  );
}

function AddVariantForm({ orderId, allVariants, onDone }: {
  orderId: string;
  allVariants: ReturnType<typeof useVariants>;
  onDone: () => void;
}) {
  const [variantId, setVariantId] = useState("");
  const [vpId, setVpId] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const vps = useVariantPackagings(variantId);
  const composition = useVariantPackagingProducts(vpId);
  useEffect(() => {
    const vp = vps.find((p) => p.id === vpId);
    if (vp) setPrice(String(vp.price ?? vp.sellPrice ?? ""));
  }, [vpId, vps]);

  async function handleAdd() {
    if (!variantId) { alert("Pick a variant first."); return; }
    const q = parseInt(qty, 10);
    const p = parseFloat(price);
    if (!Number.isFinite(q) || q <= 0) { alert("Qty must be > 0."); return; }
    if (!Number.isFinite(p) || p < 0) { alert("Price required."); return; }
    if (composition.length === 0 && vpId) {
      if (!confirm("This variant size has no curated composition. Add anyway?")) return;
    }
    setSaving(true);
    try {
      await addVariantToOrder({
        orderId,
        variantId,
        variantPackagingId: vpId || null,
        quantity: q,
        unitPrice: p,
        composition: composition.map((c) => ({ productId: c.productId, qty: c.qty })),
      });
      onDone();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select value={variantId} onChange={(e) => { setVariantId(e.target.value); setVpId(""); }} className="input">
          <option value="">— variant —</option>
          {allVariants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select value={vpId} onChange={(e) => setVpId(e.target.value)} disabled={!variantId} className="input">
          <option value="">— size —</option>
          {vps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.packagingId ? `Packaging #${p.id?.slice(0, 4)}` : "Loose / no packaging"} · €{Number(p.price ?? p.sellPrice ?? 0).toFixed(2)}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} className="input" placeholder="Qty" />
        <input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="input" placeholder="Price / unit (€)" />
      </div>
      {composition.length > 0 && (
        <p style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>
          Will auto-add {composition.length} product line{composition.length === 1 ? "" : "s"} to production demand.
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <DsButton variant="primary" onClick={handleAdd} disabled={saving}>
          {saving ? "Adding…" : "Add variant"}
        </DsButton>
        <DsButton onClick={onDone}>Cancel</DsButton>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Summary card (kept — totals + feasibility + price paid)
// ────────────────────────────────────────────────────────────────

function OrderSummaryCard({
  order, labour, calculatedCost, feasibility, labourHourlyRate, productNameById,
  totalNet, totalGross, vatBreakdown, margin,
}: {
  order: import("@/types").Order;
  labour: ReturnType<typeof computeOrderLabourHours>;
  calculatedCost: ReturnType<typeof computeOrderCalculatedCost>;
  feasibility: ReturnType<typeof checkOrderFeasibility>;
  labourHourlyRate: number | null;
  productNameById: Map<string, { name: string }>;
  totalNet: number;
  totalGross: number;
  vatBreakdown: VatBreakdown[];
  margin: ReturnType<typeof computeOrderMargin>;
}) {
  const sevColor =
    feasibility.severity === "green" ? "rgba(93,202,165,0.35)"
      : feasibility.severity === "yellow" ? "rgba(218,183,63,0.35)"
      : "rgba(153,53,86,0.35)";
  const sevInk =
    feasibility.severity === "green" ? "var(--ds-tier-positive)"
      : feasibility.severity === "yellow" ? "var(--ds-semantic-warn)"
      : "var(--ds-tier-urgent)";

  return (
    <Section title="Totals + feasibility">
      <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <TotalLine label="Subtotal (net)" value={totalNet} emphasis />
          {vatBreakdown.map((b) => (
            <TotalLine key={b.rate} label={`VAT ${b.rate}%`} value={b.vat} muted />
          ))}
          <div style={{ borderTop: "0.5px solid var(--ds-border-warm)", paddingTop: 6 }}>
            <TotalLine label="Total (gross)" value={totalGross} emphasis />
          </div>
        </div>

        <div style={{ borderTop: "0.5px solid var(--ds-border-warm)", paddingTop: 8 }}>
          <PricePaidField
            order={order}
            suggestedNet={totalNet > 0 ? totalNet : undefined}
            suggestedGross={totalGross > 0 ? totalGross : undefined}
            vatBreakdown={vatBreakdown}
          />
        </div>

        <div style={{ borderTop: "0.5px solid var(--ds-border-warm)", paddingTop: 8 }}>
          <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--ds-text-muted)", fontWeight: 600, marginBottom: 4 }}>
            Internal (not on invoice)
          </p>
          <TotalLine
            label="Labour"
            value={calculatedCost.labourCost}
            hint={labourHourlyRate == null ? "set rate in Settings" : `${labour.totalHours}h @ €${labourHourlyRate.toFixed(2)}`}
            muted
          />
          <TotalLine label="Total cost" value={calculatedCost.totalCost} muted />
          <div style={{ borderTop: "0.5px solid var(--ds-border-warm)", paddingTop: 4, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--ds-text-muted)" }}>Margin</span>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontWeight: 600,
                color:
                  margin.marginPercent == null
                    ? "var(--ds-text-muted)"
                    : margin.marginPercent < 0
                      ? "var(--ds-tier-urgent)"
                      : margin.marginPercent < 20
                        ? "var(--ds-semantic-warn)"
                        : "var(--ds-tier-positive)",
              }}
            >
              {order.pricePaid == null
                ? "—"
                : margin.marginPercent == null
                  ? "—"
                  : `${margin.marginPercent.toFixed(0)}% · €${margin.profit.toFixed(2)}`}
            </span>
          </div>
        </div>

        <div
          style={{
            border: `0.5px solid ${sevColor}`,
            color: sevInk,
            background: `${sevColor.replace("0.35", "0.08")}`,
            borderRadius: 6,
            padding: "8px 12px",
            display: "flex",
            gap: 8,
            alignItems: "flex-start",
          }}
        >
          {feasibility.severity === "green"
            ? <Check size={14} style={{ marginTop: 2 }} />
            : <AlertTriangle size={14} style={{ marginTop: 2 }} />}
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 500 }}>{feasibility.summary}</p>
            {feasibility.shortfalls.length > 0 && (
              <ul style={{ marginTop: 4, fontSize: 11 }}>
                {feasibility.shortfalls.map((s) => (
                  <li key={s.productId}>
                    {productNameById.get(s.productId)?.name ?? s.productId}: short by {s.shortPieces} pc
                    {" "}(need {s.required}, have {s.available}, can make {s.producible})
                  </li>
                ))}
              </ul>
            )}
            <p style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>
              {feasibility.availableHours}h available · {feasibility.freeHours}h free · {labour.totalHours}h needed
            </p>
          </div>
        </div>
      </div>
    </Section>
  );
}

function TotalLine({ label, value, hint, muted, emphasis }: {
  label: string;
  value: number;
  hint?: string;
  muted?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      fontSize: 13, color: muted ? "var(--ds-text-muted)" : "var(--ds-text-primary)",
    }}>
      <span style={{ fontWeight: emphasis ? 600 : 400 }}>{label}</span>
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
        {hint && <span style={{ fontSize: 10, color: "var(--ds-text-muted)" }}>{hint}</span>}
        <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: emphasis ? 600 : 400 }}>
          €{value.toFixed(2)}
        </span>
      </span>
    </div>
  );
}

function PricePaidField({ order, suggestedNet, suggestedGross, vatBreakdown }: {
  order: import("@/types").Order;
  suggestedNet?: number;
  suggestedGross?: number;
  vatBreakdown: VatBreakdown[];
}) {
  const [mode, setMode] = useState<"net" | "gross">("net");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(order.pricePaid != null ? String(order.pricePaid) : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const blendedRate = useMemo(() => {
    const totalNet = vatBreakdown.reduce((s, b) => s + b.net, 0);
    if (totalNet <= 0) return 10;
    const totalVat = vatBreakdown.reduce((s, b) => s + b.vat, 0);
    return (totalVat / totalNet) * 100;
  }, [vatBreakdown]);

  function displayFor(m: "net" | "gross"): string {
    if (order.pricePaid == null) return "";
    if (m === "net") return order.pricePaid.toFixed(2);
    return ((order.pricePaid * (1 + blendedRate / 100))).toFixed(2);
  }

  async function commit() {
    setSaveError("");
    const trimmed = value.trim();
    if (trimmed === "") {
      setSaving(true);
      try { await saveOrder({ ...order, pricePaid: undefined }); setEditing(false); }
      finally { setSaving(false); }
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) { setSaveError("Invalid amount"); return; }
    const net = mode === "net" ? parsed : computeVatFromGross(parsed, blendedRate).net;
    setSaving(true);
    try {
      await saveOrder({ ...order, pricePaid: Math.round(net * 100) / 100 });
      setEditing(false);
    } catch (err) {
      const raw: { message?: string } = err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      setSaveError(raw.message || "Save failed");
    } finally { setSaving(false); }
  }

  const otherDisplay = order.pricePaid != null
    ? `€${displayFor(mode === "net" ? "gross" : "net")} ${mode === "net" ? "gross" : "net"}`
    : "";
  const suggestion = mode === "net" ? suggestedNet : suggestedGross;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <p style={{ fontSize: 11, color: "var(--ds-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Price paid</p>
        <div style={{ display: "inline-flex", gap: 2, fontSize: 10, border: "0.5px solid var(--ds-border-warm)", padding: 2, borderRadius: 4 }}>
          {(["net", "gross"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); if (editing) setValue(displayFor(m)); }}
              style={{
                padding: "1px 8px", borderRadius: 999,
                background: mode === m ? "var(--ds-tier-quarter-focus)" : "transparent",
                color: mode === m ? "#fff" : "var(--ds-text-muted)",
                textTransform: "uppercase", border: "none", cursor: "pointer",
              }}
            >{m}</button>
          ))}
        </div>
      </div>
      {editing ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>€</span>
          <input
            type="number" step="0.01" min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { setValue(displayFor(mode)); setEditing(false); }
            }}
            onBlur={commit}
            autoFocus
            placeholder={suggestion != null ? suggestion.toFixed(2) : "0.00"}
            style={{
              fontSize: 16, fontWeight: 600, width: 110, padding: "2px 6px",
              border: "0.5px solid var(--ds-tier-quarter-focus)", borderRadius: 4,
              background: "var(--ds-card-bg)", color: "var(--ds-text-primary)",
            }}
          />
          {suggestion != null && value === "" && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setValue(suggestion.toFixed(2)); }}
              style={{ fontSize: 10, color: "var(--ds-tier-quarter-focus)", background: "transparent", border: "none", cursor: "pointer" }}
            >use calc</button>
          )}
        </div>
      ) : (
        <button
          onClick={() => { setValue(displayFor(mode)); setEditing(true); }}
          style={{
            fontSize: 16, fontWeight: 600, fontVariantNumeric: "tabular-nums",
            background: "transparent", border: "none", cursor: "pointer",
            padding: "2px 4px", marginLeft: -4,
          }}
          className="hover:bg-[color:var(--ds-card-bg-hover)] rounded"
        >
          {order.pricePaid != null
            ? <>€{displayFor(mode)} <span style={{ fontSize: 10, color: "var(--ds-text-muted)", marginLeft: 4 }}>{otherDisplay && `(${otherDisplay})`}</span></>
            : <span style={{ color: "var(--ds-text-muted)" }}>—</span>}
        </button>
      )}
      {saving && <p style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>Saving…</p>}
      {saveError && <p style={{ fontSize: 11, color: "var(--ds-tier-urgent)" }}>{saveError}</p>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Ready-to-pack (kept)
// ────────────────────────────────────────────────────────────────

function OrderReadyToPackSection({ orderId }: { orderId: string }) {
  const rows = useAllocatedForOrder(orderId);
  const order = useOrder(orderId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ pieces: number; warnings: string[] } | null>(null);

  if (rows.length === 0 && !done) return null;

  const byProduct = new Map<string, { productName: string; total: number; batches: Array<{ batch?: string; qty: number }> }>();
  for (const r of rows) {
    const g = byProduct.get(r.productId) ?? { productName: r.productName, total: 0, batches: [] };
    g.total += r.quantity;
    g.batches.push({ batch: r.batchNumber, qty: r.quantity });
    byProduct.set(r.productId, g);
  }

  async function handleMarkPacked() {
    setBusy(true); setErr("");
    try {
      const result = await markOrderAsPacked(orderId);
      if (order) await saveOrder({ ...order, status: "done" });
      setDone({ pieces: result.piecesMoved, warnings: result.warnings });
    } catch (e) {
      setErr(formatOrderErr(e));
    } finally { setBusy(false); }
  }

  return (
    <Section title="Ready to pack">
      {rows.length > 0 ? (
        <>
          {[...byProduct.values()].map((g) => (
            <ListRow
              key={g.productName}
              title={g.productName}
              meta={
                <span style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>
                  {g.batches.map((b, i) => (
                    <span key={i}>
                      {i > 0 && " · "}
                      {b.batch ? <span style={{ fontFamily: "monospace" }}>{b.batch}</span> : "untagged batch"}
                      {" · "}<span style={{ fontVariantNumeric: "tabular-nums" }}>{b.qty} pcs</span>
                    </span>
                  ))}
                </span>
              }
              side={<b style={{ fontVariantNumeric: "tabular-nums" }}>{g.total} pcs</b>}
            />
          ))}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "10px 20px", background: "var(--ds-card-bg-hover)",
            borderTop: "0.5px solid var(--ds-border-warm)",
          }}>
            <p style={{ fontSize: 11, color: "var(--ds-text-muted)" }}>
              Drains allocated stock + deducts this order&apos;s packaging.
            </p>
            <DsButton variant="primary" onClick={handleMarkPacked} disabled={busy}>
              {busy ? "Packing…" : "Mark as packed"}
            </DsButton>
          </div>
        </>
      ) : done ? (
        <div style={{ padding: "10px 20px", fontSize: 12, color: "var(--ds-tier-positive)" }}>
          <p style={{ fontWeight: 500 }}>Packed — {done.pieces} piece{done.pieces === 1 ? "" : "s"} moved out.</p>
          {done.warnings.length > 0 && (
            <ul style={{ marginTop: 4 }}>
              {done.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
            </ul>
          )}
        </div>
      ) : null}
      {err && <p style={{ padding: "8px 20px", fontSize: 11, color: "var(--ds-tier-urgent)" }}>{err}</p>}
    </Section>
  );
}

function formatOrderErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: string; details?: string; code?: string; hint?: string };
    const core = o.message || o.details || "Operation failed";
    const code = o.code ? ` (code ${o.code})` : "";
    const hint = o.hint ? ` — ${o.hint}` : "";
    return `${core}${code}${hint}`;
  }
  return String(e);
}

// ────────────────────────────────────────────────────────────────
// Inline new customer (kept — used inside customer drawer)
// ────────────────────────────────────────────────────────────────

function InlineNewCustomer({
  initialName, onCreated, onCancel,
}: {
  initialName: string;
  onCreated: (c: Customer) => void;
  onCancel: () => void;
}) {
  const [companyName, setCompanyName] = useState(initialName);
  const [type, setType] = useState<CustomerType | "">("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [defaultDeliveryMethod, setDefaultDeliveryMethod] = useState<DeliveryType | "">("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleCreate() {
    if (!companyName.trim()) return;
    setSaving(true);
    setSaveError("");
    try {
      const id = await saveCustomer({
        companyName: companyName.trim(),
        type: type === "" ? undefined : type,
        contactName: contactName.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        defaultDeliveryMethod: defaultDeliveryMethod === "" ? undefined : defaultDeliveryMethod,
        tags: [],
      });
      onCreated({
        id,
        companyName: companyName.trim(),
        type: type === "" ? undefined : type,
        contactName: contactName.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        defaultDeliveryMethod: defaultDeliveryMethod === "" ? undefined : defaultDeliveryMethod,
        tags: [],
      });
    } catch (err) {
      const raw: { message?: string } = err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      setSaveError(raw.message || "Save failed");
    } finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--ds-text-muted)" }}>New customer (quick)</p>
      <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Company / name *" className="input" autoFocus />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select value={type} onChange={(e) => setType(e.target.value as CustomerType | "")} className="input">
          <option value="">— type —</option>
          {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{CUSTOMER_TYPE_LABELS[t]}</option>)}
        </select>
        <select value={defaultDeliveryMethod} onChange={(e) => setDefaultDeliveryMethod(e.target.value as DeliveryType | "")} className="input">
          <option value="">— fulfilment —</option>
          {DELIVERY_TYPES.map((t) => <option key={t} value={t}>{DELIVERY_TYPE_LABELS[t]}</option>)}
        </select>
        <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact person" className="input" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="input" />
      </div>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="input" />
      <div style={{ display: "flex", gap: 8 }}>
        <DsButton variant="primary" onClick={handleCreate} disabled={saving || !companyName.trim()}>
          {saving ? "Creating…" : "Create + link"}
        </DsButton>
        <DsButton onClick={onCancel}>Cancel</DsButton>
      </div>
      {saveError && <p style={{ fontSize: 11, color: "var(--ds-tier-urgent)" }}>{saveError}</p>}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Replace + credit modal (kept)
// ────────────────────────────────────────────────────────────────

function ReplaceAndCreditModal({
  order, items, packagingLines, onClose, onDone,
}: {
  order: Order;
  items: OrderItem[];
  packagingLines: OrderPackagingLine[];
  onClose: () => void;
  onDone: (newOrderId: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [creditRef, setCreditRef] = useState(order.creditReference ?? "");
  const [copyPackaging, setCopyPackaging] = useState(true);
  const [busy, setBusy] = useState(false);

  async function doReplace() {
    if (!order.id) return;
    setBusy(true);
    try {
      const newDeadline = new Date();
      newDeadline.setDate(newDeadline.getDate() + 7);
      const newOrderId = await saveOrder({
        channel: order.channel,
        customerName: order.customerName,
        customerId: order.customerId,
        eventName: order.eventName ? `${order.eventName} (replacement)` : undefined,
        deadline: newDeadline.toISOString(),
        priority: "normal",
        status: "pending",
        notes: (order.notes ? order.notes + "\n" : "") + `[REPLACEMENT ${new Date().toISOString().slice(0, 10)}] ${reason}`,
        deliveryType: order.deliveryType,
        deliveryAddress: order.deliveryAddress,
        fulfillmentType: order.fulfillmentType,
        fulfillmentLeadDays: order.fulfillmentLeadDays,
        replacesOrderId: order.id,
        replacementReason: reason || undefined,
      });
      for (const [idx, it] of items.entries()) {
        await saveOrderItem({
          id: newId(),
          orderId: newOrderId,
          productId: it.productId,
          quantity: it.quantity,
          unitPrice: 0,
          sortOrder: idx,
          fulfilmentMode: it.fulfilmentMode,
          variantId: it.variantId,
        });
      }
      if (copyPackaging) {
        for (const pl of packagingLines) {
          await saveOrderPackagingLine({
            id: newId(),
            orderId: newOrderId,
            packagingId: pl.packagingId,
            quantity: pl.quantity,
            sortOrder: pl.sortOrder,
            notes: pl.notes,
            unitPrice: 0,
            vatRate: pl.vatRate,
          });
        }
      }
      await saveOrder({ ...order, creditReference: creditRef || undefined });
      onDone(newOrderId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full max-w-md mx-4 border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-xl"
        style={{ borderRadius: 6 }}
      >
        <header className="px-5 pt-4 pb-3 border-b border-[color:var(--ds-border-warm)]">
          <h3 className="serif" style={{ fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 500 }}>
            Replace + credit
          </h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Clone {items.length} line{items.length === 1 ? "" : "s"} into a new order. Stamp credit-note ref on the original.
          </p>
        </header>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="label">Reason</label>
            <textarea className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. bars shattered in transit" />
          </div>
          <div>
            <label className="label">Credit invoice ref</label>
            <input type="text" className="input" value={creditRef} onChange={(e) => setCreditRef(e.target.value)} placeholder="RE-2026-0123" />
          </div>
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={copyPackaging} onChange={(e) => setCopyPackaging(e.target.checked)} />
            <span>Also clone {packagingLines.length} packaging line{packagingLines.length === 1 ? "" : "s"}</span>
          </label>
        </div>
        <footer className="px-5 py-3 border-t border-[color:var(--ds-border-warm)] flex justify-end gap-2">
          <DsButton onClick={onClose}>Cancel</DsButton>
          <DsButton variant="primary" onClick={doReplace} disabled={busy || !reason.trim()}>
            {busy ? "…" : "Create replacement"}
          </DsButton>
        </footer>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────

/** ISO datetime → "YYYY-MM-DD" for DsInlineField type="date". */
function toLocalDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
