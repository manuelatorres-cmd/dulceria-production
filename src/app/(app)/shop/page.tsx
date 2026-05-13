"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  useShopOpeningHours, useShopClosures, saveShopOpeningHours,
  saveShopClosure, deleteShopClosure,
  useProductsList, useProductLocationTotals, useStockLocationMinimums,
  saveStockLocationMinimum, useOrders, useAllOrderItems,
} from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { computeLiveShopStatus, dateToIso } from "@/lib/shopHours";
import type { OrderItem, Order } from "@/types";
import { IconPlus as Plus, IconX as X, IconPrinter as Printer, IconClock as Clock } from "@tabler/icons-react";

const WEEKDAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* Same glass card pattern as /plan + /dashboard. */
const CARD = "bg-[color:var(--ds-card-bg)] border-[0.5px] border-[color:var(--ds-border-warm)] rounded-[8px] p-5";
const PINK = "bg-[#e3ebe6] text-[#2e4839] hover:bg-[#d4e0d8]";
const PINK_INK = "text-[#2e4839]";

export default function ShopPage() {
  const hours = useShopOpeningHours();
  const closures = useShopClosures();

  const now = new Date();
  const live = useMemo(() => computeLiveShopStatus(now, hours, closures),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hours, closures, now.getMinutes()]);

  return (
    <div className="px-5 py-6 pb-12">
      {/* Compact header strip */}
      <header className="flex items-end justify-between flex-wrap gap-3 mb-5">
        <div>
          <p className="text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.16em" }}>
            The Shop
          </p>
          <div className="flex items-baseline gap-3 mt-1 flex-wrap">
            <h1
              className="text-[30px] leading-none text-foreground"
              style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.018em" }}
            >
              Storefront
            </h1>
            <LiveStatusInline live={live} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/shop/counter" className={`${PINK} text-[12px] px-3.5 py-1.5 rounded-full font-medium`}>
            Counter
          </Link>
          <Link href="/shop/daily-count" className="text-[12px] px-3.5 py-1.5 rounded-full font-medium bg-white/70 border border-border text-foreground hover:border-foreground">
            Daily count
          </Link>
          <Link href="/shop/transfer" className="text-[12px] px-3.5 py-1.5 rounded-full font-medium bg-white/70 border border-border text-foreground hover:border-foreground">
            Transfer in
          </Link>
          <Link href="/shop/breakage" className="text-[12px] px-3.5 py-1.5 rounded-full font-medium bg-white/70 border border-border text-foreground hover:border-foreground">
            Stock out
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-5">
          <PickupsTodayCard />
          <ArrivingCard />
          <NewOnlineCard />
        </div>
        <div className="space-y-5">
          <ShopStockGrid />
          <OpeningHoursCard hours={hours} closures={closures} />
          <LabelPlaceholder />
        </div>
      </div>
    </div>
  );
}

// ─── Inline status pill (next to page title) ───────────────────

function LiveStatusInline({ live }: { live: ReturnType<typeof computeLiveShopStatus> }) {
  const open = live.isOpenNow;
  return (
    <span
      className="inline-flex items-center gap-2 text-[11.5px] px-3 py-1 rounded-full"
      style={{
        background: open ? "#f1faf4" : "#fdeeea",
        color: open ? "#4a7a5e" : "#9b4f48",
        border: `1px solid ${open ? "#cfe5d9" : "#c8d4cc"}`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: open ? "#4a7a5e" : "#9b4f48" }}
      />
      {open
        ? `Open · ${live.todayHours?.openAt}–${live.todayHours?.closeAt}`
        : live.nextOpening
          ? `Closed · next ${live.nextOpening.date.toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "short" })}${live.nextOpening.openAt ? ` ${live.nextOpening.openAt}` : ""}`
          : "Closed"}
    </span>
  );
}

// ─── Pickups today ─────────────────────────────────────────────

function todayIsoDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function PickupsTodayCard() {
  const orders = useOrders();
  const items = useAllOrderItems();
  const today = todayIsoDate();

  const todayPickups = useMemo(() => {
    return orders
      .filter((o) => {
        const due = (o.deadline ?? "").slice(0, 10);
        if (due !== today) return false;
        if (o.status === "done" || o.status === "cancelled") return false;
        const dt = (o as Order & { deliveryType?: string }).deliveryType;
        if (dt === "ship") return false;
        return true;
      })
      .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  }, [orders, today]);

  const itemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>();
    for (const it of items) {
      const arr = m.get(it.orderId) ?? [];
      arr.push(it);
      m.set(it.orderId, arr);
    }
    return m;
  }, [items]);

  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between mb-3">
        <h2
          className="text-[18px]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
        >
          Pickups today
        </h2>
        <span className="text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
          {todayPickups.length}
        </span>
      </div>
      {todayPickups.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground italic">Nothing scheduled for pickup today.</p>
      ) : (
        <ul className="space-y-1">
          {todayPickups.map((o) => {
            const oItems = itemsByOrder.get(o.id!) ?? [];
            const totalPcs = oItems.reduce((s, it) => s + it.quantity, 0);
            const dueTime = o.deadline ? new Date(o.deadline).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" }) : "";
            const tag = o.channel === "online" ? { bg: "#e3ebe6", ink: "#2e4839", t: "Online" }
              : o.channel === "b2b" ? { bg: "#eff5fb", ink: "#4b6b8f", t: "B2B" }
                : { bg: "#fdf8e2", ink: "#8a7030", t: "Walk-in" };
            return (
              <li key={o.id} className="rounded-[10px] border border-white/60 bg-white/55 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/orders/${encodeURIComponent(o.id!)}?from=shop`} className="flex-1 min-w-0 hover:underline">
                    <span style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 14 }}>
                      {o.customerName || o.eventName || "(no name)"}
                    </span>
                  </Link>
                  <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                    {dueTime || "—"}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{ background: tag.bg, color: tag.ink, border: `1px solid ${tag.bg}` }}
                  >
                    {tag.t}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {oItems.length === 0 ? "no items" : `${oItems.length} line${oItems.length === 1 ? "" : "s"} · ${totalPcs} pcs`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Arriving from production ──────────────────────────────────

function ArrivingCard() {
  const products = useProductsList(true);
  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);

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
  const ids = replenishOrders.map((o) => o.id!).filter(Boolean);
  const { data: replenishItems = [] } = useQuery({
    queryKey: ["shop", "replenishment-items", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () =>
      assertOk(
        await supabase
          .from("orderItems")
          .select("*")
          .in("orderId", ids),
      ) as OrderItem[],
  });

  const itemsByOrder = useMemo(() => {
    const m = new Map<string, OrderItem[]>();
    for (const it of replenishItems) {
      const arr = m.get(it.orderId) ?? [];
      arr.push(it);
      m.set(it.orderId, arr);
    }
    return m;
  }, [replenishItems]);

  const sorted = [...replenishOrders].sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));

  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between mb-3">
        <h2
          className="text-[18px]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
        >
          Arriving from production
        </h2>
        <span className="text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
          {sorted.length}
        </span>
      </div>
      {sorted.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground italic">Nothing in transit.</p>
      ) : (
        <ul className="space-y-1">
          {sorted.slice(0, 6).map((o) => {
            const arr = itemsByOrder.get(o.id!) ?? [];
            const summary = arr
              .slice(0, 2)
              .map((it) => `${productMap.get(it.productId)?.name ?? "?"} ×${it.quantity}`)
              .join(" · ");
            const more = arr.length > 2 ? ` +${arr.length - 2}` : "";
            return (
              <li key={o.id} className="flex items-baseline justify-between gap-2 text-[12px] px-2 py-1.5">
                <span className="truncate flex-1 min-w-0">
                  <span className="font-medium" style={{ fontFamily: "var(--font-serif)", fontSize: 13 }}>
                    {summary || "—"}
                  </span>
                  <span className="text-muted-foreground">{more}</span>
                </span>
                <span className="text-[11px] tabular-nums shrink-0" style={{ color: o.status === "in_production" ? "#8a7030" : "#8a8780" }}>
                  {o.status === "in_production" ? "Producing" : "Planned"} · {new Date(o.deadline).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── New online orders ─────────────────────────────────────────

function NewOnlineCard() {
  const orders = useOrders();
  const newOnline = useMemo(() => {
    return orders
      .filter((o) => o.channel === "online" && o.status === "pending")
      .sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0))
      .slice(0, 6);
  }, [orders]);

  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between mb-3">
        <h2
          className="text-[18px]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
        >
          Online · new
        </h2>
        <span className="text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
          {newOnline.length}
        </span>
      </div>
      {newOnline.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground italic">No new online orders.</p>
      ) : (
        <ul className="space-y-1">
          {newOnline.map((o) => (
            <li key={o.id} className="flex items-baseline justify-between gap-2 text-[12px] px-2 py-1.5">
              <Link href={`/orders/${encodeURIComponent(o.id!)}?from=shop`} className="truncate flex-1 min-w-0 hover:underline">
                <span style={{ fontFamily: "var(--font-serif)", fontSize: 13 }}>
                  {o.sourceRef || o.customerName || "—"}
                </span>
                {o.customerName && o.sourceRef && (
                  <span className="text-muted-foreground"> · {o.customerName}</span>
                )}
              </Link>
              <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                {new Date(o.deadline).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Compact stock grid ────────────────────────────────────────

function ShopStockGrid() {
  const products = useProductsList(false);
  const totals = useProductLocationTotals();
  const minimums = useStockLocationMinimums();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "low" | "ok">("all");
  const [editing, setEditing] = useState<string | null>(null);

  const minByProduct = useMemo(() => {
    const m = new Map<string, { min: number; max?: number }>();
    for (const row of minimums) {
      if (row.location !== "store") continue;
      m.set(row.productId, { min: row.minimumUnits, max: row.maximumUnits });
    }
    return m;
  }, [minimums]);

  const allRows = useMemo(() => products
    .map((p) => {
      const t = totals.get(p.id!) ?? { store: 0, production: 0, freezer: 0, allocated: 0 };
      const minInfo = minByProduct.get(p.id!);
      const min = minInfo?.min ?? 0;
      const max = minInfo?.max;
      const store = t.store ?? 0;
      const status: "ok" | "low" | "out" | "over" =
        min === 0 ? "ok"
          : store <= 0 ? "out"
            : store < min ? "low"
              : (max != null && store > max) ? "over"
                : "ok";
      return { product: p, store, min, max, status };
    })
    .filter((r) => r.min > 0 || r.store > 0),
    [products, totals, minByProduct]);

  const okN = allRows.filter((r) => r.status === "ok").length;
  const lowN = allRows.filter((r) => r.status === "low").length;
  const outN = allRows.filter((r) => r.status === "out").length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
      if (q && !r.product.name.toLowerCase().includes(q)) return false;
      if (filter === "low" && r.status === "ok") return false;
      if (filter === "ok" && r.status !== "ok") return false;
      return true;
    }).sort((a, b) => a.product.name.localeCompare(b.product.name));
  }, [allRows, search, filter]);

  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
        <h2
          className="text-[18px]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
        >
          Shop stock
        </h2>
        <span className="text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
          {allRows.length} sku
        </span>
      </div>

      <div className="flex items-center gap-3 mb-3 text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.06em" }}>
        <span><i className="inline-block w-2 h-2 rounded-sm align-middle mr-1" style={{ background: "#d6ead9" }} />ok {okN}</span>
        <span><i className="inline-block w-2 h-2 rounded-sm align-middle mr-1" style={{ background: "#fdf8e2" }} />low {lowN}</span>
        <span><i className="inline-block w-2 h-2 rounded-sm align-middle mr-1" style={{ background: "#fdeeea" }} />out {outN}</span>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {(["all", "low", "ok"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={
              "text-[11px] px-2.5 py-0.5 rounded-full border transition " +
              (filter === k
                ? "bg-foreground text-background border-foreground"
                : "bg-white/65 border-border text-foreground hover:border-foreground")
            }
          >
            {k === "all" ? "All" : k === "low" ? `Low (${lowN + outN})` : "OK"}
          </button>
        ))}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search…"
          className="input ml-auto !py-1 !text-[12px] max-w-[180px]"
        />
      </div>

      {visible.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground italic py-4 text-center">No products match.</p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
          {visible.map((r) => {
            const tint = r.status === "out" ? { bg: "#fdeeea", ink: "#9b4f48" }
              : r.status === "low" ? { bg: "#fdf8e2", ink: "#8a7030" }
                : r.status === "over" ? { bg: "#f3eef6", ink: "#6a4d89" }
                  : { bg: "#f1faf4", ink: "#4a7a5e" };
            return (
              <button
                key={r.product.id}
                onClick={() => setEditing(editing === r.product.id ? null : r.product.id ?? null)}
                title={`${r.product.name} · min ${r.min}${r.max != null ? ` · max ${r.max}` : ""}`}
                className="aspect-square rounded-[8px] border border-white/55 px-1 py-1 flex flex-col justify-between text-left transition hover:opacity-90 hover:scale-[1.02]"
                style={{ background: tint.bg, color: tint.ink }}
              >
                <span className="text-[8.5px] uppercase truncate" style={{ letterSpacing: "0.06em", lineHeight: 1.1 }}>
                  {r.product.name}
                </span>
                <span className="text-right tabular-nums" style={{ fontFamily: "var(--font-serif)", fontSize: 16, fontWeight: 500 }}>
                  {r.store}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {editing && (() => {
        const r = allRows.find((x) => x.product.id === editing);
        if (!r) return null;
        return <StockMinEditor row={r} onClose={() => setEditing(null)} />;
      })()}
    </section>
  );
}

function StockMinEditor({ row, onClose }: {
  row: { product: { id?: string; name: string }; min: number; max?: number; store: number };
  onClose: () => void;
}) {
  const [minInput, setMinInput] = useState(String(row.min));
  const [maxInput, setMaxInput] = useState(row.max != null ? String(row.max) : "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (!row.product.id) return;
    const minN = parseInt(minInput, 10);
    const maxN = maxInput.trim() === "" ? undefined : parseInt(maxInput, 10);
    if (!Number.isFinite(minN) || minN < 0) { setErr("Min must be ≥ 0"); return; }
    if (maxN != null && (!Number.isFinite(maxN) || maxN < minN)) { setErr("Max must be ≥ Min"); return; }
    setSaving(true);
    setErr("");
    try {
      await saveStockLocationMinimum({
        productId: row.product.id,
        location: "store",
        minimumUnits: minN,
        maximumUnits: maxN,
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mt-3 rounded-[12px] border border-white/60 bg-white/80 p-3">
      <div className="flex items-center justify-between mb-2">
        <span style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 14 }}>
          {row.product.name}
        </span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex items-center gap-2 text-[11.5px]">
        <label>Min</label>
        <input type="number" min={0} value={minInput} onChange={(e) => setMinInput(e.target.value)} className="input !py-0.5 !text-xs !w-16" />
        <label>Max</label>
        <input type="number" min={0} value={maxInput} onChange={(e) => setMaxInput(e.target.value)} placeholder="—" className="input !py-0.5 !text-xs !w-16" />
        <button onClick={save} disabled={saving} className={`${PINK_INK} font-medium hover:underline disabled:opacity-50 ml-auto`}>
          {saving ? "…" : "Save"}
        </button>
      </div>
      {err && <p className="text-[11px] text-status-alert mt-1">{err}</p>}
    </div>
  );
}

// ─── Opening hours + closures ──────────────────────────────────

function OpeningHoursCard({
  hours, closures,
}: {
  hours: ReturnType<typeof useShopOpeningHours>;
  closures: ReturnType<typeof useShopClosures>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between mb-2 flex-wrap gap-2">
        <h2
          className="text-[18px]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
        >
          Hours & closures
        </h2>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-muted-foreground hover:text-foreground"
        >
          {expanded ? "▾ collapse" : "▸ edit"}
        </button>
      </div>

      {/* Compact summary line */}
      {!expanded && (
        <div className="space-y-1 text-[12px]">
          {WEEKDAY_FULL.map((_, dow) => {
            const row = hours.find((h) => h.dayOfWeek === dow);
            const open = !!row?.isOpen;
            return (
              <div key={dow} className="flex items-baseline justify-between gap-2 px-2 py-0.5">
                <span style={{ fontFamily: "var(--font-serif)", fontSize: 13 }}>
                  {WEEKDAY_FULL[dow]}
                </span>
                <span className="text-[11.5px] tabular-nums" style={{ color: open ? "#1c1d1f" : "#8a8780" }}>
                  {open ? `${row.openAt}–${row.closeAt}` : "Closed"}
                </span>
              </div>
            );
          })}
          {closures.length > 0 && (
            <div className="mt-3 pt-2 border-t border-white/55 space-y-0.5">
              <p className="text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
                Closures · {closures.length}
              </p>
              {closures.slice(0, 3).map((c) => (
                <p key={c.id} className="text-[11.5px]" style={{ color: "#9b4f48" }}>
                  {new Date(c.startDate).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                  {c.endDate !== c.startDate && ` – ${new Date(c.endDate).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}`}
                  {c.reason && <span className="text-muted-foreground"> · {c.reason}</span>}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expanded edit mode */}
      {expanded && (
        <>
          <div className="rounded-[12px] border border-white/60 bg-white/55 divide-y divide-white/55">
            {WEEKDAY_FULL.map((_, dow) => {
              const row = hours.find((h) => h.dayOfWeek === dow);
              return <WeekdayRow key={dow} dow={dow} row={row} />;
            })}
          </div>
          <div className="mt-3">
            <p className="text-[10.5px] uppercase text-muted-foreground mb-1.5" style={{ letterSpacing: "0.12em" }}>
              Closures
            </p>
            <ClosuresEditor closures={closures} />
          </div>
        </>
      )}
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

  async function persist(next: { isOpen: boolean; openAt?: string; closeAt?: string }) {
    if (!row) return;
    await saveShopOpeningHours({
      id: row.id,
      dayOfWeek: dow,
      isOpen: next.isOpen,
      openAt: next.isOpen ? next.openAt : undefined,
      closeAt: next.isOpen ? next.closeAt : undefined,
    });
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <span className="w-20 shrink-0 text-[12.5px]" style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}>
        {WEEKDAY_FULL[dow]}
      </span>
      <button
        type="button"
        onClick={() => {
          const next = !isOpen;
          setIsOpen(next);
          persist({ isOpen: next, openAt, closeAt });
        }}
        className={
          "text-[10.5px] px-2 py-0.5 rounded-full border transition " +
          (isOpen
            ? "bg-[#f1faf4] text-[#4a7a5e] border-[#cfe5d9]"
            : "bg-white/60 text-muted-foreground border-border hover:border-foreground")
        }
      >
        {isOpen ? "Open" : "Closed"}
      </button>
      {isOpen && (
        <div className="flex items-center gap-1 ml-auto">
          <input
            type="time"
            value={openAt}
            onChange={(e) => setOpenAt(e.target.value)}
            onBlur={() => persist({ isOpen, openAt, closeAt })}
            className="input !py-0 !text-[12px] !w-20"
          />
          <span className="text-[11px] text-muted-foreground">–</span>
          <input
            type="time"
            value={closeAt}
            onChange={(e) => setCloseAt(e.target.value)}
            onBlur={() => persist({ isOpen, openAt, closeAt })}
            className="input !py-0 !text-[12px] !w-20"
          />
        </div>
      )}
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
  const [err, setErr] = useState("");

  async function add() {
    if (endDate < startDate) { setErr("End date can't be before start."); return; }
    setSaving(true);
    setErr("");
    try {
      await saveShopClosure({ startDate, endDate, reason: reason.trim() || undefined });
      setAdding(false);
      setReason("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {closures.map((c) => (
        <div key={c.id} className="flex items-center gap-2 rounded-[10px] border border-[#dfe6e0] bg-[#e9efe9] px-2.5 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "#9b4f48" }} />
          <span className="flex-1 min-w-0 text-[12px]" style={{ color: "#9b4f48" }}>
            {new Date(c.startDate).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
            {c.endDate !== c.startDate && ` – ${new Date(c.endDate).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}`}
            {c.reason && <span className="text-muted-foreground"> · {c.reason}</span>}
          </span>
          <button
            onClick={() => c.id && deleteShopClosure(c.id)}
            className="text-muted-foreground/60 hover:text-destructive"
            aria-label="Remove closure"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      {adding ? (
        <div className="rounded-[10px] border border-white/60 bg-white/55 p-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input !py-0.5 !text-[12px]" />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input !py-0.5 !text-[12px]" />
          </div>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" className="input !py-1 !text-[12px]" />
          <div className="flex gap-2">
            <button onClick={add} disabled={saving} className={`${PINK} rounded-full px-3 py-1 text-[11.5px] font-medium disabled:opacity-50`}>
              {saving ? "…" : "Add"}
            </button>
            <button onClick={() => setAdding(false)} className="rounded-full border border-border px-3 py-1 text-[11.5px]">
              Cancel
            </button>
          </div>
          {err && <p className="text-[11px] text-status-alert">{err}</p>}
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className={`flex items-center gap-1 text-[11.5px] hover:underline ${PINK_INK}`}>
          <Plus className="w-3 h-3" /> Add closure
        </button>
      )}
    </div>
  );
}

// ─── Label printing placeholder ────────────────────────────────

function LabelPlaceholder() {
  return (
    <section className={CARD}>
      <div className="flex items-baseline justify-between mb-2">
        <h2
          className="text-[18px]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
        >
          Label printing
        </h2>
        <span className="text-[10.5px] uppercase text-muted-foreground" style={{ letterSpacing: "0.12em" }}>
          Coming soon
        </span>
      </div>
      <div className="rounded-[12px] border border-dashed border-border bg-white/40 p-4 text-center">
        <Printer className="w-6 h-6 mx-auto text-muted-foreground/60 mb-1.5" />
        <p className="text-[11.5px] text-muted-foreground">
          Printer model + label layout pending a decision.
        </p>
      </div>
    </section>
  );
}
