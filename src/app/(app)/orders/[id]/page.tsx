"use client";

import { use, useState, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  useOrder, useOrderItems, useProductsList, saveOrder, deleteOrder,
  saveOrderItem, deleteOrderItem, useCustomers,
  usePackagingList, useOrderPackagingLines, saveOrderPackagingLine, deleteOrderPackagingLine,
  useProductActiveMinutesMap, useProductionSchedule, useCapacityConfig,
  usePeople, usePersonUnavailability, useBlockedDays,
  useProductLocationTotals,
  useReplenishmentOrderFor,
} from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { latestPackagingUnitCost } from "@/lib/collectionPricing";
import {
  computeOrderLabourHours, computeOrderCalculatedCost, checkOrderFeasibility,
  type OrderProductLine, type OrderPackagingRollupLine, type ProductStockState,
} from "@/lib/orderRollup";
import {
  ORDER_CHANNELS, ORDER_CHANNEL_LABELS,
  ORDER_PRIORITIES, ORDER_PRIORITY_LABELS,
  ORDER_STATUSES, ORDER_STATUS_LABELS,
  DELIVERY_TYPES, DELIVERY_TYPE_LABELS,
  type OrderChannel, type OrderPriority, type OrderStatus,
  type DeliveryType,
  type Packaging, type OrderPackagingLine,
  type ProductCostSnapshot, type PackagingOrder,
  type OrderItem,
} from "@/types";
import { ArrowLeft, Plus, Trash2, X, Pencil, AlertTriangle, Calendar, Package } from "lucide-react";

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
                View customer profile →
              </Link>
            )}
          </div>
          {!editing && (
            <button onClick={() => setEditing(true)} className="p-1.5 rounded-full hover:bg-muted">
              <Pencil className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

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
          />
        )}

        {/* Line items */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-primary">
              Products ({items.length} · {totalQty} pcs)
            </h2>
            {!addingLine && (
              <button
                onClick={() => setAddingLine(true)}
                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Plus className="w-3.5 h-3.5" /> Add product
              </button>
            )}
          </div>

          {addingLine && (
            <AddOrderLine
              orderId={orderId}
              nextSortOrder={items.length}
              products={products}
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
                  productName={productMap.get(item.productId)?.name ?? item.productId}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Packaging lines */}
        <OrderPackagingSection orderId={orderId} packaging={packaging} />

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

  // When the dropdown picks a customer, mirror the company name into the
  // text field so legacy display code (and non-B2B rows) keeps working.
  function pickCustomer(id: string) {
    setCustomerId(id);
    const c = customers.find((x) => x.id === id);
    if (c) setCustomerName(c.companyName);
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

      <div>
        <label className="label">Customer</label>
        {customers.length > 0 && (
          <select
            value={customerId}
            onChange={(e) => {
              if (e.target.value === "") {
                setCustomerId("");
              } else {
                pickCustomer(e.target.value);
              }
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
          placeholder="Customer / contact name"
          className="input"
        />
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Pick an existing customer for full CRM tracking, or type a one-off name.
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

function AddOrderLine({ orderId, nextSortOrder, products, onCancel }: {
  orderId: string;
  nextSortOrder: number;
  products: { id?: string; name: string }[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [addedCount, setAddedCount] = useState(0);
  const productSelectRef = useRef<HTMLSelectElement>(null);

  const qty = parseInt(quantity, 10);
  const canSave = !!productId && !isNaN(qty) && qty > 0 && !saving;

  async function handleAdd() {
    if (!canSave) return;
    setSaving(true);
    setSaveError("");
    try {
      await saveOrderItem({
        orderId,
        productId,
        // sortOrder bumps by 1 per add so multiple adds stay in the
        // order the user entered them.
        quantity: qty,
        sortOrder: nextSortOrder + addedCount,
        notes: notes.trim() || undefined,
      });
      // Reset the fields and keep the form open so the user can add
      // the next line without re-clicking "Add product". Focus the
      // product select so they can start typing the next product
      // immediately.
      setProductId("");
      setQuantity("1");
      setNotes("");
      setAddedCount((n) => n + 1);
      productSelectRef.current?.focus();
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
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <select
            ref={productSelectRef}
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="input"
            autoFocus
          >
            <option value="">— select product —</option>
            {products.filter((p) => p.id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={(e) => {
              // Enter on the quantity field saves + advances. The user
              // asked for this explicitly — "jump to next line" without
              // having to click Add product again.
              if (e.key === "Enter" && canSave) {
                e.preventDefault();
                handleAdd();
              }
            }}
            placeholder="Qty"
            className="input"
          />
        </div>
      </div>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canSave) {
            e.preventDefault();
            handleAdd();
          }
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
      {saveError && (
        <p className="text-xs text-status-alert">{saveError}</p>
      )}
    </div>
  );
}

function OrderLineRow({ item, productName }: {
  item: OrderItem;
  productName: string;
}) {
  const [pendingRemove, setPendingRemove] = useState(false);
  const [editingQty, setEditingQty] = useState(false);
  const [qtyInput, setQtyInput] = useState(String(item.quantity));
  const [saveError, setSaveError] = useState("");
  const [switchingMode, setSwitchingMode] = useState(false);

  async function handleDelete() {
    if (!item.id) return;
    await deleteOrderItem(item.id);
  }

  async function commitQty() {
    const n = parseInt(qtyInput, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setQtyInput(String(item.quantity));
      setEditingQty(false);
      return;
    }
    if (n === item.quantity) {
      setEditingQty(false);
      return;
    }
    setSaveError("");
    try {
      await saveOrderItem({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        quantity: n,
        sortOrder: item.sortOrder,
        notes: item.notes,
        fulfilmentMode: item.fulfilmentMode,
      });
      setEditingQty(false);
    } catch (err) {
      const raw: { message?: string; code?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      setSaveError(`${raw.message || "Save failed"}${code}`);
      setQtyInput(String(item.quantity));
    }
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

  return (
    <li className={`rounded-lg border px-3 py-2.5 ${isBorrow ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center gap-3">
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
            {switchingMode ? "Switching…" : isBorrow ? "Produce fresh instead" : "Fulfil from Store stock"}
          </button>
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
              if (e.key === "Enter") { e.currentTarget.blur(); }
              if (e.key === "Escape") { setQtyInput(String(item.quantity)); setEditingQty(false); }
            }}
            autoFocus
            className="input !w-20 text-sm text-right"
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

// ─── Packaging section ──────────────────────────────────────────

function OrderPackagingSection({ orderId, packaging }: {
  orderId: string;
  packaging: Packaging[];
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
              packagingName={packagingById.get(line.packagingId)?.name ?? line.packagingId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AddOrderPackagingLine({ orderId, nextSortOrder, packaging, onCancel }: {
  orderId: string;
  nextSortOrder: number;
  packaging: Packaging[];
  onCancel: () => void;
}) {
  const [packagingId, setPackagingId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [saveError, setSaveError] = useState("");
  const selectRef = useRef<HTMLSelectElement>(null);

  const qty = parseInt(quantity, 10);
  const canSave = !!packagingId && Number.isFinite(qty) && qty > 0 && !saving;

  async function handleAdd() {
    if (!canSave) return;
    setSaving(true);
    setSaveError("");
    try {
      await saveOrderPackagingLine({
        orderId,
        packagingId,
        quantity: qty,
        sortOrder: nextSortOrder + addedCount,
        notes: notes.trim() || undefined,
      });
      setPackagingId("");
      setQuantity("1");
      setNotes("");
      setAddedCount((n) => n + 1);
      selectRef.current?.focus();
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
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <select
            ref={selectRef}
            value={packagingId}
            onChange={(e) => setPackagingId(e.target.value)}
            className="input"
            autoFocus
          >
            <option value="">— select packaging —</option>
            {packaging.map((p) => (
              <option key={p.id} value={p.id!}>
                {p.name}
                {p.packingTimePerUnit != null ? ` · ${p.packingTimePerUnit}min/unit` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <input
            type="number"
            min="1"
            step="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSave) { e.preventDefault(); handleAdd(); }
            }}
            placeholder="Qty"
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

function OrderPackagingLineRow({ line, packagingName }: {
  line: OrderPackagingLine;
  packagingName: string;
}) {
  const [pendingRemove, setPendingRemove] = useState(false);
  const [editingQty, setEditingQty] = useState(false);
  const [qtyInput, setQtyInput] = useState(String(line.quantity));
  const [saveError, setSaveError] = useState("");

  async function handleDelete() {
    if (!line.id) return;
    await deleteOrderPackagingLine(line.id);
  }
  async function commitQty() {
    const n = parseInt(qtyInput, 10);
    if (!Number.isFinite(n) || n <= 0) {
      setQtyInput(String(line.quantity));
      setEditingQty(false);
      return;
    }
    if (n === line.quantity) { setEditingQty(false); return; }
    setSaveError("");
    try {
      await saveOrderPackagingLine({
        id: line.id,
        orderId: line.orderId,
        packagingId: line.packagingId,
        quantity: n,
        sortOrder: line.sortOrder,
        notes: line.notes,
      });
      setEditingQty(false);
    } catch (err) {
      const raw: { message?: string; code?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      const code = raw.code ? ` (code ${raw.code})` : "";
      setSaveError(`${raw.message || "Save failed"}${code}`);
      setQtyInput(String(line.quantity));
    }
  }

  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{packagingName}</p>
          {line.notes && <p className="text-xs text-muted-foreground truncate">{line.notes}</p>}
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
            className="input !w-20 text-sm text-right"
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
}: {
  order: import("@/types").Order;
  labour: ReturnType<typeof computeOrderLabourHours>;
  calculatedCost: ReturnType<typeof computeOrderCalculatedCost>;
  feasibility: ReturnType<typeof checkOrderFeasibility>;
  labourHourlyRate: number | null;
  productNameById: Map<string, { name: string }>;
}) {
  const sevColor =
    feasibility.severity === "green"
      ? "border-status-ok/40 bg-status-ok/5 text-status-ok"
      : feasibility.severity === "yellow"
        ? "border-status-warn/40 bg-status-warn/5 text-status-warn"
        : "border-status-alert/40 bg-status-alert/5 text-status-alert";

  const margin = order.pricePaid != null
    ? order.pricePaid - calculatedCost.totalCost
    : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Metric
          label="Labour"
          value={`${labour.totalHours}h`}
          hint={`${labour.productMinutes}m prod · ${labour.packagingMinutes}m pack`}
        />
        <Metric
          label="Calculated cost"
          value={`€${calculatedCost.totalCost.toFixed(2)}`}
          hint={labourHourlyRate == null
            ? "Set labour rate in Settings"
            : `@ €${labourHourlyRate.toFixed(2)}/h`}
        />
        <PricePaidField order={order} />
        <Metric
          label="Margin"
          value={margin == null ? "—" : `€${margin.toFixed(2)}`}
          hint={margin == null || calculatedCost.totalCost <= 0
            ? "Enter price paid"
            : `${((margin / calculatedCost.totalCost) * 100).toFixed(0)}% vs cost`}
        />
      </div>

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
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-base font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function PricePaidField({ order }: { order: import("@/types").Order }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(order.pricePaid != null ? String(order.pricePaid) : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function commit() {
    setSaveError("");
    const trimmed = value.trim();
    const parsed = trimmed === "" ? undefined : Number(trimmed);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 0)) {
      setSaveError("Invalid amount");
      return;
    }
    setSaving(true);
    try {
      await saveOrder({ ...order, pricePaid: parsed });
      setEditing(false);
    } catch (err) {
      const raw: { message?: string; code?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      setSaveError(raw.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Price paid</p>
      {editing ? (
        <div className="flex items-center gap-1">
          <span className="text-base font-semibold">€</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              if (e.key === "Escape") {
                setValue(order.pricePaid != null ? String(order.pricePaid) : "");
                setEditing(false);
              }
            }}
            onBlur={commit}
            autoFocus
            className="input !py-0.5 !text-base !font-semibold !w-24"
            placeholder="0.00"
          />
        </div>
      ) : (
        <button
          onClick={() => {
            setValue(order.pricePaid != null ? String(order.pricePaid) : "");
            setEditing(true);
          }}
          className="text-base font-semibold tabular-nums hover:bg-muted rounded px-1 -ml-1"
          title="Click to edit price paid"
        >
          {order.pricePaid != null ? `€${order.pricePaid.toFixed(2)}` : <span className="text-muted-foreground">—</span>}
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

/** Convert an ISO timestamp to the local-time string datetime-local inputs expect. */
function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
