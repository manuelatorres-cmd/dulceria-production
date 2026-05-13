"use client";

/**
 * Shop counter · custom box builder.
 *
 * Tablet-first flow for the shop: customer picks box size, then
 * picks bonbons, then we print a label. Every bonbon pulled here
 * deducts from shop stock immediately (via `custom_box_records`
 * inserts — stock deduction wired once product_stock rows exist).
 *
 * Design follows Manuela's v2 direction (warm neutrals, serif
 * headers, 4 px radius, editorial tone).
 */

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/dulceria";
import {
  useProductsList,
  useProductLocationTotals,
  useFillings,
} from "@/lib/hooks";
import type { Product } from "@/types";

type BoxSize = 4 | 8 | 16 | "other";

export default function ShopCounterPage() {
  const products = useProductsList();
  const stockByProduct = useProductLocationTotals();
  const fillings = useFillings();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [boxSize, setBoxSize] = useState<BoxSize>(8);
  const [customSize, setCustomSize] = useState<number>(8);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [printed, setPrinted] = useState(false);
  const [startedAt] = useState<number>(() => Date.now());
  const [elapsed, setElapsed] = useState<number>(0);

  // Filter to products that can be in a custom box.
  const eligible = useMemo(
    () =>
      products.filter(
        (p) =>
          !p.archived &&
          (p.includedInCustomBoxes ?? true) &&
          (p.productCategoryId ?? "").length > 0,
      ),
    [products],
  );

  // Quick stock lookup (shop location).
  const shopStock = useMemo(() => {
    const m = new Map<string, number>();
    for (const [productId, byLoc] of stockByProduct.entries()) {
      m.set(productId, byLoc.store ?? 0);
    }
    return m;
  }, [stockByProduct]);

  const totalPicked = useMemo(
    () => Object.values(picked).reduce((s, n) => s + n, 0),
    [picked],
  );
  const target = boxSize === "other" ? customSize : boxSize;
  const complete = totalPicked === target;
  const canAddMore = totalPicked < target;

  function addOne(productId: string) {
    if (!canAddMore) return;
    const stock = shopStock.get(productId) ?? 0;
    const current = picked[productId] ?? 0;
    if (current >= stock) return; // can't over-pull stock
    setPicked((p) => ({ ...p, [productId]: current + 1 }));
  }
  function removeOne(productId: string) {
    setPicked((p) => {
      const current = p[productId] ?? 0;
      if (current <= 1) {
        const { [productId]: _removed, ...rest } = p;
        return rest;
      }
      return { ...p, [productId]: current - 1 };
    });
  }

  function reset() {
    setStep(1);
    setBoxSize(8);
    setCustomSize(8);
    setPicked({});
    setPrinted(false);
  }

  // Live timer — updates every second to show how long the sale is taking.
  useMemo(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);

  function advance() {
    if (step === 1) {
      setStep(2);
    } else if (step === 2 && complete) {
      setStep(3);
    } else if (step === 3) {
      setStep(4);
    } else if (step === 4) {
      setPrinted(true);
      // Stock deduction + custom_box_records insert wired in a later
      // commit; for now the UI flow is the focus.
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Counter"
        meta="Custom box · pick size, choose bonbons, print label, close · aim for under 60 seconds per sale"
      />

      <div className="flex items-center justify-between gap-3 mb-6">
        <ol
          className="flex items-center gap-3 text-[10.5px] uppercase text-muted-foreground"
          style={{ letterSpacing: "0.12em" }}
        >
          {(["Size", "Bonbons", "Review", "Print"] as const).map((label, idx) => {
            const n = idx + 1;
            const on = step === n;
            const done = step > n;
            return (
              <li key={label} className="flex items-center gap-2">
                <span
                  className={
                    "w-5 h-5 inline-flex items-center justify-center text-[10px] font-medium border " +
                    (on
                      ? "bg-foreground text-background border-foreground"
                      : done
                        ? "bg-[color:var(--accent-terracotta-bg)] border-[color:var(--accent-terracotta-ink)] text-[color:var(--accent-terracotta-ink)]"
                        : "bg-card text-muted-foreground border-border")
                  }
                  style={{ borderRadius: 999 }}
                >
                  {n}
                </span>
                <span className={on ? "text-foreground" : ""}>{label}</span>
                {n < 4 ? <span className="w-4 h-px bg-border" /> : null}
              </li>
            );
          })}
        </ol>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {formatElapsed(elapsed)}
          </span>
          {step > 1 || Object.keys(picked).length > 0 ? (
            <button
              type="button"
              onClick={reset}
              className="text-[10px] uppercase text-muted-foreground hover:text-foreground"
              style={{ letterSpacing: "0.1em" }}
            >
              Reset
            </button>
          ) : null}
        </div>
      </div>

      {/* Step 1 — size */}
      {step === 1 ? (
        <section
          className="border border-border bg-card p-6"
          style={{ borderRadius: 4 }}
        >
          <h2
            className="text-[22px] mb-4"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 400,
              letterSpacing: "-0.02em",
            }}
          >
            Which <em>box size?</em>
          </h2>
          <div className="flex flex-wrap gap-3">
            {([4, 8, 16, "other"] as BoxSize[]).map((size) => (
              <button
                key={String(size)}
                type="button"
                onClick={() => setBoxSize(size)}
                className={
                  "text-center border transition-colors " +
                  (boxSize === size
                    ? "bg-foreground text-background border-foreground"
                    : "bg-card text-foreground border-border hover:border-foreground")
                }
                style={{
                  borderRadius: 4,
                  padding: "16px 28px",
                  minWidth: 90,
                }}
              >
                <span
                  className="block text-[20px]"
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontWeight: 500,
                    letterSpacing: "-0.015em",
                  }}
                >
                  {size === "other" ? "Other" : size}
                </span>
                <span
                  className="block text-[10px] uppercase mt-1"
                  style={{ letterSpacing: "0.12em", opacity: 0.7 }}
                >
                  {size === "other" ? "type qty" : "pcs"}
                </span>
              </button>
            ))}
          </div>
          {boxSize === "other" ? (
            <div className="mt-5">
              <label className="label">Piece count</label>
              <input
                type="number"
                min={1}
                value={customSize}
                onChange={(e) =>
                  setCustomSize(Math.max(1, Number(e.target.value) || 1))
                }
                className="input"
                style={{ maxWidth: 120 }}
              />
            </div>
          ) : null}
          <footer className="mt-6 flex justify-end">
            <button type="button" onClick={advance} className="btn-primary">
              Continue
            </button>
          </footer>
        </section>
      ) : null}

      {/* Step 2 — bonbons */}
      {step === 2 ? (
        <section
          className="border border-border bg-card p-6"
          style={{ borderRadius: 4 }}
        >
          <div className="flex items-baseline justify-between mb-4">
            <h2
              className="text-[22px]"
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 400,
                letterSpacing: "-0.02em",
              }}
            >
              Pick <em>{target}</em> bonbons
            </h2>
            <span
              className="text-[11px] uppercase text-muted-foreground"
              style={{ letterSpacing: "0.12em" }}
            >
              {totalPicked} / {target}
            </span>
          </div>

          {eligible.length === 0 ? (
            <p
              className="text-muted-foreground italic"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              No eligible products yet. Enable custom-box inclusion on a
              product and add stock to the shop location.
            </p>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {eligible.map((product) => (
                <BonbonCard
                  key={product.id}
                  product={product}
                  picked={picked[product.id ?? ""] ?? 0}
                  stock={shopStock.get(product.id ?? "") ?? 0}
                  onAdd={() => product.id && addOne(product.id)}
                  onRemove={() => product.id && removeOne(product.id)}
                  disabled={!canAddMore && (picked[product.id ?? ""] ?? 0) === 0}
                />
              ))}
            </ul>
          )}

          <footer className="mt-6 flex justify-between items-center">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="btn-secondary"
            >
              Back
            </button>
            <button
              type="button"
              onClick={advance}
              disabled={!complete}
              className="btn-primary"
            >
              Review
            </button>
          </footer>
        </section>
      ) : null}

      {/* Step 3 — review */}
      {step === 3 ? (
        <section
          className="border border-border bg-card p-6"
          style={{ borderRadius: 4 }}
        >
          <h2
            className="text-[22px] mb-4"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 400,
              letterSpacing: "-0.02em",
            }}
          >
            Review <em>label</em>
          </h2>
          <ReviewPanel
            picked={picked}
            products={eligible}
            fillings={fillings}
          />
          <footer className="mt-6 flex justify-between items-center">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="btn-secondary"
            >
              Back
            </button>
            <button type="button" onClick={advance} className="btn-primary">
              Print label
            </button>
          </footer>
        </section>
      ) : null}

      {/* Step 4 — print */}
      {step === 4 ? (
        <section
          className="border border-border bg-card p-6 text-center"
          style={{ borderRadius: 4 }}
        >
          <h2
            className="text-[22px] mb-4"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 400,
              letterSpacing: "-0.02em",
            }}
          >
            {printed ? "Printed." : "Ready to print."}
          </h2>
          {printed ? (
            <p
              className="text-muted-foreground italic"
              style={{ fontFamily: "var(--font-serif)", fontSize: 13 }}
            >
              Elapsed {formatElapsed(elapsed)} · label sent to printer (driver
              bridge lands with the next commit).
            </p>
          ) : (
            <button type="button" onClick={advance} className="btn-primary">
              Print
            </button>
          )}
          <footer className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={reset}
              className="btn-secondary"
            >
              New box
            </button>
          </footer>
        </section>
      ) : null}
    </div>
  );
}

