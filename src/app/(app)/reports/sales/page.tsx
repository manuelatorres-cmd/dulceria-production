"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowLeft as ArrowLeft } from "@tabler/icons-react";
import { PageHeader } from "@/components/dulceria";
import {
  useStockTransfers,
  useOrders,
  useAllOrderItems,
  useProductsList,
  useOrderPackagingLinesAll,
  usePackagingList,
  useCampaigns,
} from "@/lib/hooks";
import {
  STOCK_TRANSFER_REASON_LABELS,
  type StockTransferReason,
} from "@/types";

/**
 * Weekly sales report. Aggregates stock-out across:
 *   • stockTransfer rows (walk-in sale, tasting, gift, event sample,
 *     staff, waste) entityType=product
 *   • Order line items (status='done') for wholesale / online / event
 *   • Order packaging lines (status='done') for packaging consumed
 *
 * Default range = current ISO week (Mon → Sun). Switch to last week or
 * pick a custom range. Revenue tracked from orders only — walk-in
 * transfers don't carry a price.
 */

const SOLD_REASONS: StockTransferReason[] = ["sold", "event_sample"];
const NON_REVENUE_REASONS: StockTransferReason[] = ["custom_box", "tasting", "gift", "staff", "waste"];

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfIsoWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - dow);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export default function SalesReportPage() {
  const router = useRouter();
  const today = new Date();
  const thisMon = startOfIsoWeek(today);
  const thisSun = addDays(thisMon, 6);

  const [from, setFrom] = useState(isoDate(thisMon));
  const [to, setTo] = useState(isoDate(thisSun));

  const transfers = useStockTransfers("product");
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const orderPackagingLines = useOrderPackagingLinesAll();
  const products = useProductsList(true);
  const packaging = usePackagingList(true);
  const campaigns = useCampaigns();

  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const packagingById = useMemo(() => new Map(packaging.map((p) => [p.id!, p])), [packaging]);
  const campaignById = useMemo(() => new Map(campaigns.map((c) => [c.id!, c])), [campaigns]);

  const fromMs = new Date(`${from}T00:00:00`).getTime();
  const toMs = new Date(`${to}T23:59:59`).getTime();

  // ── Stock transfers in window (walk-in singles, tastings, etc.) ──
  const transfersInWin = useMemo(() => {
    return transfers.filter((t) => {
      const ts = new Date(t.transferredAt).getTime();
      return ts >= fromMs && ts <= toMs && t.entityType === "product";
    });
  }, [transfers, fromMs, toMs]);

  // ── Orders done in window ──
  const ordersInWin = useMemo(() => {
    return orders.filter((o) => {
      if (o.status !== "done") return false;
      const ts = new Date(o.deadline).getTime();
      return ts >= fromMs && ts <= toMs;
    });
  }, [orders, fromMs, toMs]);
  const orderIdsInWin = new Set(ordersInWin.map((o) => o.id!));
  const itemsInWin = orderItems.filter((it) => orderIdsInWin.has(it.orderId));
  const packagingInWin = orderPackagingLines.filter((l) => orderIdsInWin.has(l.orderId));

  // ── Per-product roll-up ──
  type ProductRow = {
    productId: string;
    productName: string;
    sold: number;       // sold (counter walkin + event_sample) + order items
    tasting: number;
    gift: number;
    staff: number;
    waste: number;
    revenue: number;    // from orders only
  };
  const productRollup = useMemo(() => {
    const m = new Map<string, ProductRow>();
    function row(productId: string): ProductRow {
      const cur = m.get(productId);
      if (cur) return cur;
      const fresh: ProductRow = {
        productId,
        productName: productById.get(productId)?.name ?? productId.slice(0, 8),
        sold: 0, tasting: 0, gift: 0, staff: 0, waste: 0, revenue: 0,
      };
      m.set(productId, fresh);
      return fresh;
    }
    for (const t of transfersInWin) {
      const r = row(t.entityId);
      const qty = Number(t.quantity ?? 0);
      switch (t.reason) {
        case "sold":
        case "event_sample":
          r.sold += qty; break;
        case "tasting":
          r.tasting += qty; break;
        case "gift":
          r.gift += qty; break;
        case "staff":
          r.staff += qty; break;
        case "waste":
          r.waste += qty; break;
      }
    }
    // Revenue captured on transfers themselves (unitPrice column).
    for (const t of transfersInWin) {
      if (t.unitPrice == null) continue;
      const r = row(t.entityId);
      r.revenue += Number(t.unitPrice) * Number(t.quantity ?? 0);
    }
    for (const it of itemsInWin) {
      const r = row(it.productId);
      r.sold += it.quantity;
      const unit = it.unitPrice ?? 0;
      r.revenue += unit * it.quantity;
    }
    return [...m.values()].sort((a, b) => b.sold - a.sold);
  }, [transfersInWin, itemsInWin, productById]);

  // ── Reason-pivot totals ──
  const reasonTotals = useMemo(() => {
    const out: Record<StockTransferReason, number> = {
      "auto-replenish": 0, "shop-request": 0, manual: 0, return: 0,
      waste: 0, gift: 0, tasting: 0, event_sample: 0, staff: 0, sold: 0,
      custom_box: 0,
    };
    for (const t of transfersInWin) {
      out[t.reason as StockTransferReason] = (out[t.reason as StockTransferReason] ?? 0) + Number(t.quantity ?? 0);
    }
    return out;
  }, [transfersInWin]);

  // ── Channel totals ──
  const channelTotals = useMemo(() => {
    const counter = transfersInWin
      .filter((t) => t.reason === "sold" || t.reason === "event_sample")
      .reduce((s, t) => s + Number(t.quantity ?? 0), 0);
    const orderTotals = new Map<string, number>(); // channel → pieces
    for (const o of ordersInWin) {
      const ch = o.channel || "other";
      const its = orderItems.filter((it) => it.orderId === o.id);
      const pcs = its.reduce((s, it) => s + it.quantity, 0);
      orderTotals.set(ch, (orderTotals.get(ch) ?? 0) + pcs);
    }
    return { counter, orderTotals: [...orderTotals.entries()] };
  }, [transfersInWin, ordersInWin, orderItems]);

  // ── Revenue from orders ──
  const totalRevenue = useMemo(() => {
    let total = 0;
    for (const it of itemsInWin) {
      const unit = it.unitPrice ?? 0;
      total += unit * it.quantity;
    }
    for (const t of transfersInWin) {
      if (t.unitPrice == null) continue;
      total += Number(t.unitPrice) * Number(t.quantity ?? 0);
    }
    return Math.round(total * 100) / 100;
  }, [itemsInWin, transfersInWin]);

  const totalSold = productRollup.reduce((s, r) => s + r.sold, 0);
  const totalGiven = productRollup.reduce((s, r) => s + r.tasting + r.gift + r.staff, 0);
  const totalWaste = productRollup.reduce((s, r) => s + r.waste, 0);

  // ── Packaging consumed ──
  const packagingRollup = useMemo(() => {
    const m = new Map<string, { name: string; qty: number }>();
    for (const l of packagingInWin) {
      const cur = m.get(l.packagingId) ?? {
        name: packagingById.get(l.packagingId)?.name ?? l.packagingId.slice(0, 8),
        qty: 0,
      };
      cur.qty += l.quantity;
      m.set(l.packagingId, cur);
    }
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.qty - a.qty);
  }, [packagingInWin, packagingById]);

  // ── Slow movers — products with no movement at all this window ──
  const movedProductIds = new Set(productRollup.map((r) => r.productId));
  const slowMovers = useMemo(
    () =>
      products
        .filter((p) => !p.archived && p.id && !movedProductIds.has(p.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, productRollup],
  );

  // ── Active campaigns in window — filter dropdown ──
  const campaignsTouching = useMemo(() => {
    return campaigns.filter(
      (c) => c.startDate <= to && c.endDate >= from,
    );
  }, [campaigns, from, to]);
  void campaignById;

  function setRange(kind: "this-week" | "last-week" | "this-month") {
    const now = new Date();
    if (kind === "this-week") {
      const m = startOfIsoWeek(now);
      setFrom(isoDate(m));
      setTo(isoDate(addDays(m, 6)));
    } else if (kind === "last-week") {
      const m = addDays(startOfIsoWeek(now), -7);
      setFrom(isoDate(m));
      setTo(isoDate(addDays(m, 6)));
    } else {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setFrom(isoDate(first));
      setTo(isoDate(last));
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Sales report"
        meta="Weekly roll-up · pieces sold + given + wasted · counter walk-ins + orders + booth events combined"
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Range picker */}
      <div>
        <div className="rounded-[6px] bg-[color:var(--ds-card-bg)] border border-[color:var(--ds-border-warm)] p-3 flex items-center flex-wrap gap-3">
          <div className="flex gap-1">
            <button
              onClick={() => setRange("this-week")}
              className="text-[11px] px-2.5 py-1 border border-[color:var(--ds-border-warm)] rounded-full hover:border-foreground"
            >
              This week
            </button>
            <button
              onClick={() => setRange("last-week")}
              className="text-[11px] px-2.5 py-1 border border-[color:var(--ds-border-warm)] rounded-full hover:border-foreground"
            >
              Last week
            </button>
            <button
              onClick={() => setRange("this-month")}
              className="text-[11px] px-2.5 py-1 border border-[color:var(--ds-border-warm)] rounded-full hover:border-foreground"
            >
              This month
            </button>
          </div>
          <div className="flex items-baseline gap-2 ml-auto text-[11px] text-muted-foreground">
            <span>From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input" />
            <span>to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input" />
          </div>
        </div>
        {campaignsTouching.length > 0 && (
          <p className="text-[11px] text-muted-foreground mt-2">
            Campaigns active in window:{" "}
            {campaignsTouching.map((c) => (
              <Link
                key={c.id}
                href={`/campaigns/${encodeURIComponent(c.id ?? "")}`}
                className="underline-offset-2 hover:underline mr-2"
              >
                {c.name}
              </Link>
            ))}
          </p>
        )}
      </div>

      {/* KPI tiles */}
      <div className="px-4 mb-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Tile label="Pieces sold" value={totalSold} />
        <Tile label="Given (tasting/gift/staff)" value={totalGiven} />
        <Tile label="Waste" value={totalWaste} tone="alert" />
        <Tile label="Revenue (orders)" value={`€${totalRevenue.toFixed(2)}`} />
      </div>

      {/* Products table */}
      <section className="px-4 mb-5">
        <h2 className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-2">
          By product · sorted by sold
        </h2>
        {productRollup.length === 0 ? (
          <p className="text-sm text-muted-foreground italic px-3 py-3 border border-dashed border-[color:var(--ds-border-warm)] rounded-[6px]">
            No movement in this window.
          </p>
        ) : (
          <div className="rounded-[6px] border border-[color:var(--ds-border-warm)] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Product</th>
                  <th className="text-right px-2 py-2 tabular-nums">Sold</th>
                  <th className="text-right px-2 py-2 tabular-nums">Tasting</th>
                  <th className="text-right px-2 py-2 tabular-nums">Gift</th>
                  <th className="text-right px-2 py-2 tabular-nums">Staff</th>
                  <th className="text-right px-2 py-2 tabular-nums">Waste</th>
                  <th className="text-right px-3 py-2 tabular-nums">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {productRollup.map((r) => (
                  <tr key={r.productId} className="border-t border-[color:var(--ds-border-warm)]">
                    <td className="px-3 py-1.5 truncate">{r.productName}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums font-medium">{r.sold || ""}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums text-muted-foreground">{r.tasting || ""}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums text-muted-foreground">{r.gift || ""}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums text-muted-foreground">{r.staff || ""}</td>
                    <td className="text-right px-2 py-1.5 tabular-nums text-status-alert">{r.waste || ""}</td>
                    <td className="text-right px-3 py-1.5 tabular-nums">{r.revenue > 0 ? `€${r.revenue.toFixed(2)}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Reason pivot */}
      <section className="px-4 mb-5">
        <h2 className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-2">
          By reason
        </h2>
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3 flex flex-wrap gap-3">
          {[...SOLD_REASONS, ...NON_REVENUE_REASONS].map((r) => (
            <div key={r} className="text-[12px]">
              <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                {STOCK_TRANSFER_REASON_LABELS[r]}
              </div>
              <div className="font-semibold tabular-nums">{reasonTotals[r] ?? 0} pcs</div>
            </div>
          ))}
        </div>
      </section>

      {/* By channel */}
      <section className="px-4 mb-5">
        <h2 className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-2">
          By channel
        </h2>
        <div className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-3 flex flex-wrap gap-4">
          <div className="text-[12px]">
            <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground">Counter / event</div>
            <div className="font-semibold tabular-nums">{channelTotals.counter} pcs</div>
          </div>
          {channelTotals.orderTotals.map(([ch, pcs]) => (
            <div key={ch} className="text-[12px]">
              <div className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground capitalize">
                Orders · {ch}
              </div>
              <div className="font-semibold tabular-nums">{pcs} pcs</div>
            </div>
          ))}
        </div>
      </section>

      {/* Packaging consumed */}
      {packagingRollup.length > 0 && (
        <section className="px-4 mb-5">
          <h2 className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-2">
            Packaging consumed (orders)
          </h2>
          <div className="rounded-[6px] border border-[color:var(--ds-border-warm)] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Packaging</th>
                  <th className="text-right px-3 py-2 tabular-nums">Used</th>
                </tr>
              </thead>
              <tbody>
                {packagingRollup.map((p) => (
                  <tr key={p.id} className="border-t border-[color:var(--ds-border-warm)]">
                    <td className="px-3 py-1.5 truncate">{p.name}</td>
                    <td className="text-right px-3 py-1.5 tabular-nums">{p.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Slow movers */}
      {slowMovers.length > 0 && (
        <section className="px-4 mb-8">
          <h2 className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-2">
            Slow movers · no movement in window ({slowMovers.length})
          </h2>
          <div className="rounded-[6px] border border-dashed border-[color:var(--ds-border-warm)] p-3 text-[12px] text-muted-foreground">
            {slowMovers.slice(0, 30).map((p) => p.name).join(", ")}
            {slowMovers.length > 30 ? ` · +${slowMovers.length - 30} more` : ""}
          </div>
        </section>
      )}
      </div>
    </div>
  );
}

function Tile({
  label, value, tone,
}: {
  label: string;
  value: string | number;
  tone?: "alert";
}) {
  return (
    <div
      className={
        "rounded-[6px] border p-3 " +
        (tone === "alert"
          ? "border-status-alert-edge bg-status-alert-bg/40 text-status-alert"
          : "border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]")
      }
    >
      <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-1">
        {label}
      </div>
      <div className="text-[20px] tabular-nums font-semibold" style={{ fontFamily: "var(--font-serif)" }}>
        {value}
      </div>
    </div>
  );
}
