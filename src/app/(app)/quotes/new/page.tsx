"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/dulceria";
import {
  useCustomers, useProductsList, usePackagingList, useCapacityConfig,
  saveQuote, useAllProductionDayLineItems, useProductionDays,
  usePeople, usePersonUnavailability, useBlockedDays,
} from "@/lib/hooks";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import type { ProductCostSnapshot, PackagingOrder, QuoteItem, Variant, VariantProduct } from "@/types";
import { computeQuotePricing, checkQuoteFeasibility } from "@/lib/quoteMath";
import { latestPackagingUnitCost } from "@/lib/variantPricing";
import { IconArrowLeft as ArrowLeft, IconPlus as Plus, IconTrash as Trash2, IconFileText as FileText, IconPackage as Package, IconCircleCheck as CheckCircle, IconAlertTriangle as AlertTriangle } from "@tabler/icons-react";

type LineKind = "product" | "box";

interface DraftLine {
  kind: LineKind;
  productId?: string;
  quantity: number;
  unitPrice?: number;
  packagingId?: string;
  boxContents?: Array<{ productId: string; pieces: number }>;
}

function NewQuotePageInner() {
  const router = useRouter();
  const search = useSearchParams();
  const preselectCustomerId = search.get("customerId") ?? "";

  const customers = useCustomers(false);
  const products = useProductsList(true);
  const packaging = usePackagingList(true);
  const config = useCapacityConfig();
  // Quote feasibility uses committed hours in the window; we derive
  // that from productionDayLineItems by date.
  const lineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(120);
  const dayDateById = useMemo(
    () => new Map(productionDays.map((d) => [d.id!, d.date])),
    [productionDays],
  );
  const people = usePeople(false);
  const unavailability = usePersonUnavailability();
  const blocked = useBlockedDays();

  // Pull every product cost snapshot once so we can build a productId → latest
  // costPerProduct map without a roundtrip per product.
  const { data: costSnapshots = [] } = useQuery({
    queryKey: ["product-cost-snapshots", "all-for-quote"],
    queryFn: async () => assertOk(await supabase.from("productCostSnapshots").select("*")) as ProductCostSnapshot[],
  });
  const { data: packagingOrders = [] } = useQuery({
    queryKey: ["packaging-orders", "all-for-quote"],
    queryFn: async () => assertOk(await supabase.from("packagingOrders").select("*")) as PackagingOrder[],
  });
  const { data: variants = [] } = useQuery({
    queryKey: ["variants", "all-for-quote"],
    queryFn: async () => assertOk(await supabase.from("variants").select("*")) as Variant[],
  });
  const { data: variantProducts = [] } = useQuery({
    queryKey: ["variant-products", "all-for-quote"],
    queryFn: async () => assertOk(await supabase.from("variantProducts").select("*")) as VariantProduct[],
  });

  const productName = useMemo(() => new Map(products.map((p) => [p.id!, p.name])), [products]);
  const packagingName = useMemo(() => new Map(packaging.map((p) => [p.id!, p.name])), [packaging]);

  // productId → latest costPerProduct
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

  // packagingId → latest unit cost
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

  // productId → retail price (from the latest variant snapshot that lists it)
  const productRetailPrice = useMemo(() => {
    const latestPrice = new Map<string, number>();
    const variantById = new Map(variants.map((c) => [c.id!, c]));
    for (const cp of variantProducts) {
      const col = variantById.get(cp.variantId);
      if (!col) continue;
      // Assume retail price is stored on the variant product row
      // (variantProducts has unitPrice in the schema) — fall back to 0 if missing.
      const price = (cp as unknown as { unitPrice?: number }).unitPrice;
      if (price == null) continue;
      // If a product is in multiple variants, prefer the newest retail price.
      const prev = latestPrice.get(cp.productId);
      if (prev == null || price > prev) latestPrice.set(cp.productId, price);
    }
    return latestPrice;
  }, [variants, variantProducts]);

  // ── UI state ────────────────────────────────────────────────────────────

  const [title, setTitle] = useState("");
  const [customerId, setCustomerId] = useState<string>(preselectCustomerId);
  const [isWhatIf, setIsWhatIf] = useState<boolean>(false);
  const [deadline, setDeadline] = useState<string>("");
  const [labourHours, setLabourHours] = useState<string>("0");
  const [priceMode, setPriceMode] = useState<"margin" | "price">("margin");
  const [targetMargin, setTargetMargin] = useState<string>("40");
  const [sellPriceInput, setSellPriceInput] = useState<string>("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (preselectCustomerId && !customerId) setCustomerId(preselectCustomerId);
  }, [preselectCustomerId, customerId]);

  // ── Compute pricing + feasibility ───────────────────────────────────────

  const items: QuoteItem[] = useMemo(() => lines.map((l) => ({
    productId: l.kind === "product" ? l.productId : undefined,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    packagingId: l.packagingId,
    boxContents: l.kind === "box" ? l.boxContents : undefined,
  })), [lines]);

  const labourHoursNum = Math.max(0, parseFloat(labourHours) || 0);
  const labourRate = config?.labourHourlyRate ?? 0;

  const pricing = useMemo(() => computeQuotePricing(
    items,
    {
      productUnitCost,
      productRetailPrice,
      productName,
      packagingUnitCost,
      packagingName,
      labourHours: labourHoursNum,
      labourHourlyRate: labourRate,
    },
    priceMode === "margin"
      ? { targetMarginPercent: parseFloat(targetMargin) || 0 }
      : { sellPrice: parseFloat(sellPriceInput) || 0 },
  ), [items, productUnitCost, productRetailPrice, productName, packagingUnitCost, packagingName, labourHoursNum, labourRate, priceMode, targetMargin, sellPriceInput]);

  // Feasibility: compare against available capacity between now and deadline.
  const feasibility = useMemo(() => {
    if (!deadline || labourHoursNum === 0) return null;
    const deadlineDate = new Date(deadline);
    if (!Number.isFinite(deadlineDate.getTime())) return null;
    const now = new Date();

    // Daily capacity = sum of active people's hours × working-day filter.
    const activePeople = people.filter((p) => !p.archived);
    const dailyCapacityHours = activePeople.reduce(
      (s, p) => s + (p.defaultHoursPerDay ?? 0),
      0,
    );

    // Count working days between now and deadline, skipping blocked + unavailable days.
    const blockedDates = new Set<string>();
    for (const b of blocked) {
      const start = new Date(b.startDate);
      const end = new Date(b.endDate);
      for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
        blockedDates.add(d.toISOString().slice(0, 10));
      }
    }
    const workingDays = (function(): number {
      let days = 0;
      const cursor = new Date(now);
      cursor.setHours(0, 0, 0, 0);
      while (cursor.getTime() < deadlineDate.getTime()) {
        const iso = cursor.toISOString().slice(0, 10);
        if (!blockedDates.has(iso)) days += 1;
        cursor.setDate(cursor.getDate() + 1);
      }
      return days;
    })();

    // Committed hours: sum of plannedMinutes on days that fall between
    // now and the quote's deadline.
    const fromIso = now.toISOString().slice(0, 10);
    const toIso = deadlineDate.toISOString().slice(0, 10);
    const committedMinutes = lineItems
      .map((li) => ({ date: dayDateById.get(li.productionDayId), minutes: li.plannedMinutes }))
      .filter((x) => x.date && x.date >= fromIso && x.date <= toIso)
      .reduce((acc, x) => acc + x.minutes, 0);

    // Discount unavailability: roughly subtract days when someone is out.
    const unavailabilityAdj = unavailability.filter((u) => {
      const from = new Date(u.startDate).getTime();
      const to = new Date(u.endDate).getTime();
      return to >= now.getTime() && from <= deadlineDate.getTime();
    }).length;

    return checkQuoteFeasibility({
      requiredHours: labourHoursNum,
      dailyCapacityHours: Math.max(0, dailyCapacityHours),
      workingDaysToDeadline: Math.max(0, workingDays - unavailabilityAdj),
      committedHoursToDeadline: committedMinutes / 60,
      bufferPercent: config?.capacityBufferPercent ?? 0,
    });
  }, [deadline, labourHoursNum, people, blocked, lineItems, dayDateById, unavailability, config?.capacityBufferPercent]);

  // ── Line editing ────────────────────────────────────────────────────────

  function addProductLine() {
    setLines((prev) => [...prev, { kind: "product", productId: products[0]?.id, quantity: 1 }]);
  }
  function addBoxLine() {
    setLines((prev) => [...prev, {
      kind: "box",
      packagingId: packaging[0]?.id,
      quantity: 1,
      boxContents: [],
    }]);
  }
  function updateLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => i === index ? { ...l, ...patch } : l));
  }
  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Save ────────────────────────────────────────────────────────────────

  const canSave = !!title.trim() && (isWhatIf || !!customerId) && lines.length > 0 && !saving;

  async function handleSave(status: "draft" | "sent") {
    if (!canSave) return;
    setSaving(true);
    try {
      const id = await saveQuote({
        customerId: isWhatIf ? undefined : (customerId || undefined),
        isWhatIf,
        title: title.trim(),
        status,
        deadline: deadline ? new Date(deadline) : undefined,
        items,
        costBreakdown: pricing.breakdown,
        totalCost: pricing.breakdown.totalCost,
        sellPrice: pricing.sellPrice,
        marginPercent: pricing.marginPercent,
        labourHoursEstimate: labourHoursNum,
        retailComparePct: pricing.retailComparePct ?? undefined,
        feasible: feasibility?.feasible,
        feasibilityNote: feasibility?.note,
        expiresAt: status === "sent"
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          : undefined,
        notes: notes.trim() || undefined,
      });
      router.push(`/quotes/${encodeURIComponent(id)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader title={isWhatIf ? "What-If quote" : "New quote"} meta="B2B pricing calculator with cost breakdown and feasibility check" />
      <div className="px-4 pb-10 space-y-5">
        <Link href="/quotes" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> All quotes
        </Link>

        {/* Header */}
        <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Hotel Sacher — Christmas hampers"
                className="input text-sm"
              />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <input
                id="whatif"
                type="checkbox"
                checked={isWhatIf}
                onChange={(e) => setIsWhatIf(e.target.checked)}
                className="w-4 h-4"
              />
              <label htmlFor="whatif" className="text-sm">
                What-If quote — explore pricing without attaching to a customer
              </label>
            </div>
            {!isWhatIf && (
              <div className="col-span-2">
                <label className="label">Customer</label>
                <select
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                  className="input text-sm"
                >
                  <option value="">Select customer…</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.companyName}</option>
                  ))}
                </select>
                {customers.length === 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    No customers yet. <Link href="/customers" className="text-primary hover:underline">Create one →</Link>
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="label">Deadline (optional)</label>
              <input
                type="date"
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
                className="input text-sm"
              />
            </div>
            <div>
              <label className="label">Labour hours</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={labourHours}
                onChange={(e) => setLabourHours(e.target.value)}
                className="input text-sm"
              />
              {labourRate === 0 && (
                <p className="text-[11px] text-status-warn mt-1">
                  Labour rate not set — <Link href="/settings" className="underline">configure in Settings</Link>
                </p>
              )}
            </div>
          </div>
        </section>

        {/* Line items */}
        <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-primary">Line items</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={addProductLine}
                className="inline-flex items-center gap-1 rounded-[4px] border border-[color:var(--ds-border-warm)] px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
              >
                <Plus className="w-3 h-3" /> Product
              </button>
              <button
                onClick={addBoxLine}
                className="inline-flex items-center gap-1 rounded-[4px] border border-[color:var(--ds-border-warm)] px-2.5 py-1 text-xs hover:border-primary hover:text-primary"
              >
                <Package className="w-3 h-3" /> Box
              </button>
            </div>
          </div>
          {lines.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-4">
              Add at least one product or box to calculate pricing.
            </p>
          ) : (
            <ul className="space-y-2">
              {lines.map((line, i) => (
                <li key={i} className="rounded-[6px] border border-[color:var(--ds-border-warm)] bg-background p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground uppercase">
                      {line.kind === "box" ? "Box line" : "Product line"}
                    </span>
                    <button
                      onClick={() => removeLine(i)}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Remove line"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {line.kind === "product" ? (
                    <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                      <select
                        value={line.productId ?? ""}
                        onChange={(e) => updateLine(i, { productId: e.target.value })}
                        className="input text-sm"
                      >
                        <option value="">Select product…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                            {productUnitCost.has(p.id!) && ` (€${productUnitCost.get(p.id!)!.toFixed(2)}/pc)`}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) => updateLine(i, { quantity: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                        className="input text-sm w-24"
                        aria-label="Quantity"
                      />
                      <span className="self-center text-[11px] text-muted-foreground">pcs</span>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                        <select
                          value={line.packagingId ?? ""}
                          onChange={(e) => updateLine(i, { packagingId: e.target.value })}
                          className="input text-sm"
                        >
                          <option value="">Select packaging…</option>
                          {packaging.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {packagingUnitCost.has(p.id!) && ` (€${packagingUnitCost.get(p.id!)!.toFixed(2)}/box)`}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="1"
                          value={line.quantity}
                          onChange={(e) => updateLine(i, { quantity: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                          className="input text-sm w-24"
                          aria-label="Box quantity"
                        />
                        <span className="self-center text-[11px] text-muted-foreground">boxes</span>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">Per-box contents:</p>
                        {(line.boxContents ?? []).map((bc, j) => (
                          <div key={j} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 items-center">
                            <select
                              value={bc.productId}
                              onChange={(e) => {
                                const next = [...(line.boxContents ?? [])];
                                next[j] = { ...next[j], productId: e.target.value };
                                updateLine(i, { boxContents: next });
                              }}
                              className="input text-sm"
                            >
                              <option value="">Product…</option>
                              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                            <input
                              type="number"
                              min="1"
                              value={bc.pieces}
                              onChange={(e) => {
                                const next = [...(line.boxContents ?? [])];
                                next[j] = { ...next[j], pieces: Math.max(1, parseInt(e.target.value, 10) || 1) };
                                updateLine(i, { boxContents: next });
                              }}
                              className="input text-sm w-20"
                              aria-label="Pieces"
                            />
                            <span className="text-[11px] text-muted-foreground">pcs</span>
                            <button
                              onClick={() => {
                                const next = [...(line.boxContents ?? [])];
                                next.splice(j, 1);
                                updateLine(i, { boxContents: next });
                              }}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label="Remove product from box"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const next = [...(line.boxContents ?? [])];
                            next.push({ productId: products[0]?.id ?? "", pieces: 1 });
                            updateLine(i, { boxContents: next });
                          }}
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> Add product to box
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Pricing */}
        <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
          <h2 className="text-sm font-semibold text-primary">Pricing</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPriceMode("margin")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${priceMode === "margin" ? "bg-accent text-accent-foreground" : "border border-[color:var(--ds-border-warm)] text-muted-foreground"}`}
            >
              Target margin %
            </button>
            <button
              onClick={() => setPriceMode("price")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${priceMode === "price" ? "bg-accent text-accent-foreground" : "border border-[color:var(--ds-border-warm)] text-muted-foreground"}`}
            >
              Total sell price
            </button>
          </div>
          {priceMode === "margin" ? (
            <div>
              <label className="label">Target margin (%)</label>
              <input
                type="number"
                min="0"
                max="99"
                value={targetMargin}
                onChange={(e) => setTargetMargin(e.target.value)}
                className="input text-sm w-40"
              />
            </div>
          ) : (
            <div>
              <label className="label">Total sell price, net (€)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={sellPriceInput}
                onChange={(e) => setSellPriceInput(e.target.value)}
                className="input text-sm w-40"
              />
            </div>
          )}

          {/* Breakdown */}
          <div className="rounded-[6px] border border-[color:var(--ds-border-warm)] bg-background p-3 space-y-1.5 text-sm">
            <Row label="Ingredients + decoration" value={`€${pricing.breakdown.ingredientsCost.toFixed(2)}`} />
            {pricing.breakdown.packagingCost > 0 && (
              <Row label="Packaging" value={`€${pricing.breakdown.packagingCost.toFixed(2)}`} />
            )}
            {pricing.breakdown.labourCost > 0 && (
              <Row label={`Labour (${labourHoursNum}h × €${labourRate.toFixed(2)})`} value={`€${pricing.breakdown.labourCost.toFixed(2)}`} />
            )}
            <div className="border-t border-[color:var(--ds-border-warm)] pt-1.5">
              <Row label="Total cost" value={`€${pricing.breakdown.totalCost.toFixed(2)}`} strong />
            </div>
            <div className="border-t border-[color:var(--ds-border-warm)] pt-1.5">
              <Row label="Sell price" value={`€${pricing.sellPrice.toFixed(2)}`} strong />
              <Row
                label="Margin"
                value={`€${pricing.marginAbsolute.toFixed(2)} (${pricing.marginPercent.toFixed(1)}%)`}
                valueClass={pricing.marginPercent >= 30 ? "text-status-ok" : pricing.marginPercent >= 0 ? "text-status-warn" : "text-status-alert"}
              />
              {pricing.retailComparePct != null && (
                <Row
                  label="vs retail"
                  value={`${pricing.retailComparePct >= 0 ? `${pricing.retailComparePct.toFixed(1)}% discount` : `${Math.abs(pricing.retailComparePct).toFixed(1)}% premium`} (retail €${pricing.retailTotal?.toFixed(2)})`}
                  valueClass="text-muted-foreground"
                />
              )}
            </div>
          </div>
        </section>

        {/* Feasibility */}
        {feasibility && (
          <section className={`rounded-[4px] border p-4 ${feasibility.feasible ? "border-status-ok-edge bg-status-ok-bg" : "border-status-warn-edge bg-status-warn-bg"}`}>
            <div className="flex items-start gap-2">
              {feasibility.feasible ? (
                <CheckCircle className="w-4 h-4 text-status-ok mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-status-warn mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">
                  {feasibility.feasible ? "Feasible at current capacity" : "Tight on capacity"}
                </p>
                <p className="text-xs text-foreground/80 mt-0.5">{feasibility.note}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Available {feasibility.availableHours}h · committed {feasibility.committedHours}h · free {feasibility.freeHours}h · needs {labourHoursNum}h
                </p>
              </div>
            </div>
          </section>
        )}

        {/* Notes + save */}
        <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3">
          <div>
            <label className="label">Internal notes (not shown to the customer)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="input text-sm resize-none"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => handleSave("draft")}
              disabled={!canSave}
              className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Save as draft
            </button>
            <button
              onClick={() => handleSave("sent")}
              disabled={!canSave || isWhatIf}
              title={isWhatIf ? "What-If quotes can only be saved as drafts" : undefined}
              className="inline-flex items-center gap-1.5 rounded-[4px] bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              <FileText className="w-3.5 h-3.5" /> Save &amp; send
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function Row({ label, value, strong = false, valueClass = "" }: { label: string; value: string; strong?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? "text-sm font-semibold" : "text-xs text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "text-sm font-semibold" : "text-sm"} ${valueClass}`}>{value}</span>
    </div>
  );
}

export default function NewQuotePage() {
  // useSearchParams must sit inside a Suspense boundary during Next.js static prerender.
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
      <NewQuotePageInner />
    </Suspense>
  );
}
