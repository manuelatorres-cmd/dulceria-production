"use client";

import { useState, useMemo } from "react";
import {
  useOrders,
  useAllOrderItems,
  useAllOrderVariantLines,
  useProductsList,
  useVariants,
  useAllVariantPackagings,
  useAllVariantPackagingProducts,
  usePackagingList,
  useProductLocationTotals,
  useVariantStockLocations,
  useAllPlanProducts,
  useProductionPlans,
  useMoulds,
} from "@/lib/hooks";
import { ORDER_CHANNEL_LABELS } from "@/types";
import { BackButton } from "@/components/back-button";
import {
  IconSquareCheck as CheckSquare,
  IconSquare as Square,
  IconInfoCircle as Info,
  IconAlertTriangle as AlertTriangle,
  IconCheck as Check,
} from "@tabler/icons-react";

/**
 * Needed — pick open orders + see aggregated demand against current stock
 * and pieces already planned in production.
 *
 * Variant rows show packed-box on-hand. Product rows show loose-piece
 * on-hand (non-allocated, across store / production / freezer).
 * "Planned" counts pieces from active production plans whose batches
 * have not unmoulded yet (so they aren't double-counted with stockLocations).
 */
export default function NeededPage() {
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const orderVariantLines = useAllOrderVariantLines();
  const products = useProductsList();
  const variants = useVariants();
  const variantPackagings = useAllVariantPackagings();
  const variantComposition = useAllVariantPackagingProducts();
  const packagings = usePackagingList(true);
  const productLocations = useProductLocationTotals();
  const variantStock = useVariantStockLocations();
  const planProducts = useAllPlanProducts();
  const productionPlans = useProductionPlans();
  const moulds = useMoulds(true);

  const [selected, setSelected] = useState<Set<string>>(new Set());

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id!, p])),
    [products],
  );
  const variantById = useMemo(
    () => new Map(variants.map((v) => [v.id!, v])),
    [variants],
  );
  const vpById = useMemo(
    () => new Map(variantPackagings.map((vp) => [vp.id!, vp])),
    [variantPackagings],
  );
  const packagingById = useMemo(
    () => new Map(packagings.map((p) => [p.id!, p])),
    [packagings],
  );
  const mouldById = useMemo(
    () => new Map(moulds.map((m) => [m.id!, m])),
    [moulds],
  );
  const planById = useMemo(
    () => new Map(productionPlans.map((p) => [p.id!, p])),
    [productionPlans],
  );

  const openOrders = useMemo(
    () =>
      orders
        .filter(
          (o) =>
            o.status === "pending" ||
            o.status === "in_production" ||
            o.status === "ready_to_pack",
        )
        .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "")),
    [orders],
  );

  const demand = useMemo(() => {
    const byProduct = new Map<string, number>();
    const byVariantPack = new Map<string, number>();
    if (selected.size === 0) return { byProduct, byVariantPack };
    for (const it of orderItems) {
      if (!selected.has(it.orderId)) continue;
      if (it.variantId) continue; // variant-derived items handled via orderVariantLines
      const cur = byProduct.get(it.productId) ?? 0;
      byProduct.set(it.productId, cur + (it.quantity ?? 0));
    }
    for (const vl of orderVariantLines) {
      if (!selected.has(vl.orderId)) continue;
      if (!vl.variantPackagingId) continue;
      const cur = byVariantPack.get(vl.variantPackagingId) ?? 0;
      byVariantPack.set(vl.variantPackagingId, cur + (vl.quantity ?? 0));
    }
    return { byProduct, byVariantPack };
  }, [selected, orderItems, orderVariantLines]);

  const looseByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const [pid, locs] of productLocations.entries()) {
      m.set(pid, (locs.store ?? 0) + (locs.production ?? 0) + (locs.freezer ?? 0));
    }
    return m;
  }, [productLocations]);

  const packedByVp = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of variantStock) {
      if (r.orderId || r.productionOrderId) continue;
      const cur = m.get(r.variantPackagingId) ?? 0;
      m.set(r.variantPackagingId, cur + (r.quantity ?? 0));
    }
    return m;
  }, [variantStock]);

  const plannedByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const pp of planProducts) {
      if (pp.actualYield != null) continue;
      const plan = planById.get(pp.planId);
      if (!plan) continue;
      if (
        plan.status === "done" ||
        plan.status === "cancelled" ||
        plan.status === "orphaned"
      )
        continue;
      const mould = mouldById.get(pp.mouldId);
      const cavities = mould?.numberOfCavities ?? 0;
      const expected = (pp.quantity ?? 0) * cavities;
      if (expected <= 0) continue;
      const cur = m.get(pp.productId) ?? 0;
      m.set(pp.productId, cur + expected);
    }
    return m;
  }, [planProducts, planById, mouldById]);

  const compByVp = useMemo(() => {
    const m = new Map<string, Array<{ productId: string; qty: number }>>();
    for (const c of variantComposition) {
      const arr = m.get(c.variantPackagingId) ?? [];
      arr.push({ productId: c.productId, qty: c.qty });
      m.set(c.variantPackagingId, arr);
    }
    return m;
  }, [variantComposition]);

  const variantRows = useMemo(() => {
    const rows: Array<{
      key: string;
      label: string;
      needed: number;
      packed: number;
      planned: number;
      net: number;
      packableFromLoose: number;
    }> = [];
    for (const [vpId, needed] of demand.byVariantPack.entries()) {
      const vp = vpById.get(vpId);
      const variant = vp ? variantById.get(vp.variantId) : undefined;
      const pkg = vp?.packagingId ? packagingById.get(vp.packagingId) : undefined;
      const sizeLabel = pkg?.name ?? "no size";
      const label = `${variant?.name ?? "Unknown variant"} – ${sizeLabel}`;
      const packed = packedByVp.get(vpId) ?? 0;
      const planned = 0;
      const gapAfterStock = Math.max(0, needed - packed - planned);

      const composition = compByVp.get(vpId) ?? [];
      let packable = composition.length === 0 ? 0 : Number.POSITIVE_INFINITY;
      for (const c of composition) {
        const looseAvail = looseByProduct.get(c.productId) ?? 0;
        const boxesPossible = c.qty > 0 ? Math.floor(looseAvail / c.qty) : 0;
        if (boxesPossible < packable) packable = boxesPossible;
      }
      if (!Number.isFinite(packable)) packable = 0;

      rows.push({
        key: vpId,
        label,
        needed,
        packed,
        planned,
        net: gapAfterStock,
        packableFromLoose: Math.min(packable, gapAfterStock),
      });
    }
    rows.sort((a, b) => b.net - a.net || a.label.localeCompare(b.label));
    return rows;
  }, [demand.byVariantPack, vpById, variantById, packagingById, packedByVp, compByVp, looseByProduct]);

  const productRows = useMemo(() => {
    const rows: Array<{
      key: string;
      label: string;
      needed: number;
      loose: number;
      planned: number;
      net: number;
    }> = [];
    for (const [pid, needed] of demand.byProduct.entries()) {
      const p = productById.get(pid);
      const label = p?.name ?? pid.slice(0, 8);
      const loose = looseByProduct.get(pid) ?? 0;
      const planned = plannedByProduct.get(pid) ?? 0;
      rows.push({
        key: pid,
        label,
        needed,
        loose,
        planned,
        net: Math.max(0, needed - loose - planned),
      });
    }
    rows.sort((a, b) => b.net - a.net || a.label.localeCompare(b.label));
    return rows;
  }, [demand.byProduct, productById, looseByProduct, plannedByProduct]);

  function toggle(orderId: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  return (
    <div>
      <div className="mb-2">
        <BackButton />
      </div>
      <div className="flex items-baseline gap-3 mb-4 flex-wrap">
        <h1
          className="text-3xl"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400, letterSpacing: "-0.02em" }}
        >
          Needed
        </h1>
        <p className="text-sm text-muted-foreground">
          Pick open orders to see what's needed vs what's on stock and already planned.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-4">
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-sm font-medium">Open orders</h2>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {selected.size} / {openOrders.length}
            </span>
          </div>
          <div className="flex gap-3 mb-2 text-[11px]">
            <button
              type="button"
              onClick={() => setSelected(new Set(openOrders.map((o) => o.id!)))}
              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
              Clear
            </button>
          </div>
          {openOrders.length === 0 ? (
            <p className="text-xs text-muted-foreground">No open orders.</p>
          ) : (
            <ul className="space-y-1 max-h-[640px] overflow-auto pr-1">
              {openOrders.map((o) => {
                const checked = selected.has(o.id!);
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => toggle(o.id!)}
                      className={
                        "w-full text-left rounded-sm border px-2 py-1.5 flex items-start gap-2 transition " +
                        (checked
                          ? "border-foreground bg-foreground/5"
                          : "border-border hover:border-foreground/40")
                      }
                    >
                      {checked ? (
                        <CheckSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      ) : (
                        <Square className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="flex-1 min-w-0 text-[12px]">
                        <span className="block truncate">
                          {o.customerName ?? o.eventName ?? o.sourceRef ?? "Anonymous"}
                        </span>
                        <span className="block text-[10px] text-muted-foreground">
                          {ORDER_CHANNEL_LABELS[o.channel] ?? o.channel}
                          {o.deadline &&
                            " · " +
                              new Date(o.deadline).toLocaleDateString("de-AT", {
                                day: "numeric",
                                month: "short",
                              })}
                          {" · " + o.status}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-5">
          {selected.size === 0 ? (
            <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              Pick one or more orders on the left to see what's needed.
            </div>
          ) : (
            <>
              <Section
                title="Variants (boxed)"
                empty="No variant boxes in selected orders."
                hasAny={variantRows.length > 0}
              >
                {variantRows.map((r) => (
                  <RowCard
                    key={r.key}
                    label={r.label}
                    needed={r.needed}
                    finished={r.packed}
                    finishedLabel="Packed"
                    planned={r.planned}
                    plannedLabel="Planned"
                    net={r.net}
                    unit="boxes"
                    info={
                      r.packableFromLoose > 0
                        ? `${r.packableFromLoose} can be packed now from loose stock.`
                        : null
                    }
                  />
                ))}
              </Section>

              <Section
                title="Products (loose pieces)"
                empty="No loose-piece demand in selected orders."
                hasAny={productRows.length > 0}
              >
                {productRows.map((r) => (
                  <RowCard
                    key={r.key}
                    label={r.label}
                    needed={r.needed}
                    finished={r.loose}
                    finishedLabel="Loose"
                    planned={r.planned}
                    plannedLabel="Planned"
                    net={r.net}
                    unit="pieces"
                  />
                ))}
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  empty,
  hasAny,
  children,
}: {
  title: string;
  empty: string;
  hasAny: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-sm font-medium mb-2">{title}</h2>
      {!hasAny ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  );
}

interface RowCardProps {
  label: string;
  needed: number;
  finished: number;
  finishedLabel: string;
  planned: number;
  plannedLabel: string;
  net: number;
  unit: string;
  info?: string | null;
}

function RowCard(p: RowCardProps) {
  const ok = p.net === 0;
  return (
    <div
      className={
        "rounded-lg border p-3 " +
        (ok ? "border-status-ok-bg bg-status-ok-bg/20" : "border-border bg-card")
      }
    >
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-sm font-medium truncate">{p.label}</span>
        {ok ? (
          <span className="text-[11px] text-status-ok inline-flex items-center gap-1 shrink-0">
            <Check className="w-3 h-3" /> covered
          </span>
        ) : (
          <span className="text-[11px] text-status-blush inline-flex items-center gap-1 shrink-0">
            <AlertTriangle className="w-3 h-3" /> short
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[12px] tabular-nums">
        <Stat label="Needed" value={p.needed} unit={p.unit} />
        <Stat label={p.finishedLabel} value={p.finished} unit={p.unit} />
        <Stat label={p.plannedLabel} value={p.planned} unit={p.unit} />
        <Stat label="Net" value={p.net} unit={p.unit} emphasis={!ok} />
      </div>
      {p.info && (
        <p className="text-[11px] text-muted-foreground mt-1.5 inline-flex items-start gap-1">
          <Info className="w-3 h-3 mt-0.5 shrink-0" />
          {p.info}
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  emphasis,
}: {
  label: string;
  value: number;
  unit: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={emphasis ? "text-status-blush font-semibold" : ""}>
        {value} <span className="text-[10px] text-muted-foreground">{unit}</span>
      </div>
    </div>
  );
}