function BonbonCard({
  product,
  picked,
  stock,
  onAdd,
  onRemove,
  disabled,
}: {
  product: Product;
  picked: number;
  stock: number;
  onAdd: () => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const atLimit = picked >= stock;
  const outOfStock = stock <= 0;
  return (
    <li
      className={
        "border p-3 transition-colors " +
        (picked > 0
          ? "border-foreground bg-card"
          : outOfStock
            ? "border-border bg-card opacity-50"
            : "border-border bg-card hover:border-foreground")
      }
      style={{ borderRadius: 4 }}
    >
      <div className="flex items-baseline justify-between mb-1.5">
        <strong
          className="text-[13px] leading-tight"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          {product.name}
        </strong>
        {picked > 0 ? (
          <span
            className="inline-flex items-center justify-center w-5 h-5 text-[11px] font-medium bg-[color:var(--accent-terracotta-ink)] text-white"
            style={{ borderRadius: 2 }}
          >
            {picked}
          </span>
        ) : null}
      </div>
      <p className="text-[10.5px] text-muted-foreground">
        {outOfStock ? "Out of stock" : `${stock} in shop`}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onRemove}
          disabled={picked === 0}
          className="w-7 h-7 border border-border disabled:opacity-30 hover:border-foreground text-foreground"
          style={{ borderRadius: 2 }}
        >
          −
        </button>
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled || atLimit || outOfStock}
          className="w-7 h-7 border border-border disabled:opacity-30 hover:border-foreground text-foreground"
          style={{ borderRadius: 2 }}
        >
          +
        </button>
        {atLimit && !outOfStock ? (
          <span className="ml-auto text-[10px] text-muted-foreground uppercase" style={{ letterSpacing: "0.06em" }}>
            Max
          </span>
        ) : null}
      </div>
    </li>
  );
}

