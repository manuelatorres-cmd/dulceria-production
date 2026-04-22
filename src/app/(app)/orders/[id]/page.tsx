"use client";

import { use, useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  useOrder, useOrderItems, useProductsList, saveOrder, deleteOrder,
  saveOrderItem, deleteOrderItem, useCustomers, useCustomer, saveCustomer,
  usePackagingList, useOrderPackagingLines, saveOrderPackagingLine, deleteOrderPackagingLine,
  useProductActiveMinutesMap, useProductionSchedule, useCapacityConfig,
  usePeople, usePersonUnavailability, useBlockedDays,
  useProductLocationTotals,
  useReplenishmentOrderFor,
  useCustomerProductPrices,
  useProductionPlans, useOrderPlanLinks, useAllPlanStepStatuses,
} from "@/lib/hooks";
import { batchPhaseProgress } from "@/lib/batch-progress";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { latestPackagingUnitCost } from "@/lib/collectionPricing";
import {
  computeOrderLabourHours, computeOrderCalculatedCost, checkOrderFeasibility,
  type OrderProductLine, type OrderPackagingRollupLine, type ProductStockState,
} from "@/lib/orderRollup";
import { computeMissingRequiredCustomerFields } from "@/lib/customerRequiredFields";
import {
  resolveUnitPrice, effectiveVatRate,
  aggregateVatByRate, computeOrderMargin,
  computeVatFromGross,
  type VatBreakdown,
} from "@/lib/pricing";
import {
  ORDER_CHANNELS, ORDER_CHANNEL_LABELS,
  ORDER_PRIORITIES, ORDER_PRIORITY_LABELS,
  ORDER_STATUSES, ORDER_STATUS_LABELS,
  DELIVERY_TYPES, DELIVERY_TYPE_LABELS,
  CUSTOMER_TYPES, CUSTOMER_TYPE_LABELS,
  type OrderChannel, type OrderPriority, type OrderStatus,
  type DeliveryType,
  type Packaging, type OrderPackagingLine,
  type ProductCostSnapshot, type PackagingOrder,
  type OrderItem, type Customer, type CustomerType,
  type OrderPlanLink, type ProductionPlan,
} from "@/types";
import { ArrowLeft, Plus, Trash2, X, Pencil, AlertTriangle, Check, Calendar, Package, UserPlus, User } from "lucide-react";

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const orderId = decodeURIComponent(idStr);
  const router = useRouter();

  const order = useOrder(orderId);
  const items = useOrderItems(orderId);
  const products = useProductsList(true);
  const packaging = usePackagingList(true);
  const replenishmentOrder = useReplenishmentOrderFor(orderId);
  const parentOrder = useOrder(order?.sourceOrderId);
  // Full customer record for the preferences banner + missing-data badge.
  const linkedCustomer = useCustomer(order?.customerId);
  const packagingLines = useOrderPackagingLines(orderId);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const packagingMap = useMemo(() => new Map(packaging.map((p) => [p.id!, p])), [packaging]);

  const activeMinutesMap = useProductActiveMinutesMap();
  const schedule = useProductionSchedule();
  const capacityConfig = useCapacityConfig();
  const people = usePeople(false);
  const unavailability = usePersonUnavailability();
  const blocked = useBlockedDays();
  const productLocationTotals = useProductLocationTotals();
  const orderPlanLinks = useOrderPlanLinks(orderId);
  const allPlans = useProductionPlans();
  const allPlanStepStatuses = useAllPlanStepStatuses();
  const plansById = useMemo(() => new Map(allPlans.map((p) => [p.id!, p])), [allPlans]);
  const linksByItemId = useMemo(() => {
    const m = new Map<string, OrderPlanLink[]>();
    for (const lk of orderPlanLinks) {
      const arr = m.get(lk.orderItemId) ?? [];
      arr.push(lk);
      m.set(lk.orderItemId, arr);
    }
    return m;
  }, [orderPlanLinks]);

  // Latest product unit cost + packaging unit cost, shared with the quote flow.
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
  // Collection rows (for price-list resolution via migration 0035's
  // unitPrice column). One query covers every collection since the
  // table is small and the hierarchy is evaluated per product.
  const { data: collectionProducts = [] } = useQuery({
    queryKey: ["collection-products", "all-for-order-detail"],
    queryFn: async () =>
      assertOk(
        await supabase.from("collectionProducts").select("collectionId, productId, unitPrice"),
      ) as Array<{ collectionId: string; productId: string; unitPrice?: number }>,
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

  // productId → a plausible "retail" unit price, picked as the highest
  // unitPrice on any collection that lists it. Consumed by
  // resolveUnitPrice as the last-resort fallback before "none".
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
      customerId: order?.customerId,
      customerProductPrices: customerProductPrices.map((p) => ({
        productId: p.productId, unitPrice: p.unitPrice,
      })),
      customerPriceListId: linkedCustomer?.defaultPriceListId,
      priceListEntries: collectionProducts,
      customerDiscountPercent: linkedCustomer?.defaultDiscountPercent,
      retailPrice: productRetailPrice.get(productId),
    });
  }

  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingLine, setAddingLine] = useState(false);

  if (order === undefined) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (order === null) return <div className="p-6 text-sm text-muted-foreground">Order not found.</div>;

  async function handleStatusChange(status: OrderStatus) {
    if (!order) return;
    await saveOrder({ ...order, status });
  }

  async function handleDelete() {
    await deleteOrder(orderId);
    router.replace("/orders");
  }

  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const deadlineDate = new Date(order.deadline);

  // ── Labour + calculated cost rollup ────────────────────────────
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

  // ── Feasibility ────────────────────────────────────────────────
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
  const committedMinutes = schedule
    .filter((s) => s.isActive)
    .filter((s) => s.orderId !== orderId)
    .filter((s) => {
      const t = new Date(s.startAt).getTime();
      return t >= nowRef.getTime() && t <= deadlineDate.getTime();
    })
    .reduce((acc, s) => acc + s.durationMinutes, 0);

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
  /** Product ids that don't fit within available stock + producibility
   *  for this order's quantities. Used by the per-line feasibility dot
   *  on OrderLineRow. */
  const shortProductIds = new Set(feasibility.shortfalls.map((s) => s.productId));

  // ── Customer-facing totals (net + VAT breakdown + gross) ───────
  // Each line contributes its own net + rate so orders with mixed
  // rates split correctly into { vat 10 %, vat 20 %, vat 0 % } rows.
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
  const totalNet = productsSubtotalNet + packagingSubtotalNet;
  const vatBreakdown = aggregateVatByRate([...productLineTotals, ...packagingLineTotals]);
  const totalVat = vatBreakdown.reduce((s, b) => s + b.vat, 0);
  const totalGross = Math.round((totalNet + totalVat) * 100) / 100;
  const marginResult = computeOrderMargin(totalNet, calculatedCost.totalCost);

  // ── Schedule filtered to this order ────────────────────────────
  const orderSchedule = schedule
    .filter((s) => s.orderId === orderId)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
  const scheduleByDay = new Map<string, typeof orderSchedule>();
  for (const s of orderSchedule) {
    const key = s.startAt.slice(0, 10);
    const arr = scheduleByDay.get(key) ?? [];
    arr.push(s);
    scheduleByDay.set(key, arr);
  }

  return (
    <div>
      <div className="px-4 pt-6 pb-2">
        <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Orders
        </Link>
      </div>

      <div className="px-4 pb-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">
              {order.customerName || order.eventName || "(unnamed)"}
            </h1>
            <p className="text-sm text-muted-foreground">
              {ORDER_CHANNEL_LABELS[order.channel]}
              {order.eventName && order.customerName && ` · ${order.eventName}`}
              {" · "}
              Deadline {deadlineDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              {" "}
              {deadlineDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
            </p>
            {order.customerId && (
              <Link
                href={`/customers/${encodeURIComponent(order.customerId)}`}
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View customer profile
                {linkedCustomer && computeMissingRequiredCustomerFields(linkedCustomer).length > 0 && (
                  <span
                    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-status-warn text-white text-[9px] font-bold"
                    title={`Missing: ${computeMissingRequiredCustomerFields(linkedCustomer).join(", ")}`}
                  >
                    {computeMissingRequiredCustomerFields(linkedCustomer).length}
                  </span>
                )}
                {" "}→
              </Link>
            )}
          </div>
          {!editing && (
            <button onClick={() => setEditing(true)} className="p-1.5 rounded-full hover:bg-muted">
              <Pencil className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {/* Customer preferences banner (read-only, always visible when linked) */}
        {linkedCustomer && (
          linkedCustomer.allergenNotes
          || linkedCustomer.packagingPrefs
          || linkedCustomer.language
          || linkedCustomer.paymentTerms
        ) && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground font-medium">
              <User className="w-3.5 h-3.5" /> Customer preferences
            </div>
            {linkedCustomer.allergenNotes && (
              <p><span className="text-muted-foreground">Allergens:</span> {linkedCustomer.allergenNotes}</p>
            )}
            {linkedCustomer.packagingPrefs && (
              <p><span className="text-muted-foreground">Packaging:</span> {linkedCustomer.packagingPrefs}</p>
            )}
            <div className="flex gap-3 text-muted-foreground">
              {linkedCustomer.language && <span>Lang: <span className="uppercase text-foreground">{linkedCustomer.language}</span></span>}
              {linkedCustomer.paymentTerms && <span>Payment: <span className="text-foreground">{linkedCustomer.paymentTerms}</span></span>}
            </div>
          </div>
        )}

        {/* Replenishment / borrow linkage banners */}
        {parentOrder && (
          <Link
            href={`/orders/${encodeURIComponent(parentOrder.id!)}`}
            className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm hover:bg-primary/10"
          >
            <Package className="w-4 h-4 text-primary" />
            <span className="flex-1">
              <span className="font-medium">Shop Replenishment</span> for order
              {" "}<span className="text-primary font-medium">{parentOrder.customerName || parentOrder.id?.slice(0, 8)}</span>
            </span>
            <span className="text-xs text-muted-foreground">View parent →</span>
          </Link>
        )}
        {replenishmentOrder && (
          <Link
            href={`/orders/${encodeURIComponent(replenishmentOrder.id!)}`}
            className="flex items-center gap-2 rounded-lg border border-status-ok/30 bg-status-ok/5 px-3 py-2 text-sm hover:bg-status-ok/10"
          >
            <Package className="w-4 h-4 text-status-ok" />
            <span className="flex-1">
              Linked replenishment order (deadline{" "}
              {new Date(replenishmentOrder.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })})
              {" · "}{replenishmentOrder.status}
            </span>
            <span className="text-xs text-muted-foreground">View →</span>
          </Link>
        )}

        {/* Status selector */}
        <div className="flex items-center gap-2">
          {ORDER_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => handleStatusChange(s)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                order.status === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              {ORDER_STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {/* Edit form */}
        {editing && (
          <OrderEditForm
            order={order}
            onSaved={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        )}

        {/* Priority + notes + delivery */}
        {!editing && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Priority</span>
              <span className="font-medium">{ORDER_PRIORITY_LABELS[order.priority]}</span>
            </div>
            {order.deliveryType && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Fulfilment</span>
                <span className="font-medium">{DELIVERY_TYPE_LABELS[order.deliveryType]}</span>
              </div>
            )}
            {order.deliveryAt && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Delivery / pickup</span>
                <span className="font-medium">
                  {new Date(order.deliveryAt).toLocaleString("en-GB", {
                    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              </div>
            )}
            {order.deliveryAddress && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Address</p>
                <p className="text-sm whitespace-pre-wrap">{order.deliveryAddress}</p>
              </div>
            )}
            {order.deliveryNotes && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Delivery notes</p>
                <p className="text-sm whitespace-pre-wrap">{order.deliveryNotes}</p>
              </div>
            )}
            {order.notes && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{order.notes}</p>
              </div>
            )}
          </div>
        )}

        {/* Summary — labour, calculated cost, price paid, feasibility */}
        {!editing && (
          <OrderSummaryCard
            order={order}
            labour={labourRollup}
            calculatedCost={calculatedCost}
            feasibility={feasibility}
            labourHourlyRate={capacityConfig?.labourHourlyRate ?? null}
            productNameById={productMap}
            productsSubtotalNet={productsSubtotalNet}
            packagingSubtotalNet={packagingSubtotalNet}
            totalNet={totalNet}
            totalVat={totalVat}
            totalGross={totalGross}
            vatBreakdown={vatBreakdown}
            margin={marginResult}
          />
        )}

        {/* Line items — "Add product" lives on the LEFT of the header
            to match the new-order flow; the old right-side placement
            hid below longer headers on narrow screens. */}
        <section>
          <div className="flex items-center gap-3 mb-2">
            {!addingLine && (
              <button
                onClick={() => setAddingLine(true)}
                className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium"
              >
                <Plus className="w-3.5 h-3.5" /> Add product
              </button>
            )}
            <h2 className="text-sm font-semibold text-primary">
              Products ({items.length} · {totalQty} pcs)
            </h2>
          </div>

          {/* Scheduling hint: produce-fresh lines need Regenerate plan
              to spawn batches. Shown only when at least one produce-fresh
              line exists without any link yet. */}
          {(() => {
            const produceItems = items.filter((i) => (i.fulfilmentMode ?? "produce") === "produce");
            const anyUnlinked = produceItems.some((i) => (linksByItemId.get(i.id!) ?? []).length === 0);
            if (!anyUnlinked) return null;
            if (order.status !== "pending" && order.status !== "in_production") return null;
            return (
              <div className="mb-2 rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Pending — not yet scheduled.{" "}
                <Link href="/plan" className="text-primary hover:underline">Regenerate plan</Link>{" "}
                to schedule the produce-fresh lines.
              </div>
            );
          })()}

          {addingLine && (
            <AddOrderLine
              orderId={orderId}
              nextSortOrder={items.length}
              products={products}
              resolveProductPrice={resolveProductPrice}
              availableFor={(id) => {
                const t = productLocationTotals.get(id);
                return t ? Math.max(0, (t.store ?? 0) + (t.production ?? 0)) : 0;
              }}
              onSaved={() => setAddingLine(false)}
              onCancel={() => setAddingLine(false)}
            />
          )}

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
              No products yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((item) => (
                <OrderLineRow
                  key={item.id}
                  item={item}
                  product={productMap.get(item.productId)}
                  short={shortProductIds.has(item.productId)}
                  resolveProductPrice={resolveProductPrice}
                  links={linksByItemId.get(item.id!) ?? []}
                  plansById={plansById}
                  allPlanStepStatuses={allPlanStepStatuses}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Packaging lines */}
        <OrderPackagingSection
          orderId={orderId}
          packaging={packaging}
          packagingUnitCost={packagingUnitCost}
        />

        {/* Inline production schedule */}
        <OrderScheduleSection
          scheduleByDay={scheduleByDay}
          productNameById={productMap}
          hasAnySchedule={orderSchedule.length > 0}
        />

        {/* Delete */}
        <section className="pt-4 border-t border-border">
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-2 text-sm text-destructive hover:underline"
            >
              <Trash2 className="w-4 h-4" /> Delete order
            </button>
          ) : (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-3">
              <p className="text-sm font-medium text-destructive">Delete this order?</p>
              <p className="text-xs text-muted-foreground">
                All line items will be removed. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button onClick={handleDelete} className="rounded-full bg-destructive text-white px-4 py-2 text-sm font-medium">
                  Yes, delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="rounded-full border border-border px-4 py-2 text-sm">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function OrderEditForm({ order, onSaved, onCancel }: {
  order: {
    id?: string; channel: OrderChannel; customerName?: string; customerId?: string;
    eventName?: string; deadline: string; priority: OrderPriority; status: OrderStatus;
    notes?: string; pricePaid?: number;
    deliveryType?: DeliveryType; deliveryAt?: string;
    deliveryAddress?: string; deliveryNotes?: string;
  };
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [channel, setChannel] = useState<OrderChannel>(order.channel);
  const [customerId, setCustomerId] = useState<string>(order.customerId ?? "");
  const [customerName, setCustomerName] = useState(order.customerName ?? "");
  const [eventName, setEventName] = useState(order.eventName ?? "");
  const [deadline, setDeadline] = useState(toLocalDatetime(order.deadline));
  const [priority, setPriority] = useState<OrderPriority>(order.priority);
  const [notes, setNotes] = useState(order.notes ?? "");
  const [deliveryType, setDeliveryType] = useState<DeliveryType | "">(order.deliveryType ?? "");
  const [deliveryAt, setDeliveryAt] = useState(order.deliveryAt ? toLocalDatetime(order.deliveryAt) : "");
  const [deliveryAddress, setDeliveryAddress] = useState(order.deliveryAddress ?? "");
  const [deliveryNotes, setDeliveryNotes] = useState(order.deliveryNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const customers = useCustomers(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerListOpen, setCustomerListOpen] = useState(false);
  const [addingCustomer, setAddingCustomer] = useState(false);

  const customerMatches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return customers.slice(0, 20);
    return customers
      .filter((c) =>
        c.companyName.toLowerCase().includes(q)
        || (c.contactName ?? "").toLowerCase().includes(q)
        || (c.email ?? "").toLowerCase().includes(q)
        || (c.phone ?? "").toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [customers, customerQuery]);

  /** Pick a customer and preload any useful defaults onto the order form.
   *  Per spec: channel (from type), deliveryType (from defaultDeliveryMethod),
   *  deliveryAddress (from address, only when delivery/ship). We never
   *  overwrite a field the user has already changed by hand — preload
   *  is for empty fields only. */
  function pickCustomer(c: Customer) {
    setCustomerId(c.id!);
    setCustomerName(c.companyName);
    setCustomerQuery("");
    setCustomerListOpen(false);
    // Channel inference: B2B customer defaults to 'b2b', private to 'online'.
    if (!order.customerId && c.type === "b2b" && channel === "online") setChannel("b2b");
    if (!order.customerId && c.type === "private" && channel === "b2b") setChannel("online");
    // Fulfilment preloads — only when the order's fulfilment fields are
    // still empty (don't clobber user-entered data on re-pick).
    if (!deliveryType && c.defaultDeliveryMethod) setDeliveryType(c.defaultDeliveryMethod);
    if (!deliveryAddress && c.address && (c.defaultDeliveryMethod === "delivery" || c.defaultDeliveryMethod === "ship")) {
      setDeliveryAddress(c.address);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      await saveOrder({
        id: order.id,
        channel,
        customerId: customerId || undefined,
        customerName: customerName.trim() || undefined,
        eventName: channel === "event" && eventName.trim() ? eventName.trim() : undefined,
        deadline: new Date(deadline).toISOString(),
        priority,
        status: order.status,
        notes: notes.trim() || undefined,
        pricePaid: order.pricePaid,
        deliveryType: deliveryType === "" ? undefined : deliveryType,
        deliveryAt: deliveryAt ? new Date(deliveryAt).toISOString() : undefined,
        deliveryAddress: deliveryAddress.trim() || undefined,
        deliveryNotes: deliveryNotes.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      const raw: { message?: string; code?: string; details?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      setSaveError(`${raw.message || raw.details || "Save failed"}${code}`);
      console.error("saveOrder failed:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
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

      <div className="relative">
        <label className="label flex items-center gap-2">
          Customer
          {customerId && (
            (() => {
              const c = customers.find((x) => x.id === customerId);
              if (!c) return null;
              const miss = computeMissingRequiredCustomerFields(c);
              return miss.length > 0 ? (
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-status-warn text-white text-[10px] font-bold"
                  title={`Missing on customer: ${miss.join(", ")}`}
                >{miss.length}</span>
              ) : null;
            })()
          )}
        </label>
        {customerId ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-sm">
              {customerName || "(linked)"}
            </div>
            <button
              onClick={() => { setCustomerId(""); setCustomerName(""); setCustomerListOpen(true); }}
              className="text-xs text-primary hover:underline"
            >
              Change
            </button>
          </div>
        ) : (
          <>
            <input
              type="text"
              value={customerQuery || customerName}
              onChange={(e) => {
                setCustomerQuery(e.target.value);
                setCustomerName(e.target.value);
                setCustomerListOpen(true);
              }}
              onFocus={() => setCustomerListOpen(true)}
              placeholder="Search or type a one-off name"
              className="input"
              autoComplete="off"
            />
            {customerListOpen && (
              <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border border-border bg-card shadow-lg max-h-64 overflow-y-auto">
                {customerMatches.map((c) => {
                  const miss = computeMissingRequiredCustomerFields(c);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => pickCustomer(c)}
                      className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm hover:bg-muted"
                    >
                      <span className="flex-1 min-w-0">
                        <span className="font-medium">{c.companyName}</span>
                        {c.type && <span className="ml-2 text-[10px] uppercase text-muted-foreground">{CUSTOMER_TYPE_LABELS[c.type]}</span>}
                        {c.contactName && <span className="text-xs text-muted-foreground block truncate">{c.contactName}{c.email ? ` · ${c.email}` : ""}</span>}
                      </span>
                      {miss.length > 0 && (
                        <span className="text-[10px] text-status-warn inline-flex items-center gap-0.5">
                          <AlertTriangle className="w-3 h-3" /> {miss.length}
                        </span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={async () => {
                    const name = customerQuery.trim();
                    // Quick-add path: if the user has typed a name that
                    // doesn't match any existing customer, create one
                    // right now with just companyName — the remaining
                    // fields (type, contacts, address) can be filled in
                    // later from /customers. Keeps the order entry fast
                    // and matches the "type → save" reflex.
                    if (name) {
                      const id = await saveCustomer({ companyName: name, tags: [] });
                      pickCustomer({ id, companyName: name, tags: [] } as Customer);
                      setCustomerListOpen(false);
                    } else {
                      setAddingCustomer(true);
                      setCustomerListOpen(false);
                    }
                  }}
                  className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm border-t border-border bg-muted/40 hover:bg-muted text-primary font-medium"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {customerQuery.trim() ? `+ Add "${customerQuery.trim()}" as customer` : "+ New customer with details…"}
                </button>
              </div>
            )}
          </>
        )}
        {addingCustomer && (
          <InlineNewCustomer
            initialName={customerQuery.trim() || customerName.trim()}
            onCreated={(c) => { setAddingCustomer(false); pickCustomer(c); }}
            onCancel={() => setAddingCustomer(false)}
          />
        )}
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Pick for CRM tracking + price / preference preload.
          {" "}<Link href="/customers" className="text-primary hover:underline">Manage customers →</Link>
        </p>
      </div>

      {channel === "event" && (
        <div>
          <label className="label">Event name</label>
          <input type="text" value={eventName} onChange={(e) => setEventName(e.target.value)} className="input" />
        </div>
      )}

      <div>
        <label className="label">Deadline</label>
        <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} className="input" />
      </div>

      <div>
        <label className="label">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="input resize-none" />
      </div>

      <div className="pt-2 border-t border-border space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fulfilment</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Type</label>
            <select
              value={deliveryType}
              onChange={(e) => setDeliveryType(e.target.value as DeliveryType | "")}
              className="input"
            >
              <option value="">— none —</option>
              {DELIVERY_TYPES.map((t) => (
                <option key={t} value={t}>{DELIVERY_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Date / time</label>
            <input
              type="datetime-local"
              value={deliveryAt}
              onChange={(e) => setDeliveryAt(e.target.value)}
              className="input"
            />
          </div>
        </div>
        {(deliveryType === "delivery" || deliveryType === "ship") && (
          <div>
            <label className="label">Address</label>
            <textarea
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              rows={2}
              className="input resize-none"
            />
          </div>
        )}
        {deliveryType !== "" && (
          <div>
            <label className="label">Delivery notes</label>
            <input
              type="text"
              value={deliveryNotes}
              onChange={(e) => setDeliveryNotes(e.target.value)}
              placeholder="Gate code, buzzer, courier preference…"
              className="input"
            />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-border px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
      {saveError && (
        <p className="text-xs text-status-alert pt-1">{saveError}</p>
      )}
    </div>
  );
}

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
  // `productInputRef` is kept so the field autofocuses on mount but is
  // no longer re-focused post-save (the panel closes instead).
  void productInputRef;

  const matches = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    const active = products.filter((p) => p.id && !p.archived);
    if (!q) return active.slice(0, 20);
    return active.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 20);
  }, [products, productQuery]);

  // When the user picks a product, pre-fill the net unit price from the
  // pricing hierarchy so they can save-and-go. They can still override
  // per line before clicking Add.
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
        // fulfilmentMode is required — saveOrderItem throws without it.
        fulfilmentMode,
      });
      // One-shot add: close the panel after a successful save instead
      // of re-opening the picker and looping. The user clicks + again
      // when they want another line — fewer "how do I get out of this?"
      // moments. The AddOrderLine panel dismounts here.
      onSaved();
    } catch (err) {
      const raw: { message?: string; code?: string; details?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      setSaveError(`${raw.message || raw.details || "Save failed"}${code}`);
      console.error("saveOrderItem failed:", err);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 mb-2">
      <div className="grid grid-cols-6 gap-2">
        <div className="col-span-3 relative">
          <input
            ref={productInputRef}
            type="text"
            value={productQuery}
            onChange={(e) => {
              setProductQuery(e.target.value);
              setProductId("");
              setPickerOpen(true);
            }}
            onFocus={() => setPickerOpen(true)}
            placeholder="Search product…"
            className="input"
            autoFocus
            autoComplete="off"
          />
          {pickerOpen && matches.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border border-border bg-card shadow-lg max-h-56 overflow-y-auto">
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
        <div>
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) { e.preventDefault(); handleAdd(); } }}
            placeholder="Qty"
            className="input"
          />
        </div>
        <div className="col-span-2">
          <input
            type="number" min={0} step={0.01}
            value={unitPriceInput}
            onChange={(e) => setUnitPriceInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) { e.preventDefault(); handleAdd(); } }}
            placeholder="€ net / unit"
            className="input"
          />
        </div>
      </div>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSave) { e.preventDefault(); handleAdd(); }
        }}
        placeholder="Line notes (optional)"
        className="input"
      />

      {/* Stock source — must be an explicit choice. No silent
          Take-from-Stock; the old auto-decide was the bug. */}
      {productId && (
        <div className="flex items-center gap-3 flex-wrap text-xs pt-1">
          <span className="text-muted-foreground">
            Stock available: <span className="font-medium tabular-nums text-foreground">{available}</span>
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFulfilmentMode("borrow")}
              disabled={available === 0}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
                fulfilmentMode === "borrow"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              Take from stock
            </button>
            <button
              type="button"
              onClick={() => setFulfilmentMode("produce")}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
                fulfilmentMode === "produce"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              Produce fresh
            </button>
          </div>
          {!fulfilmentMode && (
            <span className="text-status-warn">Pick one</span>
          )}
          {fulfilmentMode === "borrow" && !isNaN(qty) && qty > available && (
            <span className="text-status-warn">
              Only {available} available — rest rolls back to Produce on save.
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={handleAdd} disabled={!canSave} className="rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50">
          {saving ? "Adding…" : "Add"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-border px-3 py-1 text-xs">
          Cancel
        </button>
      </div>
      {saveError && (
        <p className="text-xs text-status-alert">{saveError}</p>
      )}
    </div>
  );
}

function OrderLineRow({ item, product, short, resolveProductPrice, links, plansById, allPlanStepStatuses }: {
  item: OrderItem;
  product?: { id?: string; name: string; defaultVatRate?: number };
  short: boolean;
  resolveProductPrice: (productId: string) => ReturnType<typeof resolveUnitPrice>;
  links: OrderPlanLink[];
  plansById: Map<string, ProductionPlan>;
  allPlanStepStatuses: import("@/types").PlanStepStatus[];
}) {
  const productName = product?.name ?? item.productId;
  const [pendingRemove, setPendingRemove] = useState(false);
  const [editingQty, setEditingQty] = useState(false);
  const [qtyInput, setQtyInput] = useState(String(item.quantity));
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(item.unitPrice != null ? String(item.unitPrice) : "");
  const [editingVat, setEditingVat] = useState(false);
  const [vatInput, setVatInput] = useState(item.vatRate != null ? String(item.vatRate) : "");
  const [saveError, setSaveError] = useState("");
  const [switchingMode, setSwitchingMode] = useState(false);

  // Resolved unit price — shown as placeholder hint when the line
  // doesn't have its own. Stored per line as `unitPrice`; empty means
  // "fall back to resolved at display time".
  const resolved = resolveProductPrice(item.productId);
  const effectiveUnitPrice = item.unitPrice ?? resolved.unitPrice;
  const effectiveVat = effectiveVatRate(item.vatRate, product?.defaultVatRate);
  const lineTotalNet = effectiveUnitPrice != null
    ? Math.round(effectiveUnitPrice * item.quantity * 100) / 100
    : null;

  async function handleDelete() {
    if (!item.id) return;
    await deleteOrderItem(item.id);
  }

  async function persistLine(patch: Partial<OrderItem>) {
    if (!item.id) return;
    setSaveError("");
    try {
      await saveOrderItem({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        quantity: item.quantity,
        sortOrder: item.sortOrder,
        notes: item.notes,
        fulfilmentMode: item.fulfilmentMode,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        ...patch,
      });
    } catch (err) {
      const raw: { message?: string; code?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      setSaveError(`${raw.message || "Save failed"}${code}`);
    }
  }

  async function commitQty() {
    const n = parseInt(qtyInput, 10);
    if (!Number.isFinite(n) || n <= 0) { setQtyInput(String(item.quantity)); setEditingQty(false); return; }
    if (n === item.quantity) { setEditingQty(false); return; }
    await persistLine({ quantity: n });
    setEditingQty(false);
  }

  async function commitPrice() {
    const trimmed = priceInput.trim();
    const next = trimmed === "" ? undefined : parseFloat(trimmed);
    if (next !== undefined && (!Number.isFinite(next) || next < 0)) {
      setPriceInput(item.unitPrice != null ? String(item.unitPrice) : "");
      setEditingPrice(false);
      return;
    }
    await persistLine({ unitPrice: next });
    setEditingPrice(false);
  }

  async function commitVat() {
    const trimmed = vatInput.trim();
    const next = trimmed === "" ? undefined : parseFloat(trimmed);
    if (next !== undefined && (!Number.isFinite(next) || next < 0 || next > 100)) {
      setVatInput(item.vatRate != null ? String(item.vatRate) : "");
      setEditingVat(false);
      return;
    }
    await persistLine({ vatRate: next });
    setEditingVat(false);
  }

  async function toggleFulfilmentMode() {
    if (!item.id) return;
    const next = item.fulfilmentMode === "borrow" ? "produce" : "borrow";
    setSwitchingMode(true);
    setSaveError("");
    try {
      // Saving an existing line with a different fulfilmentMode does not
      // re-run the auto-decision. To move an existing line into 'borrow'
      // we need to also allocate — simplest path: delete + re-add so
      // saveOrderItem's new-line flow handles the allocation.
      if (next === "borrow") {
        await deleteOrderItem(item.id);
        await saveOrderItem({
          orderId: item.orderId,
          productId: item.productId,
          quantity: item.quantity,
          sortOrder: item.sortOrder,
          notes: item.notes,
          fulfilmentMode: "borrow",
        });
      } else {
        // Going borrow → produce: delete (releases the allocation) + re-add as produce.
        await deleteOrderItem(item.id);
        await saveOrderItem({
          orderId: item.orderId,
          productId: item.productId,
          quantity: item.quantity,
          sortOrder: item.sortOrder,
          notes: item.notes,
          fulfilmentMode: "produce",
        });
      }
    } catch (err) {
      const raw: { message?: string; code?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      setSaveError(raw.message || "Mode switch failed");
    } finally {
      setSwitchingMode(false);
    }
  }

  const isBorrow = item.fulfilmentMode === "borrow";
  // Feasibility dot: red if this line's qty can't be satisfied even
  // with producible-before-deadline; green if it fits. Borrow lines
  // are always fine by definition — they're allocated from Store.
  const feasibilityColor = isBorrow
    ? "bg-primary"
    : short ? "bg-status-alert" : "bg-status-ok";

  return (
    <li className={`rounded-lg border px-3 py-2.5 ${isBorrow ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-3">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${feasibilityColor}`}
          title={isBorrow ? "From Store stock" : short ? "Won't fit by deadline" : "Fits within capacity"}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {productName}
            {isBorrow && (
              <span className="ml-2 text-[10px] uppercase tracking-wide text-primary bg-primary/15 rounded px-1.5 py-0.5 align-middle">
                From Store
              </span>
            )}
          </p>
          {item.notes && <p className="text-xs text-muted-foreground truncate">{item.notes}</p>}
          <button
            onClick={toggleFulfilmentMode}
            disabled={switchingMode}
            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline mt-0.5 disabled:opacity-50"
          >
            {switchingMode ? "Switching…" : isBorrow ? "Produce fresh" : "Use from stock"}
          </button>
        </div>

        {/* Unit price (net) */}
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Net / unit</p>
          {editingPrice ? (
            <input
              type="number" min={0} step={0.01}
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { setPriceInput(item.unitPrice != null ? String(item.unitPrice) : ""); setEditingPrice(false); }
              }}
              autoFocus
              placeholder={resolved.unitPrice != null ? resolved.unitPrice.toFixed(2) : "—"}
              className="input !w-20 !text-sm text-right"
            />
          ) : (
            <button
              onClick={() => { setPriceInput(item.unitPrice != null ? String(item.unitPrice) : ""); setEditingPrice(true); }}
              className="text-sm font-medium tabular-nums rounded px-1 hover:bg-muted"
              title={`From ${resolved.source === "none" ? "— no price" : resolved.source}`}
            >
              {effectiveUnitPrice != null ? `€${effectiveUnitPrice.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
              {item.unitPrice == null && resolved.unitPrice != null && (
                <span className="ml-1 text-[9px] text-muted-foreground uppercase">auto</span>
              )}
            </button>
          )}
        </div>

        {/* VAT */}
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wide">VAT</p>
          {editingVat ? (
            <input
              type="number" min={0} max={100} step={0.5}
              value={vatInput}
              onChange={(e) => setVatInput(e.target.value)}
              onBlur={commitVat}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { setVatInput(item.vatRate != null ? String(item.vatRate) : ""); setEditingVat(false); }
              }}
              autoFocus
              placeholder={String(effectiveVat)}
              className="input !w-14 !text-sm text-right"
            />
          ) : (
            <button
              onClick={() => { setVatInput(item.vatRate != null ? String(item.vatRate) : ""); setEditingVat(true); }}
              className="text-sm tabular-nums rounded px-1 hover:bg-muted"
            >
              {effectiveVat}%
              {item.vatRate == null && <span className="ml-0.5 text-[9px] text-muted-foreground uppercase">d</span>}
            </button>
          )}
        </div>

        {/* Qty */}
        {editingQty ? (
          <input
            type="number"
            min="1"
            step="1"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            onBlur={commitQty}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.currentTarget.blur(); }
              if (e.key === "Escape") { setQtyInput(String(item.quantity)); setEditingQty(false); }
            }}
            autoFocus
            className="input !w-16 text-sm text-right"
          />
        ) : (
          <button
            onClick={() => { setQtyInput(String(item.quantity)); setEditingQty(true); }}
            className="text-sm font-medium tabular-nums shrink-0 rounded px-2 py-0.5 hover:bg-muted transition-colors"
            title="Click to edit quantity"
          >
            {item.quantity}
          </button>
        )}

        {/* Line total */}
        <div className="text-right shrink-0 w-20">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Total</p>
          <p className="text-sm font-semibold tabular-nums">
            {lineTotalNet != null ? `€${lineTotalNet.toFixed(2)}` : "—"}
          </p>
        </div>

        {pendingRemove ? (
          <span className="flex items-center gap-1.5 text-xs shrink-0">
            <button onClick={handleDelete} className="text-red-600 font-medium hover:underline">Yes</button>
            <button onClick={() => setPendingRemove(false)} className="text-muted-foreground hover:underline">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setPendingRemove(true)} className="text-muted-foreground/50 hover:text-destructive shrink-0" aria-label="Remove line">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {saveError && <p className="text-[11px] text-status-alert mt-1">{saveError}</p>}

      {/* Linked batches — populated by Regenerate plan, NOT on order
          save. Borrow lines don't get batches (they fulfil from
          stock). Each row shows "N from <batch> (Step N/8 Label)"
          where the step label is the batch's current phase. */}
      {links.length > 0 && (
        <ul className="mt-2 space-y-1 pl-3 border-l-2 border-border">
          {links.map((lk) => {
            const plan = plansById.get(lk.planId);
            const status = plan?.status ?? "draft";
            const progress = plan
              ? batchPhaseProgress(plan.id!, allPlanStepStatuses)
              : null;
            const batchLabel = plan?.batchNumber || plan?.name || "batch";
            return (
              <li key={lk.id ?? lk.planId} className="flex items-center gap-2 text-[11px] flex-wrap">
                <span className="text-muted-foreground shrink-0">└─</span>
                <span className="tabular-nums font-medium">{lk.allocatedQuantity}</span>
                <span className="text-muted-foreground">from</span>
                {plan ? (
                  <Link
                    href={`/production/${encodeURIComponent(plan.id!)}`}
                    className="font-medium hover:underline truncate max-w-[30ch]"
                  >
                    {batchLabel}
                  </Link>
                ) : (
                  <span className="text-muted-foreground italic">Batch missing</span>
                )}
                {progress && (
                  <span className="text-muted-foreground tabular-nums">
                    (Step {progress.index}/{progress.total} {progress.label})
                  </span>
                )}
                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${PLAN_STATUS_STYLE[status]}`}>
                  {PLAN_STATUS_LABEL[status]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

const PLAN_STATUS_LABEL: Record<ProductionPlan["status"], string> = {
  draft: "Pending",
  active: "In production",
  done: "Done",
  cancelled: "Cancelled",
  orphaned: "Orphaned",
};

const PLAN_STATUS_STYLE: Record<ProductionPlan["status"], string> = {
  draft: "bg-muted text-muted-foreground border-border",
  active: "bg-status-warn-bg text-status-warn border-status-warn-edge",
  done: "bg-status-ok-bg text-status-ok border-status-ok-edge",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  orphaned: "bg-status-alert-bg text-status-alert border-status-alert-edge",
};

// ─── Packaging section ──────────────────────────────────────────

function OrderPackagingSection({ orderId, packaging, packagingUnitCost }: {
  orderId: string;
  packaging: Packaging[];
  packagingUnitCost: Map<string, number>;
}) {
  const lines = useOrderPackagingLines(orderId);
  const packagingById = useMemo(() => new Map(packaging.map((p) => [p.id!, p])), [packaging]);
  const [adding, setAdding] = useState(false);
  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-primary flex items-center gap-1.5">
          <Package className="w-4 h-4" /> Packaging ({lines.length})
        </h2>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-xs text-primary hover:underline"
          >
            <Plus className="w-3.5 h-3.5" /> Add packaging
          </button>
        )}
      </div>
      {adding && (
        <AddOrderPackagingLine
          orderId={orderId}
          nextSortOrder={lines.length}
          packaging={packaging.filter((p) => !p.archived)}
          packagingUnitCost={packagingUnitCost}
          onCancel={() => setAdding(false)}
        />
      )}
      {lines.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
          No packaging lines. Add ribbons, gift bags, outer boxes, etc.
        </p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line) => (
            <OrderPackagingLineRow
              key={line.id}
              line={line}
              packagingItem={packagingById.get(line.packagingId)}
              latestCost={packagingUnitCost.get(line.packagingId)}
            />
          ))}
        </ul>
      )}
    </section>
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
  const inputRef = useRef<HTMLInputElement>(null);

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
      setPackagingId("");
      setPackagingQuery("");
      setPickerOpen(true);
      setQuantity("1");
      setUnitPriceInput("");
      setNotes("");
      setAddedCount((n) => n + 1);
      inputRef.current?.focus();
    } catch (err) {
      const raw: { message?: string; code?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      setSaveError(`${raw.message || "Save failed"}${code}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 mb-2">
      <div className="grid grid-cols-6 gap-2">
        <div className="col-span-3 relative">
          <input
            ref={inputRef}
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
            <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border border-border bg-card shadow-lg max-h-56 overflow-y-auto">
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
        <div>
          <input
            type="number" min="1" step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) { e.preventDefault(); handleAdd(); } }}
            placeholder="Qty"
            className="input"
          />
        </div>
        <div className="col-span-2">
          <input
            type="number" min={0} step={0.01}
            value={unitPriceInput}
            onChange={(e) => setUnitPriceInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) { e.preventDefault(); handleAdd(); } }}
            placeholder="€ net / unit"
            className="input"
          />
        </div>
      </div>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSave) { e.preventDefault(); handleAdd(); }
        }}
        placeholder="Line notes (optional)"
        className="input"
      />
      <div className="flex items-center gap-2">
        <button onClick={handleAdd} disabled={!canSave} className="rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50">
          {saving ? "Adding…" : "Add"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-border px-3 py-1 text-xs">
          Done
        </button>
        {addedCount > 0 && (
          <span className="text-[11px] text-muted-foreground">
            {addedCount} line{addedCount === 1 ? "" : "s"} added
          </span>
        )}
      </div>
      {saveError && <p className="text-xs text-status-alert">{saveError}</p>}
    </div>
  );
}

function OrderPackagingLineRow({ line, packagingItem, latestCost }: {
  line: OrderPackagingLine;
  packagingItem?: Packaging;
  latestCost?: number;
}) {
  const packagingName = packagingItem?.name ?? line.packagingId;
  const [pendingRemove, setPendingRemove] = useState(false);
  const [editingQty, setEditingQty] = useState(false);
  const [qtyInput, setQtyInput] = useState(String(line.quantity));
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(line.unitPrice != null ? String(line.unitPrice) : "");
  const [editingVat, setEditingVat] = useState(false);
  const [vatInput, setVatInput] = useState(line.vatRate != null ? String(line.vatRate) : "");
  const [saveError, setSaveError] = useState("");

  const effectiveUnitPrice = line.unitPrice ?? latestCost;
  const effectiveVat = effectiveVatRate(line.vatRate, packagingItem?.defaultVatRate);
  const lineTotalNet = effectiveUnitPrice != null
    ? Math.round(effectiveUnitPrice * line.quantity * 100) / 100
    : null;

  async function handleDelete() {
    if (!line.id) return;
    await deleteOrderPackagingLine(line.id);
  }

  async function persistLine(patch: Partial<OrderPackagingLine>) {
    if (!line.id) return;
    setSaveError("");
    try {
      await saveOrderPackagingLine({
        id: line.id,
        orderId: line.orderId,
        packagingId: line.packagingId,
        quantity: line.quantity,
        sortOrder: line.sortOrder,
        notes: line.notes,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        ...patch,
      });
    } catch (err) {
      const raw: { message?: string; code?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      setSaveError(`${raw.message || "Save failed"}`);
    }
  }

  async function commitQty() {
    const n = parseInt(qtyInput, 10);
    if (!Number.isFinite(n) || n <= 0) { setQtyInput(String(line.quantity)); setEditingQty(false); return; }
    if (n === line.quantity) { setEditingQty(false); return; }
    await persistLine({ quantity: n });
    setEditingQty(false);
  }

  async function commitPrice() {
    const next = priceInput.trim() === "" ? undefined : parseFloat(priceInput);
    if (next !== undefined && (!Number.isFinite(next) || next < 0)) {
      setPriceInput(line.unitPrice != null ? String(line.unitPrice) : "");
      setEditingPrice(false);
      return;
    }
    await persistLine({ unitPrice: next });
    setEditingPrice(false);
  }

  async function commitVat() {
    const next = vatInput.trim() === "" ? undefined : parseFloat(vatInput);
    if (next !== undefined && (!Number.isFinite(next) || next < 0 || next > 100)) {
      setVatInput(line.vatRate != null ? String(line.vatRate) : "");
      setEditingVat(false);
      return;
    }
    await persistLine({ vatRate: next });
    setEditingVat(false);
  }

  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{packagingName}</p>
          {line.notes && <p className="text-xs text-muted-foreground truncate">{line.notes}</p>}
        </div>

        {/* Net / unit */}
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Net / unit</p>
          {editingPrice ? (
            <input
              type="number" min={0} step={0.01}
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onBlur={commitPrice}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { setPriceInput(line.unitPrice != null ? String(line.unitPrice) : ""); setEditingPrice(false); }
              }}
              autoFocus
              placeholder={latestCost != null ? latestCost.toFixed(2) : "—"}
              className="input !w-20 !text-sm text-right"
            />
          ) : (
            <button
              onClick={() => { setPriceInput(line.unitPrice != null ? String(line.unitPrice) : ""); setEditingPrice(true); }}
              className="text-sm font-medium tabular-nums rounded px-1 hover:bg-muted"
              title={line.unitPrice == null ? "Auto — latest purchase cost" : "Per-line override"}
            >
              {effectiveUnitPrice != null ? `€${effectiveUnitPrice.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
              {line.unitPrice == null && latestCost != null && (
                <span className="ml-1 text-[9px] text-muted-foreground uppercase">auto</span>
              )}
            </button>
          )}
        </div>

        {/* VAT */}
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wide">VAT</p>
          {editingVat ? (
            <input
              type="number" min={0} max={100} step={0.5}
              value={vatInput}
              onChange={(e) => setVatInput(e.target.value)}
              onBlur={commitVat}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") { setVatInput(line.vatRate != null ? String(line.vatRate) : ""); setEditingVat(false); }
              }}
              autoFocus
              placeholder={String(effectiveVat)}
              className="input !w-14 !text-sm text-right"
            />
          ) : (
            <button
              onClick={() => { setVatInput(line.vatRate != null ? String(line.vatRate) : ""); setEditingVat(true); }}
              className="text-sm tabular-nums rounded px-1 hover:bg-muted"
            >
              {effectiveVat}%
              {line.vatRate == null && <span className="ml-0.5 text-[9px] text-muted-foreground uppercase">d</span>}
            </button>
          )}
        </div>

        {editingQty ? (
          <input
            type="number"
            min="1"
            step="1"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            onBlur={commitQty}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") { setQtyInput(String(line.quantity)); setEditingQty(false); }
            }}
            autoFocus
            className="input !w-16 text-sm text-right"
          />
        ) : (
          <button
            onClick={() => { setQtyInput(String(line.quantity)); setEditingQty(true); }}
            className="text-sm font-medium tabular-nums shrink-0 rounded px-2 py-0.5 hover:bg-muted transition-colors"
            title="Click to edit quantity"
          >
            {line.quantity}
          </button>
        )}

        {/* Line total */}
        <div className="text-right shrink-0 w-20">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wide">Total</p>
          <p className="text-sm font-semibold tabular-nums">
            {lineTotalNet != null ? `€${lineTotalNet.toFixed(2)}` : "—"}
          </p>
        </div>
        {pendingRemove ? (
          <span className="flex items-center gap-1.5 text-xs shrink-0">
            <button onClick={handleDelete} className="text-red-600 font-medium hover:underline">Yes</button>
            <button onClick={() => setPendingRemove(false)} className="text-muted-foreground hover:underline">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setPendingRemove(true)} className="text-muted-foreground/50 hover:text-destructive shrink-0" aria-label="Remove line">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
      {saveError && <p className="text-[11px] text-status-alert mt-1">{saveError}</p>}
    </li>
  );
}

// ─── Summary card (labour / price / feasibility) ───────────────

function OrderSummaryCard({
  order, labour, calculatedCost, feasibility, labourHourlyRate, productNameById,
  productsSubtotalNet, packagingSubtotalNet, totalNet, totalVat, totalGross,
  vatBreakdown, margin,
}: {
  order: import("@/types").Order;
  labour: ReturnType<typeof computeOrderLabourHours>;
  calculatedCost: ReturnType<typeof computeOrderCalculatedCost>;
  feasibility: ReturnType<typeof checkOrderFeasibility>;
  labourHourlyRate: number | null;
  productNameById: Map<string, { name: string }>;
  productsSubtotalNet: number;
  packagingSubtotalNet: number;
  totalNet: number;
  totalVat: number;
  totalGross: number;
  vatBreakdown: VatBreakdown[];
  margin: ReturnType<typeof computeOrderMargin>;
}) {
  const sevColor =
    feasibility.severity === "green"
      ? "border-status-ok/40 bg-status-ok/5 text-status-ok"
      : feasibility.severity === "yellow"
        ? "border-status-warn/40 bg-status-warn/5 text-status-warn"
        : "border-status-alert/40 bg-status-alert/5 text-status-alert";

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Customer-facing totals */}
      <div className="space-y-1.5">
        <TotalLine label="Products (net)" value={productsSubtotalNet} />
        <TotalLine label="Packaging (net)" value={packagingSubtotalNet} />
        <TotalLine label="Subtotal (net)" value={totalNet} emphasis />
        {vatBreakdown.length === 0 ? (
          <TotalLine label="VAT (10%)" value={0} muted />
        ) : (
          vatBreakdown.map((b) => (
            <TotalLine key={b.rate} label={`VAT ${b.rate}%`} value={b.vat} muted />
          ))
        )}
        <div className="border-t border-border pt-1.5">
          <TotalLine label="Total (gross)" value={totalGross} emphasis />
        </div>
      </div>

      {/* Price paid — toggles net / gross */}
      <div className="pt-2 border-t border-border">
        <PricePaidField
          order={order}
          suggestedNet={totalNet > 0 ? totalNet : undefined}
          suggestedGross={totalGross > 0 ? totalGross : undefined}
          vatBreakdown={vatBreakdown}
        />
      </div>

      {/* Internal cost + labour + margin (never shown to customer) */}
      <div className="pt-2 border-t border-border space-y-1.5">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
          Internal (not on invoice)
        </p>
        <TotalLine
          label="Labour"
          value={calculatedCost.labourCost}
          hint={labourHourlyRate == null ? "set rate in Settings" : `${labour.totalHours}h @ €${labourHourlyRate.toFixed(2)}`}
          muted
        />
        <TotalLine label="Total cost (ingredients + packaging + labour)" value={calculatedCost.totalCost} muted />
        <div className="border-t border-border pt-1.5 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Margin</span>
          <span className={`tabular-nums font-semibold ${
            margin.marginPercent == null
              ? "text-muted-foreground"
              : margin.marginPercent < 0
                ? "text-status-alert"
                : margin.marginPercent < 20
                  ? "text-status-warn"
                  : "text-status-ok"
          }`}>
            {order.pricePaid == null ? "—" : (
              margin.marginPercent == null ? "—" : `${margin.marginPercent.toFixed(0)}% · €${margin.profit.toFixed(2)}`
            )}
          </span>
        </div>
      </div>

      {/* Feasibility. Green case is an informational single-line pill
          (no alarm icon). Yellow / red keep the AlertTriangle and the
          multi-line shortfall breakdown. */}
      {feasibility.severity === "green" ? (
        <div className={`rounded-md border px-3 py-1.5 flex items-center gap-2 text-xs ${sevColor}`}>
          <Check className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium">{feasibility.summary}</span>
          <span className="opacity-70">
            · {feasibility.availableHours}h available · {feasibility.freeHours}h free · {labour.totalHours}h needed
          </span>
        </div>
      ) : (
        <div className={`rounded-md border px-3 py-2 flex items-start gap-2 ${sevColor}`}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{feasibility.summary}</p>
            {feasibility.shortfalls.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {feasibility.shortfalls.map((s) => (
                  <li key={s.productId} className="text-xs">
                    {productNameById.get(s.productId)?.name ?? s.productId}: short by {s.shortPieces} pc
                    {" "}(need {s.required}, have {s.available} on hand, can make {s.producible})
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] opacity-80 mt-1">
              {feasibility.availableHours}h available · {feasibility.freeHours}h free · {labour.totalHours}h needed
            </p>
          </div>
        </div>
      )}
    </div>
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
    <div className={`flex items-center justify-between text-sm ${muted ? "text-muted-foreground" : ""}`}>
      <span className={emphasis ? "font-semibold text-foreground" : ""}>{label}</span>
      <span className="flex items-baseline gap-1.5">
        {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
        <span className={`tabular-nums ${emphasis ? "font-semibold text-foreground" : ""}`}>
          €{value.toFixed(2)}
        </span>
      </span>
    </div>
  );
}

/** Price paid — stored NET on the order. The UI lets the user toggle
 *  between entering net or gross; when the user types gross we back out
 *  net using a blended VAT rate (proportional to each line's net) so
 *  mixed-rate orders round correctly. Stored value is always net. */
function PricePaidField({ order, suggestedNet, suggestedGross, vatBreakdown }: {
  order: import("@/types").Order;
  suggestedNet?: number;
  suggestedGross?: number;
  vatBreakdown: VatBreakdown[];
}) {
  const [mode, setMode] = useState<"net" | "gross">("net");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    order.pricePaid != null ? String(order.pricePaid) : "",
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Blended rate derived from the aggregated VAT rows. When the order
  // has no lines yet, fall back to the app's food default (10%).
  const blendedRate = useMemo(() => {
    const totalNet = vatBreakdown.reduce((s, b) => s + b.net, 0);
    if (totalNet <= 0) return 10;
    const totalVat = vatBreakdown.reduce((s, b) => s + b.vat, 0);
    return (totalVat / totalNet) * 100;
  }, [vatBreakdown]);

  // Derive the display value for the current mode from the stored NET
  // amount. When `editing` is true, `value` holds what the user typed.
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
      try {
        await saveOrder({ ...order, pricePaid: undefined });
        setEditing(false);
      } finally { setSaving(false); }
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setSaveError("Invalid amount");
      return;
    }
    // Convert to net if the user typed gross.
    const net = mode === "net"
      ? parsed
      : computeVatFromGross(parsed, blendedRate).net;
    setSaving(true);
    try {
      await saveOrder({ ...order, pricePaid: Math.round(net * 100) / 100 });
      setEditing(false);
    } catch (err) {
      const raw: { message?: string; code?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      setSaveError(raw.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  const otherDisplay = order.pricePaid != null
    ? `€${displayFor(mode === "net" ? "gross" : "net")} ${mode === "net" ? "gross" : "net"}`
    : "";

  const suggestion = mode === "net" ? suggestedNet : suggestedGross;

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Price paid</p>
        <div className="flex gap-0.5 text-[10px] rounded-full border border-border p-0.5">
          {(["net", "gross"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); if (editing) setValue(displayFor(m)); }}
              className={`px-1.5 py-0 rounded-full uppercase tracking-wide ${
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >{m}</button>
          ))}
        </div>
      </div>
      {editing ? (
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-base font-semibold">€</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") { setValue(displayFor(mode)); setEditing(false); }
            }}
            onBlur={commit}
            autoFocus
            className="input !py-0.5 !text-base !font-semibold !w-28"
            placeholder={suggestion != null ? suggestion.toFixed(2) : "0.00"}
          />
          {suggestion != null && value === "" && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setValue(suggestion.toFixed(2)); }}
              className="text-[10px] text-primary hover:underline"
            >use calc</button>
          )}
        </div>
      ) : (
        <button
          onClick={() => { setValue(displayFor(mode)); setEditing(true); }}
          className="text-base font-semibold tabular-nums hover:bg-muted rounded px-1 -ml-1 mt-0.5 inline-flex items-baseline gap-2"
          title="Click to edit price paid"
        >
          {order.pricePaid != null ? `€${displayFor(mode)}` : <span className="text-muted-foreground">—</span>}
          {otherDisplay && <span className="text-[10px] text-muted-foreground">({otherDisplay})</span>}
        </button>
      )}
      {saving && <p className="text-[11px] text-muted-foreground">Saving…</p>}
      {saveError && <p className="text-[11px] text-status-alert">{saveError}</p>}
    </div>
  );
}

// ─── Production schedule (inline per-day view) ─────────────────

function OrderScheduleSection({
  scheduleByDay, productNameById, hasAnySchedule,
}: {
  scheduleByDay: Map<string, Array<{
    id?: string; phase: string; startAt: string; endAt: string;
    durationMinutes: number; isActive: boolean; productId: string; status: string;
  }>>;
  productNameById: Map<string, { name: string }>;
  hasAnySchedule: boolean;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-primary mb-2 flex items-center gap-1.5">
        <Calendar className="w-4 h-4" /> Production schedule
      </h2>
      {!hasAnySchedule ? (
        <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-lg">
          Not scheduled yet. Open the <Link href="/plan" className="text-primary hover:underline">Plan</Link> to generate production steps for this order.
        </p>
      ) : (
        <div className="space-y-3">
          {Array.from(scheduleByDay.entries()).map(([day, steps]) => {
            const activeMin = steps.filter((s) => s.isActive).reduce((a, s) => a + s.durationMinutes, 0);
            return (
              <div key={day} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium">
                    {new Date(day).toLocaleDateString("en-GB", {
                      weekday: "short", day: "numeric", month: "short",
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {Math.round(activeMin / 6) / 10}h active
                  </p>
                </div>
                <ul className="space-y-1">
                  {steps.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 text-xs">
                      <span className="tabular-nums text-muted-foreground w-11 shrink-0">
                        {s.startAt.slice(11, 16)}
                      </span>
                      <span className={`flex-1 truncate ${s.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                        {productNameById.get(s.productId)?.name ?? s.productId} · {s.phase}
                      </span>
                      <span className="tabular-nums text-muted-foreground shrink-0">
                        {s.durationMinutes}m
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** Compact "+ New customer" form used inline from the order page.
 *  Creates a minimal customer (name, type, phone, email, default
 *  fulfilment) and returns it to the caller, which then runs the
 *  normal preload flow. The customer detail page is one click away
 *  for filling the rest. */
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
      // saveCustomer returns the id; reconstruct the customer shape.
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
      const raw: { message?: string; code?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      setSaveError(raw.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-border bg-card p-3 space-y-2">
      <p className="text-xs font-semibold text-muted-foreground">New customer (quick)</p>
      <input
        value={companyName}
        onChange={(e) => setCompanyName(e.target.value)}
        placeholder="Company / name *"
        className="input text-sm"
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        <select value={type} onChange={(e) => setType(e.target.value as CustomerType | "")} className="input text-sm">
          <option value="">— type —</option>
          {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{CUSTOMER_TYPE_LABELS[t]}</option>)}
        </select>
        <select value={defaultDeliveryMethod} onChange={(e) => setDefaultDeliveryMethod(e.target.value as DeliveryType | "")} className="input text-sm">
          <option value="">— fulfilment —</option>
          {DELIVERY_TYPES.map((t) => <option key={t} value={t}>{DELIVERY_TYPE_LABELS[t]}</option>)}
        </select>
        <input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Contact person" className="input text-sm" />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="input text-sm" />
      </div>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="input text-sm" />
      <div className="flex items-center gap-2">
        <button onClick={handleCreate} disabled={saving || !companyName.trim()}
          className="rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50">
          {saving ? "Creating…" : "Create + link"}
        </button>
        <button onClick={onCancel} className="text-xs text-muted-foreground hover:underline">Cancel</button>
        <p className="text-[10px] text-muted-foreground">Fill the rest from the customer page later.</p>
      </div>
      {saveError && <p className="text-xs text-status-alert">{saveError}</p>}
    </div>
  );
}

/** Convert an ISO timestamp to the local-time string datetime-local inputs expect. */
function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
