"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/dulceria";
import {
  useProductsList, useOrders, importOnlineOrders, appendProductAliases,
  appendVariantAliases,
  useVariants, useAllVariantPackagings,
  usePackagingList, useProductLocationTotals,
} from "@/lib/hooks";
import { parseShopifyCsv, type ShopifyParseResult, type ShopifyParsedOrder } from "@/lib/shopifyImport";
import { IconArrowLeft as ArrowLeft, IconUpload as Upload, IconFileAlert as FileWarning, IconCircleCheck as CheckCircle } from "@tabler/icons-react";

const DEFAULT_LEAD_DAYS = 3;

/** Encoded picker value: "product:<id>" or "variant:<variantId>:<vpId|->" */
type PickerValue = string;

const SKIP_LINE: PickerValue = "skip";

function encodeProduct(productId: string): PickerValue {
  return `product:${productId}`;
}
function encodeVariant(variantId: string, vpId: string | null): PickerValue {
  return `variant:${variantId}:${vpId ?? "-"}`;
}
function decodePicker(v: PickerValue):
  | { kind: "product"; productId: string }
  | { kind: "variant"; variantId: string; variantPackagingId: string | null }
  | { kind: "skip" }
  | null {
  if (!v) return null;
  if (v === SKIP_LINE) return { kind: "skip" };
  const [kind, a, b] = v.split(":");
  if (kind === "product" && a) return { kind: "product", productId: a };
  if (kind === "variant" && a) {
    return { kind: "variant", variantId: a, variantPackagingId: b && b !== "-" ? b : null };
  }
  return null;
}

