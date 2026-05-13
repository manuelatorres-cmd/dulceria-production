"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  useOrders,
  useAllOrderItems,
  useProductsList,
  useVariants,
  useAllVariantPackagings,
  useAllVariantPackagingProducts,
  useAllVariantPackagingComponents,
  usePackagingList,
  useProductLocationTotals,
  useVariantStockLocations,
  useAllOrderVariantLines,
  markOrderAsPacked,
  saveOrder,
  boxUpVariant,
} from "@/lib/hooks";
import { ORDER_CHANNEL_LABELS } from "@/types";
import type { StockLocation } from "@/types";
import { IconPackage as Package, IconAlertTriangle as AlertTriangle, IconCheck as Check, IconExternalLink as ExternalLink, IconBox as Box } from "@tabler/icons-react";
import { BackButton } from "@/components/back-button";

type Tab = "pack" | "box";

/**
 * Picking — two tabs:
 *
 *   1. Pack & ship — orders flagged ready_to_pack get a one-click drain
 *      of allocated stock + packaging deduction + status flip to done.
 *
 *   2. Box up — turn loose pieces in production / store into pre-built
 *      variant boxes. Operator picks count + destination per variant
 *      size; boxUpVariant consumes composition products + packaging
 *      components and increments variant on-hand.
 */
export default function PickingPage() {
  const [tab, setTab] = useState<Tab>("pack");

  return (
    <div className="ds px-6 py-5 max-w-5xl mx-auto" style={{ background: "var(--ds-page-bg)" }}>
      <div className="mb-2">
        <BackButton />
      </div>
      <div className="flex items-baseline gap-3 mb-4">
        <h1
          className="text-3xl"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400, letterSpacing: "-0.02em" }}
        >
          Picking
        </h1>
        <p className="text-sm text-muted-foreground">
          Ship ready orders + assemble boxed inventory.
        </p>
      </div>

      <div className="inline-flex rounded-full border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden text-sm mb-4">
        <button
          type="button"
          onClick={() => setTab("pack")}
          className={"px-4 py-1.5 transition " + (tab === "pack" ? "bg-[color:var(--ds-tier-quarter-focus)] text-white" : "text-muted-foreground hover:text-foreground")}
        >
          Pack & ship
        </button>
        <button
          type="button"
          onClick={() => setTab("box")}
          className={"px-4 py-1.5 transition " + (tab === "box" ? "bg-[color:var(--ds-tier-quarter-focus)] text-white" : "text-muted-foreground hover:text-foreground")}
        >
          Box up
        </button>
      </div>

      {tab === "pack" ? <PackTab /> : <BoxTab />}
    </div>
  );
}

// ─── Tab 1: Pack & ship ────────────────────────────────────────────

