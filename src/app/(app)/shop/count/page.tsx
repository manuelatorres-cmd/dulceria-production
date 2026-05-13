"use client";

import { useMemo, useState } from "react";
import {
  useProductsList,
  useProductLocationTotals,
  useProductCategories,
  applyStockAdjustments,
} from "@/lib/hooks";
import {
  PageHeader,
  Section,
  DsButton,
  DsTabNav,
  useToast,
} from "@/components/dulceria";
import { IconSearch } from "@tabler/icons-react";

export default function MonthlyCountPage() {
  const products = useProductsList();
  const totals = useProductLocationTotals();
  const categories = useProductCategories(true);
  const toast = useToast();

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeCategories, setActiveCategories] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const categoryNameById = useMemo(
    () => new Map(categories.map((c) => [c.id!, c.name])),
    [categories],
  );

  const eligible = useMemo(
    () => products.filter((p) => !p.archived).sort((a, b) => a.name.localeCompare(b.name)),
    [products],
  );

  const visible = useMemo(() => {
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

  const variances = useMemo(() => {
    return eligible.map((p) => {
      const system = totals.get(p.id ?? "")?.store ?? 0;
      const rawCount = counts[p.id ?? ""];
      const counted = rawCount === undefined || rawCount === "" ? null : Number(rawCount);
      const variance = counted === null ? 0 : counted - system;
      return { product: p, system, counted, variance };
    });
  }, [eligible, counts, totals]);

  const totalVariance = variances.reduce((s, v) => s + Math.abs(v.variance), 0);
  const entered = variances.filter((v) => v.counted !== null).length;
  const visibleIds = useMemo(() => new Set(visible.map((p) => p.id!)), [visible]);

  async function save() {
    setSaving(true);
    try {
      const inputs = variances
        .filter((v) => v.counted !== null && v.variance !== 0)
        .map((v) => ({
          itemType: "product" as const,
          itemId: v.product.id ?? "",
          location: "store" as const,
          deltaQty: v.variance,
          reason: "correction" as const,
          note: notes
            ? `${notes} (monthly count ${v.variance > 0 ? "+" : ""}${v.variance})`
            : `Monthly count reconciliation (${v.variance > 0 ? "+" : ""}${v.variance})`,
        }));
      const result = await applyStockAdjustments(inputs);
      if (result.failed) {
        const failedName = eligible.find((p) => p.id === result.failed?.itemId)?.name ?? result.failed.itemId;
        toast.error(`Stopped after ${result.applied} adjustments`, {
          description: `Failed at "${failedName}": ${result.error instanceof Error ? result.error.message : "unknown"}`,
        });
        return;
      }
      toast.success(`Reconciled ${result.applied} product${result.applied === 1 ? "" : "s"}`, {
        description: `${totalVariance} pieces total variance`,
      });
      setCounts({});
      setNotes("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Monthly inventory count"
        meta="Walk through the shop with a tablet, enter actuals, save · variances reconcile real productStock totals"
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        {usedCategories.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
          </div>
        )}

        <Section title="Count" action={`${visible.length} of ${eligible.length} products`}>
          <div
            style={{
              background: "var(--ds-card-bg)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) 80px 110px 90px",
                gap: 0,
                padding: "8px 16px",
                background: "var(--ds-card-bg-hover)",
                borderBottom: "0.5px solid var(--ds-border-warm)",
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--ds-text-muted)",
                fontWeight: 600,
              }}
            >
              <span>Product</span>
              <span style={{ textAlign: "right" }}>System</span>
              <span>Count</span>
              <span style={{ textAlign: "right" }}>Variance</span>
            </div>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {variances
                .filter((v) => visibleIds.has(v.product.id!))
                .map((v) => (
                  <li
                    key={v.product.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) 80px 110px 90px",
                      gap: 0,
                      padding: "8px 16px",
                      borderBottom: "0.5px solid var(--ds-border-warm)",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                        fontSize: 13,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {v.product.name}
                    </span>
                    <span
                      style={{
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--ds-text-muted)",
                        textAlign: "right",
                        fontSize: 12,
                      }}
                    >
                      {v.system}
                    </span>
                    <input
                      type="number"
                      min={0}
                      placeholder="—"
                      value={counts[v.product.id ?? ""] ?? ""}
                      onChange={(e) =>
                        setCounts((prev) => ({
                          ...prev,
                          [v.product.id ?? ""]: e.target.value,
                        }))
                      }
                      style={{
                        width: 88,
                        padding: "3px 8px",
                        fontSize: 12,
                        border: "0.5px solid var(--ds-border-warm)",
                        borderRadius: 3,
                        background: "var(--ds-card-bg)",
                        color: "var(--ds-text-primary)",
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    />
                    <span
                      style={{
                        textAlign: "right",
                        fontVariantNumeric: "tabular-nums",
                        fontSize: 12,
                        fontWeight: 500,
                        color:
                          v.counted === null
                            ? "var(--ds-text-muted)"
                            : v.variance === 0
                            ? "var(--ds-tier-positive)"
                            : v.variance > 0
                            ? "var(--ds-semantic-warn)"
                            : "var(--ds-tier-urgent)",
                      }}
                    >
                      {v.counted === null
                        ? "—"
                        : v.variance === 0
                        ? "0"
                        : `${v.variance > 0 ? "+" : ""}${v.variance}`}
                    </span>
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
              placeholder="e.g. pre-Easter stocktake 2026-03"
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
            {entered} counted · {totalVariance} pieces total variance
          </span>
          <DsButton variant="primary" size="md" onClick={save} disabled={saving || entered === 0}>
            {saving ? "Saving…" : "Reconcile"}
          </DsButton>
        </div>
      </div>
    </div>
  );
}
