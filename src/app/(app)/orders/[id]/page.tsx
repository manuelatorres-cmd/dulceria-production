"use client";

import { use, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  useOrder, useOrderItems, useProductsList, saveOrder, deleteOrder,
  saveOrderItem, deleteOrderItem, useCustomers,
} from "@/lib/hooks";
import {
  ORDER_CHANNELS, ORDER_CHANNEL_LABELS,
  ORDER_PRIORITIES, ORDER_PRIORITY_LABELS,
  ORDER_STATUSES, ORDER_STATUS_LABELS,
  type OrderChannel, type OrderPriority, type OrderStatus,
} from "@/types";
import { ArrowLeft, Plus, Trash2, X, Pencil } from "lucide-react";

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const orderId = decodeURIComponent(idStr);
  const router = useRouter();

  const order = useOrder(orderId);
  const items = useOrderItems(orderId);
  const products = useProductsList(true);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);

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

        {/* Priority + notes */}
        {!editing && (
          <div className="rounded-lg border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Priority</span>
              <span className="font-medium">{ORDER_PRIORITY_LABELS[order.priority]}</span>
            </div>
            {order.notes && (
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-1">Notes</p>
                <p className="text-sm whitespace-pre-wrap">{order.notes}</p>
              </div>
            )}
          </div>
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
  order: { id?: string; channel: OrderChannel; customerName?: string; customerId?: string; eventName?: string; deadline: string; priority: OrderPriority; status: OrderStatus; notes?: string };
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
  const [saving, setSaving] = useState(false);

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
      });
      onSaved();
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
    </div>
  );
}

function AddOrderLine({ orderId, nextSortOrder, products, onSaved, onCancel }: {
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

  const qty = parseInt(quantity, 10);
  const canSave = !!productId && !isNaN(qty) && qty > 0 && !saving;

  async function handleAdd() {
    setSaving(true);
    try {
      await saveOrderItem({
        orderId,
        productId,
        quantity: qty,
        sortOrder: nextSortOrder,
        notes: notes.trim() || undefined,
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2 mb-2">
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <select value={productId} onChange={(e) => setProductId(e.target.value)} className="input">
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
            placeholder="Qty"
            className="input"
          />
        </div>
      </div>
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Line notes (optional)"
        className="input"
      />
      <div className="flex gap-2">
        <button onClick={handleAdd} disabled={!canSave} className="rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50">
          {saving ? "Adding…" : "Add"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-border px-3 py-1 text-xs">
          Cancel
        </button>
      </div>
    </div>
  );
}

function OrderLineRow({ item, productName }: {
  item: { id?: string; productId: string; quantity: number; notes?: string };
  productName: string;
}) {
  const [pendingRemove, setPendingRemove] = useState(false);
  async function handleDelete() {
    if (!item.id) return;
    await deleteOrderItem(item.id);
  }

  return (
    <li className="rounded-lg border border-border bg-card flex items-center gap-3 px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{productName}</p>
        {item.notes && <p className="text-xs text-muted-foreground truncate">{item.notes}</p>}
      </div>
      <span className="text-sm font-medium tabular-nums shrink-0">{item.quantity}</span>
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
    </li>
  );
}

/** Convert an ISO timestamp to the local-time string datetime-local inputs expect. */
function toLocalDatetime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