export default function ShopifyImportPage() {
  const router = useRouter();
  const products = useProductsList(true);
  const variants = useVariants();
  const variantPackagings = useAllVariantPackagings();
  const packagingList = usePackagingList(true);
  const orders = useOrders();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ShopifyParseResult | null>(null);
  const [manualAssignments, setManualAssignments] = useState<Map<string, PickerValue>>(new Map());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  /** Per-line fulfilment mode picked by the operator on the preview.
   *  Online channel default = borrow (ship from existing stock; the
   *  shop is the source of truth for online sales). Operator flips
   *  individual lines to "produce" when stock is short or the order
   *  spec requires a fresh batch. */
  const [produceSet, setProduceSet] = useState<Set<string>>(new Set());
  const productLocationTotals = useProductLocationTotals();
  /** Lines where the user clicked "Different variant…" to broaden the
   *  dropdown beyond the matched variant's sizes. Keyed by lineKey. */
  const [expandedPickers, setExpandedPickers] = useState<Set<string>>(new Set());
  const [leadDays, setLeadDays] = useState<number>(DEFAULT_LEAD_DAYS);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState("");

  const existingRefs = useMemo(
    () => new Set(orders.map((o) => o.sourceRef).filter((x): x is string => !!x)),
    [orders],
  );
  const packagingById = useMemo(
    () => new Map(packagingList.map((p) => [p.id!, p])),
    [packagingList],
  );

  function lineKey(orderName: string, idx: number): string {
    return `${orderName}#${idx}`;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const p = parseShopifyCsv(text, {
        products,
        variants,
        variantPackagings,
        packagings: packagingList,
        existingOrderNames: existingRefs,
      });
      setParsed(p);
      setManualAssignments(new Map());
      setExcluded(new Set());
      setResult(null);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Failed to read file");
    }
  }

  function autoPicker(line: ShopifyParsedOrder["lineItems"][number]): PickerValue | undefined {
    if (line.resolvedVariantId) {
      // Variant matched — but if no size was decided AND sizes exist
      // we leave the picker empty so the user explicitly picks one.
      // Surfacing a `variant:UUID:-` value when no matching <option>
      // exists silently shows blank in the dropdown and hides the
      // match.
      const sizes = variantSizesFor(line.resolvedVariantId);
      if (sizes.length > 1 && !line.resolvedVariantPackagingId) {
        return undefined;
      }
      return encodeVariant(line.resolvedVariantId, line.resolvedVariantPackagingId ?? null);
    }
    if (line.resolvedProductId) {
      return encodeProduct(line.resolvedProductId);
    }
    return undefined;
  }

  function getPick(orderName: string, idx: number, line: ShopifyParsedOrder["lineItems"][number]): PickerValue | undefined {
    return manualAssignments.get(lineKey(orderName, idx)) ?? autoPicker(line);
  }

  function setAssignment(orderName: string, idx: number, value: PickerValue) {
    setManualAssignments((prev) => {
      const next = new Map(prev);
      if (!value) next.delete(lineKey(orderName, idx));
      else next.set(lineKey(orderName, idx), value);
      return next;
    });
  }

  // Helper: variant size needs explicit pick if multiple sizes exist.
  function variantSizesFor(variantId: string) {
    return variantPackagings.filter((vp) => vp.variantId === variantId);
  }

  const importable = useMemo(() => {
    if (!parsed) return { orders: [] as ShopifyParsedOrder[], unresolvedCount: 0, skippedCount: 0, excludedCount: 0 };
    const duplicates = new Set(parsed.duplicateNames);
    let unresolved = 0;
    let excludedActive = 0;
    const readyOrders: ShopifyParsedOrder[] = [];
    for (const o of parsed.orders) {
      if (duplicates.has(o.name)) continue;
      if (excluded.has(o.name)) { excludedActive++; continue; }
      const allResolved = o.lineItems.every((li, i) => {
        const v = getPick(o.name, i, li);
        if (!v) return false;
        const dec = decodePicker(v);
        if (!dec) return false;
        if (dec.kind === "skip") return true; // explicit skip counts as resolved
        if (dec.kind === "variant") {
          // Variant must have a size if any sizes exist for it.
          const sizes = variantSizesFor(dec.variantId);
          if (sizes.length > 0 && !dec.variantPackagingId) return false;
        }
        return true;
      });
      const hasAnyImportableLine = o.lineItems.some((li, i) => {
        const v = getPick(o.name, i, li);
        if (!v) return false;
        const dec = decodePicker(v);
        return dec !== null && dec.kind !== "skip";
      });
      if (allResolved && !hasAnyImportableLine) {
        // Every line was marked skip → drop the whole order from the
        // import (no point creating an empty order).
        excludedActive++;
        continue;
      }
      if (!allResolved) {
        unresolved++;
        continue;
      }
      readyOrders.push(o);
    }
    return { orders: readyOrders, unresolvedCount: unresolved, skippedCount: duplicates.size, excludedCount: excludedActive };
  }, [parsed, manualAssignments, variantPackagings, excluded]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    setError("");
    try {
      // Persist manual mappings as aliases. Track separately for
      // products and variants so each lands on the right table.
      const productAliasAdds = new Map<string, Set<string>>();
      const variantAliasAdds = new Map<string, Set<string>>();
      for (const o of importable.orders) {
        for (let i = 0; i < o.lineItems.length; i++) {
          const li = o.lineItems[i];
          const manualRaw = manualAssignments.get(lineKey(o.name, i));
          if (!manualRaw) continue;
          const dec = decodePicker(manualRaw);
          if (!dec) continue;
          if (dec.kind === "skip") continue;
          // Was the parser's auto-pick the same? If yes, no manual
          // correction → skip.
          if (autoPicker(li) === manualRaw) continue;
          if (dec.kind === "product") {
            const set = productAliasAdds.get(dec.productId) ?? new Set();
            set.add(li.name);
            productAliasAdds.set(dec.productId, set);
          } else {
            const set = variantAliasAdds.get(dec.variantId) ?? new Set();
            set.add(li.name);
            variantAliasAdds.set(dec.variantId, set);
          }
        }
      }
      for (const [productId, names] of productAliasAdds) {
        try { await appendProductAliases(productId, [...names]); }
        catch (e) { console.warn("product alias save failed", e); }
      }
      for (const [variantId, names] of variantAliasAdds) {
        try { await appendVariantAliases(variantId, [...names]); }
        catch (e) { console.warn("variant alias save failed", e); }
      }

      const payload = importable.orders.map((o) => {
        const placed = o.placedAt ? new Date(o.placedAt) : new Date();
        const deadline = new Date(placed.getTime() + leadDays * 86_400_000);
        return {
          sourceRef: o.name,
          customerName: o.shippingName,
          email: o.email,
          placedAt: o.placedAt,
          shippingAddress: o.shippingAddress,
          phone: o.phone,
          deadline: deadline.toISOString(),
          items: o.lineItems
            .map((li, i) => {
              const dec = decodePicker(getPick(o.name, i, li)!);
              if (!dec || dec.kind === "skip") return null;
              const fulfilmentMode = produceSet.has(lineKey(o.name, i)) ? "produce" as const : "borrow" as const;
              if (dec.kind === "product") {
                return {
                  kind: "product" as const,
                  productId: dec.productId,
                  quantity: li.quantity,
                  unitPrice: li.unitPrice,
                  notes: li.sku ? `SKU ${li.sku}` : undefined,
                  fulfilmentMode,
                };
              }
              return {
                kind: "variant" as const,
                variantId: dec.variantId,
                variantPackagingId: dec.variantPackagingId,
                quantity: li.quantity,
                unitPrice: li.unitPrice,
                notes: li.sku ? `SKU ${li.sku}` : undefined,
                fulfilmentMode,
              };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null),
        };
      });
      const imported = await importOnlineOrders(payload);
      setResult({ imported, skipped: (parsed.orders.length - importable.orders.length) });
    } catch (ex) {
      const raw: { message?: string; code?: string; details?: string; hint?: string } =
        ex instanceof Error ? { message: ex.message } : ((ex as Record<string, string>) ?? {});
      const code = raw.code ? ` (${raw.code})` : "";
      const hint = raw.hint ? ` — ${raw.hint}` : "";
      const details = raw.details ? ` — ${raw.details}` : "";
      setError(`${raw.message ?? "Import failed"}${code}${hint}${details}`);
      console.error("import failed:", ex);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader title="Import Shopify orders" meta="Upload a Shopify orders CSV export" />
      <div className="px-4 pb-10 space-y-5">
        <Link href="/orders/online" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Online orders
        </Link>

        {!parsed && !result && (
          <section className="rounded-sm border border-dashed border-[color:var(--ds-border-warm)] bg-card p-8 text-center space-y-3">
            <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
            <div>
              <p className="text-sm">Drop your Shopify orders CSV here or</p>
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-2 rounded-sm bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
              >
                Choose file
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Expected columns: <code>Name</code>, <code>Lineitem name</code>, <code>Lineitem quantity</code>,
              plus the usual Shopify fields (<code>Email</code>, <code>Shipping Name</code>, <code>Lineitem sku</code>…).
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFile}
            />
          </section>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {parsed && parsed.missingRequiredColumns.length > 0 && (
          <div className="rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2 text-xs text-status-warn">
            <FileWarning className="w-4 h-4 inline mr-1" />
            Missing required columns: <code>{parsed.missingRequiredColumns.join(", ")}</code>. This doesn&apos;t look like a Shopify orders export.
          </div>
        )}

        {result && (
          <div className="rounded-sm border border-status-ok-edge bg-status-ok-bg p-4 flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-status-ok mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-status-ok">
                Imported {result.imported} order{result.imported === 1 ? "" : "s"}
              </p>
              {result.skipped > 0 && (
                <p className="text-xs text-muted-foreground">
                  {result.skipped} skipped — {parsed?.duplicateNames.length ? "already imported" : "unresolved line items"}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => router.push("/orders/online")}
                  className="text-xs text-primary hover:underline"
                >
                  View online orders →
                </button>
                <button
                  onClick={() => { setParsed(null); setResult(null); setManualAssignments(new Map()); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Import another file
                </button>
              </div>
            </div>
          </div>
        )}

        {parsed && parsed.missingRequiredColumns.length === 0 && !result && (
          <>
            <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-primary">Preview</h2>
                  <p className="text-xs text-muted-foreground">
                    {parsed.orders.length} order{parsed.orders.length === 1 ? "" : "s"} found
                    {parsed.duplicateNames.length > 0 && ` · ${parsed.duplicateNames.length} already imported`}
                    {importable.unresolvedCount > 0 && ` · ${importable.unresolvedCount} need product mapping`}
                    {importable.excludedCount > 0 && ` · ${importable.excludedCount} unchecked`}
                  </p>
                  {(() => {
                    const selectableNames = parsed.orders
                      .filter((o) => !parsed.duplicateNames.includes(o.name))
                      .map((o) => o.name);
                    const allSelected = selectableNames.every((n) => !excluded.has(n));
                    return (
                      <button
                        onClick={() => {
                          if (allSelected) setExcluded(new Set(selectableNames));
                          else setExcluded(new Set());
                        }}
                        className="text-[11px] text-primary hover:underline mt-1"
                      >
                        {allSelected ? "Uncheck all" : "Check all"}
                      </button>
                    );
                  })()}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-muted-foreground">
                    Default lead:
                    <input
                      type="number"
                      min="0"
                      value={leadDays}
                      onChange={(e) => setLeadDays(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="input text-xs w-16 inline-block ml-1.5"
                    />
                    {" "}days
                  </label>
                  <button
                    onClick={handleImport}
                    disabled={importable.orders.length === 0 || importing}
                    className="rounded-sm bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {importing
                      ? "Importing…"
                      : `Import ${importable.orders.length} order${importable.orders.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
              {parsed.unknownColumns.length > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Ignored columns: {parsed.unknownColumns.join(", ")}
                </p>
              )}
            </section>

            <ul className="space-y-2">
              {parsed.orders.map((o) => {
                const isDup = parsed.duplicateNames.includes(o.name);
                return (
                  <li
                    key={o.name}
                    className={`rounded-sm border bg-card p-3 space-y-2 ${isDup ? "border-[color:var(--ds-border-warm)]/60 opacity-60" : excluded.has(o.name) ? "border-[color:var(--ds-border-warm)]/60 opacity-50" : "border-[color:var(--ds-border-warm)]"}`}
                  >
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={!isDup && !excluded.has(o.name)}
                        disabled={isDup}
                        onChange={(e) => {
                          setExcluded((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.delete(o.name);
                            else next.add(o.name);
                            return next;
                          });
                        }}
                        className="mt-1 w-4 h-4 cursor-pointer"
                        aria-label={`Include ${o.name} in import`}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">
                          {o.name}
                          {isDup && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">already imported</span>}
                          {!isDup && excluded.has(o.name) && (
                            <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">skipped</span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[o.shippingName, o.email, o.placedAt ? new Date(o.placedAt).toLocaleDateString("de-AT") : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <span className="text-[11px] text-muted-foreground shrink-0">
                        {o.lineItems.length} item{o.lineItems.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul className="divide-y divide-border rounded-md border border-[color:var(--ds-border-warm)]">
                      {o.lineItems.map((li, i) => {
                        const pick = getPick(o.name, i, li);
                        const dec = pick ? decodePicker(pick) : null;
                        const issue = !pick || (dec?.kind === "variant" && variantSizesFor(dec.variantId).length > 0 && !dec.variantPackagingId);
                        // When the parser matched a variant by alias /
                        // canonical name, narrow the dropdown to that
                        // variant's sizes only — clicking "Different
                        // variant…" broadens to the full list.
                        const lk = lineKey(o.name, i);
                        const broadened = expandedPickers.has(lk);
                        const matchedVariantId = li.resolvedVariantId
                          ?? (dec?.kind === "variant" ? dec.variantId : undefined);
                        const narrowed = !!matchedVariantId && !broadened;
                        const matchedVariant = matchedVariantId
                          ? variants.find((v) => v.id === matchedVariantId)
                          : undefined;
                        return (
                          <li key={i} className={`px-3 py-2 text-sm ${issue ? "bg-status-warn-bg/40" : ""}`}>
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div className="flex-1 min-w-0">
                                <p className="truncate">
                                  {li.name}
                                  {li.sku && <span className="ml-2 text-[10px] font-mono text-muted-foreground">SKU {li.sku}</span>}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  × {li.quantity}
                                  {li.unitPrice != null && ` · €${li.unitPrice.toFixed(2)} each`}
                                </p>
                                {narrowed && (
                                  <button
                                    onClick={() => {
                                      setExpandedPickers((p) => {
                                        const n = new Set(p);
                                        n.add(lk);
                                        return n;
                                      });
                                    }}
                                    className="mt-1 text-[10.5px] text-muted-foreground hover:text-foreground underline"
                                  >
                                    Different variant…
                                  </button>
                                )}
                              </div>
                              <select
                                value={pick ?? ""}
                                onChange={(e) => setAssignment(o.name, i, e.target.value)}
                                className="input text-xs !py-1 !w-64"
                                disabled={isDup}
                              >
                                <option value="">— pick {narrowed ? "size" : "variant or product"} —</option>
                                <option value={SKIP_LINE}>↪︎ Skip this line</option>
                                {narrowed && matchedVariant ? (
                                  <optgroup label={`Sizes — ${matchedVariant.name}`}>
                                    {(() => {
                                      const sizes = variantSizesFor(matchedVariant.id!);
                                      if (sizes.length === 0) {
                                        return (
                                          <option key={matchedVariant.id} value={encodeVariant(matchedVariant.id!, null)}>
                                            {matchedVariant.name} (loose)
                                          </option>
                                        );
                                      }
                                      return sizes.map((vp) => {
                                        const pkgName = vp.packagingId
                                          ? packagingById.get(vp.packagingId)?.name ?? "size"
                                          : "loose";
                                        return (
                                          <option key={vp.id} value={encodeVariant(matchedVariant.id!, vp.id ?? null)}>
                                            {pkgName} (€{(vp.price ?? vp.sellPrice ?? 0).toFixed(2)})
                                          </option>
                                        );
                                      });
                                    })()}
                                  </optgroup>
                                ) : (
                                  <>
                                    {variants.length > 0 && (
                                      <optgroup label="Variants (curated boxes)">
                                        {variants.map((v) => {
                                          const sizes = variantSizesFor(v.id!);
                                          if (sizes.length === 0) {
                                            return (
                                              <option key={v.id} value={encodeVariant(v.id!, null)}>
                                                {v.name}
                                              </option>
                                            );
                                          }
                                          return sizes.map((vp) => {
                                            const pkgName = vp.packagingId
                                              ? packagingById.get(vp.packagingId)?.name ?? "size"
                                              : "loose";
                                            return (
                                              <option key={vp.id} value={encodeVariant(v.id!, vp.id ?? null)}>
                                                {v.name} — {pkgName} (€{(vp.price ?? vp.sellPrice ?? 0).toFixed(2)})
                                              </option>
                                            );
                                          });
                                        })}
                                      </optgroup>
                                    )}
                                    <optgroup label="Single products">
                                      {products
                                        .filter((p) => !p.archived)
                                        .map((p) => (
                                          <option key={p.id} value={encodeProduct(p.id!)}>
                                            {p.name}
                                          </option>
                                        ))}
                                    </optgroup>
                                  </>
                                )}
                              </select>
                            </div>
                            {issue && (
                              <p className="mt-1 text-[11px] text-status-warn">
                                {matchedVariantId && narrowed
                                  ? `Matched variant "${matchedVariant?.name ?? "?"}" — pick a size`
                                  : li.resolutionNote ?? "Pick a variant size or product."}
                              </p>
                            )}
                            {dec?.kind === "skip" && (
                              <p className="mt-1 text-[11px] text-muted-foreground italic">
                                Line skipped — won&apos;t be imported.
                              </p>
                            )}
                            {/* Stock + Produce/Borrow toggle. Only meaningful for
                                resolved single-product picks. Variant lines
                                aggregate stock per composition product, so the
                                toggle there applies the choice to all derived
                                lines on import. */}
                            {dec && dec.kind !== "skip" && (() => {
                              const isBorrow = !produceSet.has(lk);
                              let stockLabel: string;
                              let stockClass: string;
                              if (dec.kind === "product") {
                                const t = productLocationTotals.get(dec.productId);
                                // Borrow allocator pulls shop store first, then
                                // production. Reflect both — a line that has
                                // 30 in shop should not flag as short just
                                // because production has 0.
                                const shop = t?.store ?? 0;
                                const prod = t?.production ?? 0;
                                const avail = shop + prod;
                                const enough = avail >= li.quantity;
                                stockLabel = `${avail} in stock (${shop} shop · ${prod} prod)`;
                                stockClass = enough ? "text-[#4a7a5e]" : "text-[#9b4f48]";
                              } else {
                                stockLabel = "stock varies per chocolate";
                                stockClass = "text-muted-foreground";
                              }
                              return (
                                <div className="mt-1.5 flex items-center gap-2">
                                  <span className={`text-[10.5px] tabular-nums ${stockClass}`}>
                                    {stockLabel}
                                  </span>
                                  <div className="ml-auto inline-flex rounded-full border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] overflow-hidden text-[10.5px]">
                                    <button
                                      type="button"
                                      onClick={() => setProduceSet((p) => { const n = new Set(p); n.add(lk); return n; })}
                                      className={
                                        "px-2.5 py-0.5 transition " +
                                        (!isBorrow
                                          ? "bg-foreground text-background"
                                          : "text-muted-foreground hover:text-foreground")
                                      }
                                    >
                                      Produce
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setProduceSet((p) => { const n = new Set(p); n.delete(lk); return n; })}
                                      className={
                                        "px-2.5 py-0.5 transition " +
                                        (isBorrow
                                          ? "bg-[#e3ebe6] text-[#2e4839]"
                                          : "text-muted-foreground hover:text-foreground")
                                      }
                                    >
                                      Borrow
                                    </button>
                                  </div>
                                </div>
                              );
                            })()}
                          </li>
                        );
                      })}
                    </ul>
                    {o.warnings.length > 0 && (
                      <ul className="text-[11px] text-status-warn space-y-0.5">
                        {o.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
