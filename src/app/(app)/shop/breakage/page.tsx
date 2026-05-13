"use client";

import { useMemo, useState } from "react";
import {
  useProductsList,
  saveStockTransfer,
  useStockTransfers,
  useCampaigns,
  useProductCategories,
} from "@/lib/hooks";
import { STOCK_TRANSFER_REASON_LABELS, type StockTransferReason } from "@/types";
import {
  PageHeader,
  Section,
  DsButton,
  DsTabNav,
  useToast,
} from "@/components/dulceria";
import { IconSearch } from "@tabler/icons-react";

const STOCK_OUT_REASONS: StockTransferReason[] = [
  "sold",
  "tasting",
  "gift",
  "event_sample",
  "staff",
  "waste",
];

export default function ShopBreakagePage() {
  const products = useProductsList();
  const transfers = useStockTransfers("product");
  const campaigns = useCampaigns();
  const categories = useProductCategories(true);
  const toast = useToast();

  const [reason, setReason] = useState<StockTransferReason>("sold");
  const [entries, setEntries] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c.name])),
    [categories],
  );

  const activeMarketEvent = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    return campaigns.find(
      (c) => c.type === "market_event" &&
        c.status !== "done" && c.status !== "cancelled" &&
        c.startDate <= todayIso && c.endDate >= todayIso,
    );
  }, [campaigns]);

  const eligible = useMemo(
    () => products.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  const visibleEligible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return eligible.filter((p) => {
      if (activeCategories.size > 0) {
        if (!p.productCategoryId || !activeCategories.has(p.productCategoryId)) return false;
      }
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [eligible, activeCategories, search]);

  const usedCategories = useMemo(() => {
    const ids = new Set<string>();
    for (const p of eligible) if (p.productCategoryId) ids.add(p.productCategoryId);
    return [...ids]
      .map((id) => ({ id, name: categoryNameById.get(id) ?? id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [eligible, categoryNameById]);

  const totalEntered = Object.values(entries).reduce((s, n) => s + n, 0);
  const productCount = Object.keys(entries).length;

  async function save() {
    setSaving(true);
    try {
      const rows = Object.entries(entries).filter(([, qty]) => qty > 0);
      const tag = activeMarketEvent && (reason === "event_sample" || reason === "sold")
        ? `[${activeMarketEvent.name}] `
        : "";
      const noteOut = (tag + (notes || "")).trim() || undefined;
      const toLoc = reason === "waste" ? "waste" : "consumed";
      for (const [productId, qty] of rows) {
        await saveStockTransfer({
          entityType: "product",
          entityId: productId,
          quantity: qty,
          fromLocationId: "store",
          toLocationId: toLoc,
          transferredAt: new Date(),
          reason,
          notes: noteOut,
        });
      }
      toast.success(`Logged ${rows.length} entries`, {
        description: `${totalEntered} pieces`,
      });
      setEntries({});
      setNotes("");
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Stock out"
        meta="Walk-in sales, tastings, gifts, event samples, staff, breakage · feeds weekly sales report"
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <Section title="Reason">
          <div style={{ padding: 16 }}>
            <DsTabNav
              variant="pills"
              tabs={STOCK_OUT_REASONS.map((r) => ({
                id: r,
                label: STOCK_TRANSFER_REASON_LABELS[r],
              }))}
              activeTab={reason}
              onChange={(id) => setReason(id as StockTransferReason)}
            />
            {activeMarketEvent && (reason === "event_sample" || reason === "sold") && (
              <p
                style={{
                  fontSize: 11,
                  color: "var(--ds-text-muted)",
                  marginTop: 10,
                  fontStyle: "italic",
                }}
              >
                Auto-tagging note with active market event: <b>{activeMarketEvent.name}</b>.
              </p>
            )}
          </div>
        </Section>

        <Section title="How many of each?" action="Skip products with zero">
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

            <ul
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 8,
                listStyle: "none",
                padding: 0,
                margin: 0,
              }}
            >
              {visibleEligible.map((p) => (
                <li
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    border: "0.5px solid var(--ds-border-warm)",
                    background: "var(--ds-card-bg)",
                    padding: "6px 10px",
                    borderRadius: 4,
                  }}
                >
                  <span
                    style={{
                      fontSize: 12,
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.01em",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {p.name}
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={entries[p.id ?? ""] ?? ""}
                    onChange={(e) => {
                      const v = Math.max(0, Number(e.target.value) || 0);
                      setEntries((prev) => {
                        const next = { ...prev };
                        if (v === 0) delete next[p.id ?? ""];
                        else next[p.id ?? ""] = v;
                        return next;
                      });
                    }}
                    placeholder="0"
                    style={{
                      width: 56,
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
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <Section title="Notes" action="optional">
          <div style={{ padding: 16 }}>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. customer dropped box, influencer visit"
              style={{
                width: "100%",
                padding: "6px 8px",
                fontSize: 12,
                border: "0.5px solid var(--ds-border-warm)",
                borderRadius: 4,
                background: "var(--ds-card-bg)",
                color: "var(--ds-text-primary)",
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </div>
        </Section>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--ds-text-muted)" }}>
            {totalEntered} piece{totalEntered === 1 ? "" : "s"} across {productCount} product{productCount === 1 ? "" : "s"}
          </span>
          <DsButton variant="primary" size="md" onClick={save} disabled={saving || totalEntered === 0}>
            {saving ? "Saving…" : "Log entries"}
          </DsButton>
        </div>

        <Section title="Recent log" action={`${transfers.filter((t) => STOCK_OUT_REASONS.includes(t.reason as StockTransferReason)).length} entries`}>
          {transfers.length === 0 ? (
            <p
              style={{
                padding: "20px 16px",
                color: "var(--ds-text-muted)",
                fontStyle: "italic",
                fontFamily: "var(--font-serif)",
                fontSize: 13,
              }}
            >
              Nothing logged yet.
            </p>
          ) : (
            <ul
              style={{
                padding: "0 0 14px",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                listStyle: "none",
                margin: 0,
              }}
            >
              {transfers
                .filter((t) => STOCK_OUT_REASONS.includes(t.reason as StockTransferReason))
                .slice(0, 30)
                .map((t) => (
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
                      {STOCK_TRANSFER_REASON_LABELS[t.reason as StockTransferReason] ?? t.reason}
                    </span>
                    {t.notes && (
                      <span
                        title={t.notes}
                        style={{
                          fontSize: 11,
                          color: "var(--ds-text-muted)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 240,
                          fontStyle: "italic",
                        }}
                      >
                        {t.notes}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--ds-text-muted)",
                        marginLeft: "auto",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {new Date(t.transferredAt).toLocaleString()}
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
