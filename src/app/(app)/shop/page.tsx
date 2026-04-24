"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  useShopOpeningHours, useShopClosures, saveShopOpeningHours,
  saveShopClosure, deleteShopClosure,
  useProductsList, useProductLocationTotals, useStockLocationMinimums,
  saveStockLocationMinimum,
} from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { computeLiveShopStatus, dateToIso } from "@/lib/shopHours";
import type { OrderItem, Order } from "@/types";
import { PageHeader } from "@/components/page-header";
import { Plus, X, Printer, Clock, Circle } from "lucide-react";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function ShopPage() {
  const hours = useShopOpeningHours();
  const closures = useShopClosures();

  const now = new Date();
  const live = useMemo(() => computeLiveShopStatus(now, hours, closures),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hours, closures, now.getMinutes()]);

  return (
    <div className="pb-12">
      <PageHeader
        title="Shop"
        description="Walk-in storefront status, Store stock, and opening hours."
      />

      <div className="px-4 space-y-6">
        <LiveStatusCard live={live} />
        <ShopStockSection />
        <OpeningHoursSection hours={hours} closures={closures} />
        <LabelPrintingPlaceholder />
      </div>
    </div>
  );
}

// ─── 1. Live status ────────────────────────────────────────────

function LiveStatusCard({ live }: { live: ReturnType<typeof computeLiveShopStatus> }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-primary mb-2">Right now</h2>
      <div className={`rounded-sm border p-4 ${
        live.isOpenNow ? "border-status-ok/40 bg-status-ok/5" : "border-border bg-card"
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full shrink-0 ${
            live.isOpenNow ? "bg-status-ok animate-pulse" : "bg-muted-foreground/40"
          }`} />
          <div className="flex-1 min-w-0">
            <p className={`text-lg font-semibold ${live.isOpenNow ? "text-status-ok" : "text-foreground"}`}>
              {live.isOpenNow ? "Open now" : "Closed"}
            </p>
            {live.closureReason && (
              <p className="text-xs text-status-warn">Closure: {live.closureReason}</p>
            )}
            {live.todayHours && (
              <p className="text-xs text-muted-foreground">
                Today {live.todayHours.openAt}–{live.todayHours.closeAt}
              </p>
            )}
          </div>
        </div>

        {!live.isOpenNow && live.nextOpening && (
          <div className="mt-3 pt-3 border-t border-border flex items-center gap-2 text-sm">
            <Clock className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">Next opening:</span>
            <span className="font-medium">
              {live.nextOpening.date.toLocaleDateString("en-GB", {
                weekday: "long", day: "numeric", month: "short",
              })}
              {live.nextOpening.openAt && ` · ${live.nextOpening.openAt}`}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── 2. Stock per product ──────────────────────────────────────

function ShopStockSection() {
  const products = useProductsList(false);
  const totals = useProductLocationTotals();
  const minimums = useStockLocationMinimums();
  const minByProduct = useMemo(() => {
    const m = new Map<string, { min: number; max?: number }>();
    for (const row of minimums) {
      if (row.location !== "store") continue;
      m.set(row.productId, { min: row.minimumUnits, max: row.maximumUnits });
    }
    return m;
  }, [minimums]);

  // Borrowed and replenishment info: pull borrowed orderItems that are
  // linked to an order whose status isn't done/cancelled.
  const { data: borrowedItems = [] } = useQuery({
    queryKey: ["shop", "borrowed-items"],
    queryFn: async () =>
      assertOk(
        await supabase
          .from("orderItems")
          .select("*")
          .eq("fulfilmentMode", "borrow"),
      ) as OrderItem[],
  });
  // Child replenishment orders open right now (channel='shop' + sourceOrderId).
  const { data: replenishOrders = [] } = useQuery({
    queryKey: ["shop", "replenishment-orders"],
    queryFn: async () =>
      assertOk(
        await supabase
          .from("orders")
          .select("*")
          .eq("channel", "shop")
          .not("sourceOrderId", "is", null)
          .in("status", ["pending", "in_production"]),
      ) as Order[],
  });
  const replenishOrderIds = replenishOrders.map((o) => o.id!).filter(Boolean);
  const { data: replenishItems = [] } = useQuery({
    queryKey: ["shop", "replenishment-items", replenishOrderIds.join(",")],
    enabled: replenishOrderIds.length > 0,
    queryFn: async () =>
      assertOk(
        await supabase
          .from("orderItems")
          .select("*")
          .in("orderId", replenishOrderIds),
      ) as OrderItem[],
  });

  const borrowedByProduct = useMemo(() => {
    const m = new Map<string, OrderItem[]>();
    for (const i of borrowedItems) {
      const arr = m.get(i.productId) ?? [];
      arr.push(i);
      m.set(i.productId, arr);
    }
    return m;
  }, [borrowedItems]);
  const replenishOrderById = useMemo(() => new Map(replenishOrders.map((o) => [o.id!, o])), [replenishOrders]);
  const replenishByProduct = useMemo(() => {
    const m = new Map<string, Array<{ order: Order; qty: number }>>();
    for (const i of replenishItems) {
      const order = replenishOrderById.get(i.orderId);
      if (!order) continue;
      const arr = m.get(i.productId) ?? [];
      arr.push({ order, qty: i.quantity });
      m.set(i.productId, arr);
    }
    return m;
  }, [replenishItems, replenishOrderById]);

  const rows = products
    .map((p) => {
      const t = totals.get(p.id!) ?? { store: 0, production: 0, freezer: 0, allocated: 0 };
      const minInfo = minByProduct.get(p.id!);
      const min = minInfo?.min ?? 0;
      const max = minInfo?.max;
      return {
        product: p,
        store: t.store ?? 0,
        min,
        max,
        borrowed: borrowedByProduct.get(p.id!) ?? [],
        replenishments: replenishByProduct.get(p.id!) ?? [],
      };
    })
    // Only show products that have a min set OR current store stock OR
    // active borrow/replenishment — keeps the list scoped to "shop items".
    .filter((r) => r.min > 0 || r.store > 0 || r.borrowed.length > 0 || r.replenishments.length > 0);

  return (
    <section>
      <h2 className="text-sm font-semibold text-primary mb-2">Store stock</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-sm">
          No products yet configured for the shop. Set a Store minimum in Stock → minimums.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <ShopStockRow key={r.product.id} row={r} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ShopStockRow({ row }: {
  row: {
    product: { id?: string; name: string };
    store: number; min: number; max?: number;
    borrowed: OrderItem[];
    replenishments: Array<{ order: Order; qty: number }>;
  };
}) {
  const status: "ok" | "low" | "critical" | "over" =
    row.min === 0 ? "ok"
      : row.store <= 0 ? "critical"
        : row.store < row.min ? "low"
          : row.max != null && row.store > row.max ? "over"
            : "ok";
  const dotColor = {
    ok: "bg-status-ok",
    low: "bg-status-warn",
    critical: "bg-status-alert",
    over: "bg-primary",
  }[status];

  const [editing, setEditing] = useState(false);
  const [minInput, setMinInput] = useState(String(row.min));
  const [maxInput, setMaxInput] = useState(row.max != null ? String(row.max) : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function saveMinMax() {
    if (!row.product.id) return;
    const minN = parseInt(minInput, 10);
    const maxN = maxInput.trim() === "" ? undefined : parseInt(maxInput, 10);
    if (!Number.isFinite(minN) || minN < 0) { setSaveError("Min must be ≥ 0"); return; }
    if (maxN != null && (!Number.isFinite(maxN) || maxN < minN)) { setSaveError("Max must be ≥ Min"); return; }
    setSaving(true);
    setSaveError("");
    try {
      await saveStockLocationMinimum({
        productId: row.product.id,
        location: "store",
        minimumUnits: minN,
        maximumUnits: maxN,
      });
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
    <li className="rounded-sm border border-border bg-card p-3">
      <div className="flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full shrink-0 ${dotColor}`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{row.product.name}</p>
          {editing ? (
            <div className="flex items-center gap-2 mt-1">
              <label className="text-[11px] text-muted-foreground">Min</label>
              <input
                type="number" min={0} value={minInput}
                onChange={(e) => setMinInput(e.target.value)}
                className="input !py-0.5 !text-xs !w-16"
              />
              <label className="text-[11px] text-muted-foreground">Max</label>
              <input
                type="number" min={0} value={maxInput}
                onChange={(e) => setMaxInput(e.target.value)}
                placeholder="—"
                className="input !py-0.5 !text-xs !w-16"
              />
              <button onClick={saveMinMax} disabled={saving}
                className="text-xs text-primary font-medium hover:underline disabled:opacity-50">
                {saving ? "…" : "Save"}
              </button>
              <button onClick={() => setEditing(false)}
                className="text-xs text-muted-foreground hover:underline">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setMinInput(String(row.min)); setMaxInput(row.max != null ? String(row.max) : ""); setEditing(true); }}
              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline text-left"
            >
              Min {row.min}{row.max != null ? ` · Max ${row.max}` : " · Max —"} ✎
            </button>
          )}
          {saveError && <p className="text-[11px] text-status-alert mt-1">{saveError}</p>}
        </div>
        <div className="text-right">
          <p className="text-base font-semibold tabular-nums">{row.store}</p>
          <p className="text-[11px] text-muted-foreground">in store</p>
        </div>
      </div>

      {row.borrowed.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border text-xs space-y-0.5">
          <p className="text-muted-foreground font-medium">Borrowed by:</p>
          {row.borrowed.map((b) => (
            <Link
              key={b.id}
              href={`/orders/${encodeURIComponent(b.orderId)}`}
              className="flex items-center justify-between hover:underline text-status-warn"
            >
              <span>Order #{b.orderId.slice(0, 8)}</span>
              <span className="tabular-nums">−{b.quantity}</span>
            </Link>
          ))}
        </div>
      )}

      {row.replenishments.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border text-xs space-y-0.5">
          <p className="text-muted-foreground font-medium">Incoming:</p>
          {row.replenishments.map((r, i) => (
            <Link
              key={i}
              href={`/orders/${encodeURIComponent(r.order.id!)}`}
              className="flex items-center justify-between hover:underline text-status-ok"
            >
              <span>
                {r.order.status === "in_production" ? "Producing" : "Planned"}
                {" · "}
                {new Date(r.order.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              </span>
              <span className="tabular-nums">+{r.qty}</span>
            </Link>
          ))}
        </div>
      )}
    </li>
  );
}

// ─── 3. Opening hours + closures ───────────────────────────────

function OpeningHoursSection({
  hours, closures,
}: {
  hours: ReturnType<typeof useShopOpeningHours>;
  closures: ReturnType<typeof useShopClosures>;
}) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-primary mb-2">Opening hours</h2>
      <div className="rounded-sm border border-border bg-card divide-y divide-border">
        {WEEKDAY_FULL.map((_, dow) => {
          const row = hours.find((h) => h.dayOfWeek === dow);
          return (
            <WeekdayRow key={dow} dow={dow} row={row} />
          );
        })}
      </div>

      <div className="mt-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Closures
        </h3>
        <ClosuresEditor closures={closures} />
      </div>
    </section>
  );
}

function WeekdayRow({ dow, row }: {
  dow: number;
  row: ReturnType<typeof useShopOpeningHours>[number] | undefined;
}) {
  const [isOpen, setIsOpen] = useState(row?.isOpen ?? false);
  const [openAt, setOpenAt] = useState(row?.openAt ?? "10:00");
  const [closeAt, setCloseAt] = useState(row?.closeAt ?? "18:00");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function persist(next: { isOpen: boolean; openAt?: string; closeAt?: string }) {
    if (!row) return;
    setSaving(true);
    setSaveError("");
    try {
      await saveShopOpeningHours({
        id: row.id,
        dayOfWeek: dow,
        isOpen: next.isOpen,
        openAt: next.isOpen ? next.openAt : undefined,
        closeAt: next.isOpen ? next.closeAt : undefined,
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
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="w-20 shrink-0">
        <p className="text-sm font-medium">{WEEKDAY_FULL[dow]}</p>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        <input
          type="checkbox"
          checked={isOpen}
          onChange={(e) => {
            setIsOpen(e.target.checked);
            persist({ isOpen: e.target.checked, openAt, closeAt });
          }}
          className="w-4 h-4"
        />
        Open
      </label>
      {isOpen && (
        <div className="flex items-center gap-1.5 ml-auto">
          <input
            type="time"
            value={openAt}
            onChange={(e) => setOpenAt(e.target.value)}
            onBlur={() => persist({ isOpen, openAt, closeAt })}
            className="input !py-0.5 !text-sm !w-24"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <input
            type="time"
            value={closeAt}
            onChange={(e) => setCloseAt(e.target.value)}
            onBlur={() => persist({ isOpen, openAt, closeAt })}
            className="input !py-0.5 !text-sm !w-24"
          />
        </div>
      )}
      {saving && <span className="text-[10px] text-muted-foreground ml-auto">Saving…</span>}
      {saveError && <span className="text-[10px] text-status-alert ml-auto">{saveError}</span>}
    </div>
  );
}

function ClosuresEditor({ closures }: {
  closures: ReturnType<typeof useShopClosures>;
}) {
  const [adding, setAdding] = useState(false);
  const [startDate, setStartDate] = useState(dateToIso(new Date()));
  const [endDate, setEndDate] = useState(dateToIso(new Date()));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  async function handleAdd() {
    if (endDate < startDate) { setSaveError("End date can't be before start."); return; }
    setSaving(true);
    setSaveError("");
    try {
      await saveShopClosure({ startDate, endDate, reason: reason.trim() || undefined });
      setAdding(false);
      setReason("");
    } catch (err) {
      const raw: { message?: string; code?: string } =
        err instanceof Error ? { message: err.message } : ((err as Record<string, string>) ?? {});
      setSaveError(raw.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    await deleteShopClosure(id);
  }

  return (
    <div className="space-y-2">
      {closures.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground py-3 text-center border border-dashed border-border rounded-sm">
          No closures configured.
        </p>
      )}
      {closures.map((c) => (
        <div key={c.id} className="flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2">
          <Circle className="w-2 h-2 fill-status-warn text-status-warn shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {new Date(c.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              {c.endDate !== c.startDate && ` – ${new Date(c.endDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`}
            </p>
            {c.reason && <p className="text-xs text-muted-foreground">{c.reason}</p>}
          </div>
          <button
            onClick={() => c.id && handleDelete(c.id)}
            className="text-muted-foreground/60 hover:text-destructive"
            aria-label="Remove closure"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="rounded-sm border border-border bg-card p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
            </div>
          </div>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="input"
          />
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={saving}
              className="rounded-full bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50">
              {saving ? "Adding…" : "Add closure"}
            </button>
            <button onClick={() => setAdding(false)} className="rounded-full border border-border px-3 py-1 text-xs">
              Cancel
            </button>
          </div>
          {saveError && <p className="text-xs text-status-alert">{saveError}</p>}
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <Plus className="w-3.5 h-3.5" /> Add closure
        </button>
      )}
    </div>
  );
}

// ─── 4. Label printing (placeholder) ───────────────────────────

function LabelPrintingPlaceholder() {
  return (
    <section>
      <h2 className="text-sm font-semibold text-primary mb-2">Label printing</h2>
      <div className="rounded-sm border border-dashed border-border bg-muted/30 p-6 text-center">
        <Printer className="w-8 h-8 mx-auto text-muted-foreground/60 mb-2" />
        <p className="text-sm font-medium text-muted-foreground">Coming soon</p>
        <p className="text-xs text-muted-foreground mt-1">
          Printer model + label layout pending a decision.
        </p>
      </div>
    </section>
  );
}