function PackTab() {
  const orders = useOrders();
  const items = useAllOrderItems();
  const products = useProductsList();
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, { pieces: number; warnings: string[] }>>({});

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id!, p])),
    [products],
  );
  const itemsByOrder = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const it of items) {
      const arr = m.get(it.orderId) ?? [];
      arr.push(it);
      m.set(it.orderId, arr);
    }
    return m;
  }, [items]);

  const ready = useMemo(() => {
    return orders
      .filter((o) => o.status === "ready_to_pack")
      .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""));
  }, [orders]);

  async function handlePack(orderId: string) {
    setBusy((b) => ({ ...b, [orderId]: true }));
    setErrors((e) => ({ ...e, [orderId]: "" }));
    try {
      const result = await markOrderAsPacked(orderId);
      const ord = orders.find((o) => o.id === orderId);
      if (ord) {
        await saveOrder({ ...ord, status: "done" });
      }
      setDone((d) => ({
        ...d,
        [orderId]: { pieces: result.piecesMoved, warnings: result.warnings },
      }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrors((er) => ({ ...er, [orderId]: msg }));
    } finally {
      setBusy((b) => ({ ...b, [orderId]: false }));
    }
  }

  if (ready.length === 0) {
    return (
      <div className="rounded-lg border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-8 text-center">
        <Package className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No orders ready to pack. New online imports + B2B / event orders with allocated
          stock will appear here automatically.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {ready.map((o) => {
        const orderItems = itemsByOrder.get(o.id!) ?? [];
        const totalPieces = orderItems.reduce((s, it) => s + (it.quantity ?? 0), 0);
        const isBusy = busy[o.id!] ?? false;
        const err = errors[o.id!];
        const completed = done[o.id!];
        return (
          <li
            key={o.id}
            className={
              "rounded-lg border p-3 flex items-start gap-3 transition " +
              (completed
                ? "border-status-ok-bg bg-status-ok-bg/30"
                : err
                ? "border-status-blush-bg bg-status-blush-bg/30"
                : "border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]")
            }
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-[13px] font-medium">
                  {o.customerName ?? o.sourceRef ?? "Anonymous"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  · {ORDER_CHANNEL_LABELS[o.channel] ?? o.channel}
                </span>
                {o.sourceRef && (
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    · {o.sourceRef}
                  </span>
                )}
                {o.deadline && (
                  <span className="text-[11px] text-muted-foreground">
                    · due {new Date(o.deadline).toLocaleDateString("de-AT", { day: "numeric", month: "short" })}
                  </span>
                )}
                <Link
                  href={`/orders/${o.id}?from=picking`}
                  className="ml-auto text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  open <ExternalLink className="w-3 h-3" />
                </Link>
              </div>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {orderItems.length} line{orderItems.length === 1 ? "" : "s"} ·{" "}
                {totalPieces} piece{totalPieces === 1 ? "" : "s"}
              </p>
              <ul className="mt-1.5 text-[12px] space-y-0.5">
                {orderItems.slice(0, 5).map((it, i) => (
                  <li key={i} className="text-muted-foreground">
                    {it.quantity}× {productById.get(it.productId)?.name ?? it.productId.slice(0, 8)}
                  </li>
                ))}
                {orderItems.length > 5 && (
                  <li className="text-muted-foreground/70">
                    + {orderItems.length - 5} more
                  </li>
                )}
              </ul>
              {err && (
                <p className="text-[11px] text-status-alert mt-1.5 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  {err}
                </p>
              )}
              {completed && (
                <p className="text-[11px] text-status-ok mt-1.5 flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  Packed · {completed.pieces} pcs moved
                  {completed.warnings.length > 0 && ` · ${completed.warnings.length} warning(s)`}
                </p>
              )}
            </div>
            {!completed && (
              <button
                type="button"
                onClick={() => handlePack(o.id!)}
                disabled={isBusy}
                className="rounded-full px-3 py-1.5 text-xs font-medium bg-[color:var(--ds-tier-quarter-focus)] text-white hover:opacity-90 disabled:opacity-50 shrink-0"
              >
                {isBusy ? "Packing…" : "Pack & ship"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Tab 2: Box up ─────────────────────────────────────────────────

const BOX_DESTINATIONS: Array<{ id: StockLocation; label: string }> = [
  { id: "store", label: "Shop" },
  { id: "production", label: "Production storage" },
  { id: "freezer", label: "Freezer" },
];

function BoxTab() {
  const variants = useVariants();
  const packagings = useAllVariantPackagings();
  const compositions = useAllVariantPackagingProducts();
  const components = useAllVariantPackagingComponents();
  const products = useProductsList();
  const packagingList = usePackagingList(true);
  const productLocations = useProductLocationTotals();
  const variantStock = useVariantStockLocations();
  const variantLines = useAllOrderVariantLines();
  const orders = useOrders();

  const [counts, setCounts] = useState<Record<string, number>>({});
  const [destinations, setDestinations] = useState<Record<string, StockLocation>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<Record<string, number>>({});

  const variantById = useMemo(
    () => new Map(variants.map((v) => [v.id!, v])),
    [variants],
  );
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id!, p])),
    [products],
  );
  const packagingById = useMemo(
    () => new Map(packagingList.map((p) => [p.id!, p])),
    [packagingList],
  );

  // Group composition + components per variantPackagingId
  const compByVp = useMemo(() => {
    const m = new Map<string, typeof compositions>();
    for (const c of compositions) {
      const arr = m.get(c.variantPackagingId) ?? [];
      arr.push(c);
      m.set(c.variantPackagingId, arr);
    }
    return m;
  }, [compositions]);
  const compsByVp = useMemo(() => {
    const m = new Map<string, typeof components>();
    for (const k of components) {
      const arr = m.get(k.variantPackagingId) ?? [];
      arr.push(k);
      m.set(k.variantPackagingId, arr);
    }
    return m;
  }, [components]);

  // Variant on-hand per (variantPackagingId, location)
  const onHandByVpLocation = useMemo(() => {
    const m = new Map<string, Map<StockLocation, number>>();
    for (const r of variantStock) {
      if (r.orderId || r.productionOrderId) continue; // skip allocated reservations
      const inner = m.get(r.variantPackagingId) ?? new Map<StockLocation, number>();
      inner.set(r.location, (inner.get(r.location) ?? 0) + (r.quantity ?? 0));
      m.set(r.variantPackagingId, inner);
    }
    return m;
  }, [variantStock]);

  // Demand per variant size from open orders. Sum orderVariantLines
  // quantity for non-terminal orders (pending / ready_to_pack /
  // in_production). 'done' + 'cancelled' don't count.
  const demandByVp = useMemo(() => {
    const openOrderIds = new Set(
      orders
        .filter((o) => o.status !== "done" && o.status !== "cancelled")
        .map((o) => o.id!)
        .filter(Boolean),
    );
    const m = new Map<string, number>();
    for (const line of variantLines) {
      if (!line.variantPackagingId) continue;
      if (!openOrderIds.has(line.orderId)) continue;
      m.set(
        line.variantPackagingId,
        (m.get(line.variantPackagingId) ?? 0) + (line.quantity ?? 0),
      );
    }
    return m;
  }, [variantLines, orders]);

  // Loose product pieces in production + store across all batches.
  function looseAvailable(productId: string): number {
    const byLoc = productLocations.get(productId);
    if (!byLoc) return 0;
    return (byLoc.production ?? 0) + (byLoc.store ?? 0);
  }

  // Live-reserved consumption from OTHER rows' current count inputs.
  // Recomputed per render so typing in one row instantly tightens the
  // max on every other row that shares a product or packaging.
  const reservedProducts = useMemo(() => {
    const m = new Map<string, number>();
    for (const [otherVp, otherCount] of Object.entries(counts)) {
      if (!otherCount || otherCount <= 0) continue;
      const otherComp = compByVp.get(otherVp) ?? [];
      for (const c of otherComp) {
        m.set(c.productId, (m.get(c.productId) ?? 0) + c.qty * otherCount);
      }
    }
    return m;
  }, [counts, compByVp]);

  const reservedPackaging = useMemo(() => {
    const m = new Map<string, number>();
    for (const [otherVp, otherCount] of Object.entries(counts)) {
      if (!otherCount || otherCount <= 0) continue;
      const otherComps = compsByVp.get(otherVp) ?? [];
      for (const k of otherComps) {
        m.set(k.packagingId, (m.get(k.packagingId) ?? 0) + k.qtyPerVariant * otherCount);
      }
    }
    return m;
  }, [counts, compsByVp]);

  function maxBuildable(vpId: string): { max: number; bottleneck: string | null } {
    const comp = compByVp.get(vpId) ?? [];
    const comps = compsByVp.get(vpId) ?? [];
    if (comp.length === 0) return { max: 0, bottleneck: "no composition defined" };
    const ownCount = counts[vpId] ?? 0;
    let max = Infinity;
    let bottleneck: string | null = null;
    for (const c of comp) {
      if (c.qty <= 0) continue;
      const stock = looseAvailable(c.productId);
      // Reserved by other rows = total reserved minus what THIS row's
      // current input has reserved for itself.
      const ownReserved = c.qty * ownCount;
      const reservedElsewhere = (reservedProducts.get(c.productId) ?? 0) - ownReserved;
      const free = stock - reservedElsewhere;
      const n = Math.floor(Math.max(0, free) / c.qty);
      if (n < max) {
        max = n;
        bottleneck = `${productById.get(c.productId)?.name ?? c.productId.slice(0, 8)} (${free} pcs free)`;
      }
    }
    for (const k of comps) {
      if (k.qtyPerVariant <= 0) continue;
      const stock = packagingById.get(k.packagingId)?.quantityOnHand ?? 0;
      const ownReserved = k.qtyPerVariant * ownCount;
      const reservedElsewhere = (reservedPackaging.get(k.packagingId) ?? 0) - ownReserved;
      const free = stock - reservedElsewhere;
      const n = Math.floor(Math.max(0, free) / k.qtyPerVariant);
      if (n < max) {
        max = n;
        bottleneck = `${packagingById.get(k.packagingId)?.name ?? k.packagingId.slice(0, 8)} (${free} units free)`;
      }
    }
    return { max: max === Infinity ? 0 : max, bottleneck };
  }

  // Show every variant size that has packaging (packagingId set OR at
  // least one component). Loose variants (no packaging at all) stay
  // outside this flow — they're sold straight from product loose stock.
  // Packaged variants without a composition still render with a
  // "needs composition" notice so the operator knows what to fix.
  const boxableVps = useMemo(() => {
    return packagings
      .filter((vp) => {
        return !!vp.packagingId || (compsByVp.get(vp.id!)?.length ?? 0) > 0;
      })
      .sort((a, b) => {
        const an = variantById.get(a.variantId)?.name ?? "";
        const bn = variantById.get(b.variantId)?.name ?? "";
        return an.localeCompare(bn);
      });
  }, [packagings, compsByVp, variantById]);

  async function handleBoxUp(vpId: string) {
    const count = counts[vpId] ?? 0;
    if (count <= 0) return;
    const dest = destinations[vpId] ?? "store";
    setBusy((b) => ({ ...b, [vpId]: true }));
    setErrors((e) => ({ ...e, [vpId]: "" }));
    try {
      await boxUpVariant({
        variantPackagingId: vpId,
        count,
        destination: dest,
      });
      setSuccess((s) => ({ ...s, [vpId]: (s[vpId] ?? 0) + count }));
      setCounts((c) => ({ ...c, [vpId]: 0 }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrors((er) => ({ ...er, [vpId]: msg }));
    } finally {
      setBusy((b) => ({ ...b, [vpId]: false }));
    }
  }

  if (boxableVps.length === 0) {
    return (
      <div className="rounded-lg border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-8 text-center">
        <Box className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No boxed variants defined. Add a variant size with packaging + product composition on /variants/[id] to enable box-up here.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {boxableVps.map((vp) => {
        const variant = variantById.get(vp.variantId);
        const comp = compByVp.get(vp.id!) ?? [];
        const comps = compsByVp.get(vp.id!) ?? [];
        const { max, bottleneck } = maxBuildable(vp.id!);
        const onHand = onHandByVpLocation.get(vp.id!);
        const onHandTotal = onHand
          ? [...onHand.values()].reduce((s, n) => s + n, 0)
          : 0;
        const isBusy = busy[vp.id!] ?? false;
        const err = errors[vp.id!];
        const succ = success[vp.id!] ?? 0;
        const count = counts[vp.id!] ?? 0;
        const dest = destinations[vp.id!] ?? "store";
        const sizeLabel = vp.packagingId
          ? packagingById.get(vp.packagingId)?.name ?? "size"
          : "loose";

        return (
          <li
            key={vp.id}
            className={
              "rounded-lg border p-3 transition " +
              (err
                ? "border-status-blush-bg bg-status-blush-bg/30"
                : succ > 0
                ? "border-status-ok-bg bg-status-ok-bg/30"
                : "border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]")
            }
          >
            <div className="flex items-baseline gap-2 flex-wrap mb-1">
              <span className="text-[13px] font-medium">
                {variant?.name ?? "Variant"} · {sizeLabel}
              </span>
              <span className="text-[11px] text-muted-foreground">
                On hand: {onHandTotal}
                {onHand && onHand.size > 1 && (
                  <>
                    {" "}({[...onHand.entries()]
                      .filter(([, q]) => q > 0)
                      .map(([loc, q]) => `${q} ${loc}`)
                      .join(" · ")})
                  </>
                )}
              </span>
              {(() => {
                const demand = demandByVp.get(vp.id!) ?? 0;
                if (demand === 0) return null;
                const short = Math.max(0, demand - onHandTotal);
                const cls = short > 0 ? "text-status-alert font-medium" : "text-status-ok";
                return (
                  <span className={"text-[11px] " + cls}>
                    Need {demand} for orders
                    {short > 0 ? ` · short ${short}` : " · ✓ covered"}
                  </span>
                );
              })()}
              <span className={"text-[11px] ml-auto " + (max > 0 ? "text-muted-foreground" : "text-status-alert")}>
                Can build {max}
                {bottleneck && max < 100 ? ` (limited by ${bottleneck})` : ""}
              </span>
            </div>
            {comp.length === 0 ? (
              <p className="text-[11px] text-status-alert mb-2 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                No composition set on this variant yet. Open the variant page to fill it before box-up.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground mb-2">
                Per box: {comp.map((c) => `${c.qty}× ${productById.get(c.productId)?.name ?? c.productId.slice(0, 8)}`).join(", ")}
                {comps.length > 0 && (
                  <>
                    {" + "}
                    {comps.map((k) => `${k.qtyPerVariant}× ${packagingById.get(k.packagingId)?.name ?? k.packagingId.slice(0, 8)}`).join(", ")}
                  </>
                )}
              </p>
            )}
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={max}
                value={count || ""}
                onChange={(e) => setCounts((c) => ({ ...c, [vp.id!]: Math.max(0, Math.min(max, Number(e.target.value) || 0)) }))}
                placeholder="0"
                className="w-20 rounded border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-2 py-1 text-sm tabular-nums"
              />
              <span className="text-[11px] text-muted-foreground">→</span>
              <select
                value={dest}
                onChange={(e) => setDestinations((d) => ({ ...d, [vp.id!]: e.target.value as StockLocation }))}
                className="rounded border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-2 py-1 text-sm"
              >
                {BOX_DESTINATIONS.map((d) => (
                  <option key={d.id} value={d.id}>{d.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleBoxUp(vp.id!)}
                disabled={isBusy || count <= 0 || count > max}
                className="rounded-full px-3 py-1 text-xs font-medium bg-[color:var(--ds-tier-quarter-focus)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {isBusy ? "Boxing…" : "Box up"}
              </button>
              {succ > 0 && (
                <span className="text-[11px] text-status-ok inline-flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  +{succ} so far
                </span>
              )}
            </div>
            {err && (
              <p className="text-[11px] text-status-alert mt-2 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                {err}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