function ReviewPanel({
  picked,
  products,
  fillings,
}: {
  picked: Record<string, number>;
  products: Product[];
  fillings: Array<{ id?: string; name: string; allergens?: string[] }>;
}) {
  const entries = Object.entries(picked)
    .filter(([_, qty]) => qty > 0)
    .map(([id, qty]) => {
      const product = products.find((p) => p.id === id);
      return { id, qty, product };
    });

  const allergens = new Set<string>();
  for (const e of entries) {
    // Pulled from linked fillings via the productFillings join table —
    // skipped for now, the label will read the real set in the next
    // commit. For display purposes gather any allergens declared on
    // fillings whose names show up in the product name (rough).
    for (const f of fillings) {
      if (
        f.name &&
        e.product?.name?.toLowerCase().includes(f.name.toLowerCase())
      ) {
        (f.allergens ?? []).forEach((a) => allergens.add(a));
      }
    }
  }
  const totalWeight = entries.reduce(
    (s, e) => s + e.qty * Math.round(8 /* placeholder 8g / bonbon */),
    0,
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <h4 className="label">Picked · {entries.reduce((s, e) => s + e.qty, 0)}</h4>
        <ul className="text-[13px] space-y-0.5">
          {entries.map((e) => (
            <li key={e.id}>
              <span className="tabular-nums text-muted-foreground mr-2">
                ×{e.qty}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                }}
              >
                {e.product?.name ?? e.id.slice(0, 8)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-muted-foreground mt-4">
          Net weight ≈ {totalWeight} g (placeholder — real value derived from
          product shell + fill grams in next commit)
        </p>
      </div>
      <div>
        <h4 className="label">Label preview</h4>
        <div
          className="border border-border bg-[color:var(--color-muted)] px-4 py-3 text-[10.5px] leading-relaxed"
          style={{ fontFamily: '"Courier New",monospace', borderRadius: 3 }}
        >
          <div
            className="text-[13px] mb-1"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 500,
              letterSpacing: "-0.01em",
            }}
          >
            Dulceria · Pralinenauswahl
          </div>
          <div>Dulceria GmbH · 1010 Wien · Austria</div>
          <div className="border-t border-dashed my-2 border-border" />
          <div>
            <strong>Inhalt:</strong>{" "}
            {entries
              .map((e) => `${e.qty}× ${e.product?.name ?? ""}`)
              .join(", ")}
          </div>
          <div className="border-t border-dashed my-2 border-border" />
          {allergens.size > 0 ? (
            <div>
              <strong>Allergene:</strong>{" "}
              {Array.from(allergens).map((a) => (
                <strong key={a}>{a} </strong>
              ))}
            </div>
          ) : (
            <div className="text-muted-foreground italic">
              Allergene werden beim nächsten Commit aus den Füllungen
              übernommen.
            </div>
          )}
          <div className="border-t border-dashed my-2 border-border" />
          <div>MHD: {futureDate(28)} · Charge: C-{batchStamp()}</div>
          <div>Nettogewicht: {totalWeight} g · kühl &amp; trocken lagern</div>
        </div>
      </div>
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function futureDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("de-AT");
}

function batchStamp(): string {
  const now = new Date();
  return (
    now.toISOString().slice(2, 10).replace(/-/g, "") +
    "-" +
    Math.random().toString(36).slice(2, 5).toUpperCase()
  );
}
