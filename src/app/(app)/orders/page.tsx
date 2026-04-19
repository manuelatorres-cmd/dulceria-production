"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useOrders, saveOrder, useProductsList, useAllOrderItems } from "@/lib/hooks";
import {
  ORDER_CHANNELS, ORDER_CHANNEL_LABELS,
  ORDER_PRIORITIES, ORDER_PRIORITY_LABELS,
  ORDER_STATUSES, ORDER_STATUS_LABELS,
  type Order, type OrderChannel, type OrderPriority, type OrderStatus,
} from "@/types";
import { Plus, Search, AlertTriangle } from "lucide-react";

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

  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");

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
          <div className="flex items-center gap-2 flex-1 min-w-0">
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
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
              className="input text-sm w-auto"
            >
              <option value="all">All statuses</option>
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
              ))}
            </select>
          </div>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium shrink-0"
            >
              <Plus className="w-3.5 h-3.5" /> New order
            </button>
          )}
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

function NewOrderForm({ onSaved, onCancel }: { onSaved: () => void; onCancel: () => void }) {
  const router = useRouter();
  const [channel, setChannel] = useState<OrderChannel>("b2b");
  const [customerName, setCustomerName] = useState("");
  const [eventName, setEventName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [priority, setPriority] = useState<OrderPriority>("normal");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const canSave = !!deadline && (channel !== "shop" ? customerName.trim() || eventName.trim() : true) && !saving;

  async function handleSave() {
    setSaving(true);
    try {
      const id = await saveOrder({
        channel,
        customerName: customerName.trim() || undefined,
        eventName: channel === "event" && eventName.trim() ? eventName.trim() : undefined,
        deadline: new Date(deadline).toISOString(),
        priority,
        status: "pending",
        notes: notes.trim() || undefined,
      });
      onSaved();
      router.push(`/orders/${encodeURIComponent(id)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-sm font-medium">New order</p>
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
        <input
          type="text"
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
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

      <div className="flex gap-2 pt-1">
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Creating…" : "Create & add products"}
        </button>
        <button onClick={onCancel} className="rounded-full border border-border px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
