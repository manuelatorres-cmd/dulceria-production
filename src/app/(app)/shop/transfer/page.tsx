"use client";

import { useMemo, useState } from "react";
import {
  useProductsList,
  useProductLocationTotals,
  useStockLocationMinimums,
  useStockTransfers,
  useProductCategories,
  saveStockTransfer,
  moveProductStockFifo,
  DEFAULT_LOCATION_MINIMUM,
} from "@/lib/hooks";
import { queryClient } from "@/lib/query-client";
import {
  PageHeader,
  Section,
  DsButton,
  DsTabNav,
  useToast,
} from "@/components/dulceria";
import { IconSearch } from "@tabler/icons-react";

export default function ShopTransferPage() {
  const products = useProductsList();
  const totals = useProductLocationTotals();
  const minimums = useStockLocationMinimums();
  const history = useStockTransfers("product");
  const categories = useProductCategories(true);
  const toast = useToast();

  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  const [manualProductId, setManualProductId] = useState<string>("");
  const [manualFrom, setManualFrom] = useState<"production" | "store" | "freezer">("production");
  const [manualTo, setManualTo] = useState<"production" | "store" | "freezer">("store");
  const [manualQty, setManualQty] = useState<string>("");
  const [manualBusy, setManualBusy] = useState(false);

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c.name])),
    [categories],
  );
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);

  const minByProductLoc = useMemo(() => {
    const m = new Map<string, number>();
    for (const row of minimums) m.set(`${row.productId}|${row.location}`, row.minimumUnits);
    return m;
  }, [minimums]);

  const suggestions = useMemo(() => {
    const out: Array<{
      productId: string;
      productName: string;
      shopStock: number;
      productionStock: number;
      shopMin: number;
      suggestedQty: number;
    }> = [];
    for (const product of products) {
      if (!product.id || product.archived) continue;
      const byLoc = totals.get(product.id) ?? { store: 0, production: 0, freezer: 0, allocated: 0 };
      const shopMin = minByProductLoc.get(`${product.id}|store`) ?? DEFAULT_LOCATION_MINIMUM;
      if (byLoc.store >= shopMin) continue;
      if (byLoc.production <= 0) continue;
      const want = shopMin - byLoc.store;
      const suggestedQty = Math.min(want, byLoc.production);
      if (suggestedQty <= 0) continue;
      out.push({
        productId: product.id,
        productName: product.name,
        shopStock: byLoc.store,
        productionStock: byLoc.production,
        shopMin,
        suggestedQty,
      });
    }
    return out.sort((a, b) => b.suggestedQty - a.suggestedQty);
  }, [products, totals, minByProductLoc]);

  const visibleSuggestions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suggestions.filter((s) => {
      const p = productById.get(s.productId);
      if (activeCategories.size > 0) {
        if (!p?.productCategoryId || !activeCategories.has(p.productCategoryId)) return false;
      }
      if (q && !s.productName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [suggestions, activeCategories, search, productById]);

  const usedCategories = useMemo(() => {
    const ids = new Set<string>();
    for (const s of suggestions) {
      const p = productById.get(s.productId);
      if (p?.productCategoryId) ids.add(p.productCategoryId);
    }
    return [...ids]
      .map((id) => ({ id, name: categoryNameById.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [suggestions, productById, categoryNameById]);

  async function doManualTransfer() {
    if (!manualProductId) {
      toast.error("Pick a product");
      return;
    }
    if (manualFrom === manualTo) {
      toast.error("Pick different source and destination");
      return;
    }
    const qty = Math.max(0, Math.floor(Number(manualQty) || 0));
    if (qty <= 0) {
      toast.error("Enter a quantity > 0");
      return;
    }
    setManualBusy(true);
    try {
      const moves = await moveProductStockFifo({
        productId: manualProductId,
        fromLocation: manualFrom,
        toLocation: manualTo,
        quantity: qty,
        reason: "transfer",
        notes: `Manual transfer ${manualFrom} → ${manualTo}`,
      });
      const moved = moves.reduce((s, m) => s + m.quantity, 0);
      if (moved > 0) {
        await saveStockTransfer({
          entityType: "product",
          entityId: manualProductId,
          quantity: moved,
          fromLocationId: manualFrom,
          toLocationId: manualTo,
          transferredAt: new Date(),
          reason: "manual",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      queryClient.invalidateQueries({ queryKey: ["product-location-totals"] });
      if (moved < qty) {
        toast.warn(`Only ${moved} pieces available`, { description: `Transferred what was there` });
      } else {
        toast.success(`Transferred ${moved} pieces`);
      }
      setManualQty("");
    } catch (e) {
      toast.error("Transfer failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setManualBusy(false);
    }
  }

  async function doTransfer(productId: string, qty: number) {
    setPending((p) => ({ ...p, [productId]: true }));
    try {
      const moves = await moveProductStockFifo({
        productId,
        fromLocation: "production",
        toLocation: "store",
        quantity: qty,
        reason: "transfer",
        notes: "Transfer to shop",
      });
      const moved = moves.reduce((s, m) => s + m.quantity, 0);
      if (moved > 0) {
        await saveStockTransfer({
          entityType: "product",
          entityId: productId,
          quantity: moved,
          fromLocationId: "production",
          toLocationId: "store",
          transferredAt: new Date(),
          reason: "shop-request",
        });
      }
      queryClient.invalidateQueries({ queryKey: ["stock-locations"] });
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      queryClient.invalidateQueries({ queryKey: ["product-location-totals"] });
      const name = productById.get(productId)?.name ?? "product";
      toast.success(`Transferred ${moved} × ${name}`);
    } catch (e) {
      toast.error("Transfer failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setPending((p) => ({ ...p, [productId]: false }));
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Transfer to shop"
        meta="Move finished goods from production to the shop. Suggestions appear when shop stock is below min."
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <Section
          title="Suggestions"
          action={
            visibleSuggestions.length === suggestions.length
              ? `${suggestions.length}`
              : `${visibleSuggestions.length} of ${suggestions.length}`
          }
        >
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            {usedCategories.length > 0 && (
              <>
                <DsTabNav
                  variant="pills"
                  tabs={[
                    { id: "", label: "All" },
                    ...usedCategories.map((c) => ({ id: c.id, label: c.name })),
                  ]}
                  activeTab={activeCategories.size === 0 ? "" : [...activeCategories][0] ?? ""}
                  onChange={(id) => {
                    if (id === "") setActiveCategories(new Set());
                    else {
                      setActiveCategories((prev) => {
                        const next = new Set(prev);
                        if (next.has(id)) next.delete(id);
                        else next.add(id);
                        return next;
                      });
                    }
                  }}
                />
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "4px 10px",
                    border: "0.5px solid var(--ds-border-warm)",
                    background: "var(--ds-card-bg)",
                    borderRadius: 14,
                    maxWidth: 360,
                  }}
                >
                  <IconSearch size={13} stroke={1.5} style={{ color: "var(--ds-text-muted)" }} />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search products…"
                    style={{
                      fontSize: 12,
                      border: "none",
                      background: "transparent",
                      outline: "none",
                      flex: 1,
                      color: "var(--ds-text-primary)",
                    }}
                  />
                </div>
              </>
            )}
            {visibleSuggestions.length === 0 ? (
              <p
                style={{
                  fontStyle: "italic",
                  fontFamily: "var(--font-serif)",
                  color: "var(--ds-text-muted)",
                  fontSize: 13,
                  padding: "12px 0",
                }}
              >
                Shop is fully stocked above all minimums.
              </p>
            ) : (
              <ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", margin: 0, padding: 0 }}>
                {visibleSuggestions.map((s) => (
                  <li
                    key={s.productId}
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 14px",
                      border: "0.5px solid var(--ds-border-warm)",
                      background: "var(--ds-card-bg)",
                      borderRadius: 4,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontWeight: 500,
                          letterSpacing: "-0.01em",
                          fontSize: 13,
                        }}
                      >
                        {s.productName}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--ds-text-muted)", marginTop: 2 }}>
                        Shop {s.shopStock} / min {s.shopMin} · production has {s.productionStock}
                      </div>
                    </div>
                    <label
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        color: "var(--ds-text-muted)",
                      }}
                    >
                      Move
                      <input
                        type="number"
                        min={0}
                        max={s.productionStock}
                        value={overrides[s.productId] ?? String(s.suggestedQty)}
                        onChange={(e) => setOverrides((p) => ({ ...p, [s.productId]: e.target.value }))}
                        style={{
                          width: 60,
                          padding: "3px 6px",
                          fontSize: 12,
                          border: "0.5px solid var(--ds-border-warm)",
                          borderRadius: 3,
                          background: "var(--ds-card-bg)",
                          color: "var(--ds-text-primary)",
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      />
                      <span style={{ fontSize: 10 }}>/ {s.productionStock} avail</span>
                    </label>
                    <DsButton
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        const raw = overrides[s.productId];
                        const requested =
                          raw !== undefined ? Math.max(0, Math.floor(Number(raw) || 0)) : s.suggestedQty;
                        const capped = Math.min(requested, s.productionStock);
                        if (capped <= 0) return;
                        doTransfer(s.productId, capped);
                      }}
                      disabled={pending[s.productId]}
                    >
                      {pending[s.productId] ? "…" : "Transfer"}
                    </DsButton>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        <Section title="Manual transfer" action="any product · any direction">
          <div style={{ padding: 16, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}>
            <Field label="Product" wide>
              <select
                value={manualProductId}
                onChange={(e) => setManualProductId(e.target.value)}
                style={selectStyle()}
              >
                <option value="">— pick product —</option>
                {products
                  .filter((p) => !p.archived)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((p) => {
                    const t = totals.get(p.id!);
                    const counts = t ? `(${t.production} prod / ${t.store} shop / ${t.freezer} freezer)` : "";
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} {counts}
                      </option>
                    );
                  })}
              </select>
            </Field>
            <Field label="From">
              <select
                value={manualFrom}
                onChange={(e) => setManualFrom(e.target.value as typeof manualFrom)}
                style={selectStyle()}
              >
                <option value="production">Production</option>
                <option value="store">Shop</option>
                <option value="freezer">Freezer</option>
              </select>
            </Field>
            <Field label="To">
              <select
                value={manualTo}
                onChange={(e) => setManualTo(e.target.value as typeof manualTo)}
                style={selectStyle()}
              >
                <option value="store">Shop</option>
                <option value="production">Production</option>
                <option value="freezer">Freezer</option>
              </select>
            </Field>
            <Field label="Qty">
              <input
                type="number"
                min={0}
                value={manualQty}
                onChange={(e) => setManualQty(e.target.value)}
                placeholder="0"
                style={{
                  width: 80,
                  padding: "5px 8px",
                  fontSize: 13,
                  border: "0.5px solid var(--ds-border-warm)",
                  borderRadius: 4,
                  background: "var(--ds-card-bg)",
                  color: "var(--ds-text-primary)",
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </Field>
            <DsButton variant="primary" size="md" onClick={doManualTransfer} disabled={manualBusy}>
              {manualBusy ? "Transferring…" : "Transfer"}
            </DsButton>
          </div>
        </Section>

        <Section title="Recent transfers" action={`${history.length}`}>
          {history.length === 0 ? (
            <p
              style={{
                padding: "20px 16px",
                color: "var(--ds-text-muted)",
                fontStyle: "italic",
                fontFamily: "var(--font-serif)",
                fontSize: 13,
              }}
            >
              No transfers logged yet.
            </p>
          ) : (
            <ul
              style={{
                padding: "0 0 14px",
                display: "flex",
                flexDirection: "column",
                gap: 0,
                listStyle: "none",
                margin: 0,
              }}
            >
              {history.slice(0, 30).map((t) => (
                <li
                  key={t.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 12,
                    padding: "6px 16px",
                    borderTop: "0.5px solid var(--ds-border-warm)",
                  }}
                >
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 500, minWidth: 32 }}>
                    {Number(t.quantity)}
                  </span>
                  <span style={{ color: "var(--ds-text-muted)" }}>
                    {t.fromLocationId ?? "?"} → {t.toLocationId}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--ds-text-muted)",
                      marginLeft: "auto",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {new Date(t.transferredAt).toLocaleString()} · {t.reason}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontSize: 11,
        color: "var(--ds-text-muted)",
        minWidth: wide ? 240 : undefined,
      }}
    >
      <span className="text-ds-label">{label}</span>
      {children}
    </label>
  );
}

function selectStyle(): React.CSSProperties {
  return {
    padding: "5px 8px",
    fontSize: 13,
    border: "0.5px solid var(--ds-border-warm)",
    borderRadius: 4,
    background: "var(--ds-card-bg)",
    color: "var(--ds-text-primary)",
    minWidth: 160,
  };
}
