"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  usePackagingList,
  useAllPackagingOrders,
  savePackaging,
  useCurrencySymbol,
} from "@/lib/hooks";
import { PageHeader, DsButton, AddCard } from "@/components/dulceria";
import { IconPlus, IconSearch, IconPackage } from "@tabler/icons-react";
import { usePersistedFilters } from "@/lib/use-persisted-filters";
import type { PackagingOrder } from "@/types";

type StockFilter = "all" | "in" | "low" | "out" | "ordered";

const STOCK_FILTERS: Array<{ id: StockFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "in", label: "In stock" },
  { id: "low", label: "Low" },
  { id: "out", label: "Out" },
  { id: "ordered", label: "Ordered" },
];

const STOCK_TINT: Record<"in" | "low" | "out" | "ordered", { bg: string; color: string; text: string }> = {
  in: { bg: "var(--ds-tint-ok)", color: "var(--ds-tier-positive)", text: "in stock" },
  low: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)", text: "low" },
  out: { bg: "var(--ds-tint-critical)", color: "var(--ds-tier-urgent)", text: "out" },
  ordered: { bg: "var(--ds-tint-info)", color: "var(--ds-tier-quarter-focus)", text: "ordered" },
};

function getStock(p: { lowStock?: boolean; outOfStock?: boolean; lowStockOrdered?: boolean }): "in" | "low" | "out" | "ordered" {
  if (p.outOfStock) return "out";
  if (p.lowStock && p.lowStockOrdered) return "ordered";
  if (p.lowStock) return "low";
  return "in";
}

export default function PackagingPage() {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("packaging-v2", {
    search: "",
    filterStock: "all" as StockFilter,
    showArchived: false,
  });
  const packaging = usePackagingList(f.showArchived);
  const orders = useAllPackagingOrders();
  const sym = useCurrencySymbol();

  const latestOrderMap = useMemo(() => {
    const m = new Map<string, PackagingOrder>();
    for (const o of orders) {
      const ex = m.get(o.packagingId);
      if (!ex || new Date(o.orderedAt) > new Date(ex.orderedAt)) m.set(o.packagingId, o);
    }
    return m;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return packaging.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !(p.manufacturer ?? "").toLowerCase().includes(q)) return false;
      if (f.filterStock !== "all" && getStock(p) !== f.filterStock) return false;
      return true;
    });
  }, [packaging, f.search, f.filterStock]);

  const total = packaging.length;
  const lowCount = packaging.filter((p) => p.lowStock || p.outOfStock).length;
  const costs = useMemo(() => {
    const all: number[] = [];
    for (const p of packaging) {
      const latest = latestOrderMap.get(p.id ?? "");
      if (latest?.pricePerUnit) all.push(latest.pricePerUnit);
    }
    if (all.length === 0) return null;
    return { min: Math.min(...all), max: Math.max(...all) };
  }, [packaging, latestOrderMap]);

  async function handleAdd() {
    const id = await savePackaging({
      name: "New packaging",
      capacity: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    router.push(`/packaging/${encodeURIComponent(String(id))}?new=1`);
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Packaging"
        meta={`${total} SKUs${costs ? ` · ${sym}${costs.min.toFixed(2)}–${sym}${costs.max.toFixed(2)} unit cost` : ""}${lowCount > 0 ? ` · ${lowCount} low stock` : ""}`}
        actions={
          <DsButton variant="primary" size="md" onClick={handleAdd}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconPlus size={14} stroke={1.5} /> New packaging
            </span>
          </DsButton>
        }
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
              value={f.search}
              onChange={(e) => setF("search", e.target.value)}
              placeholder="Search packaging…"
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

          <PillRow
            label="Stock"
            options={STOCK_FILTERS.map((s) => ({ id: s.id, label: s.label }))}
            isActive={(id) => f.filterStock === id}
            onSelect={(id) => setF("filterStock", id as StockFilter)}
          />
        </div>

        {filtered.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            {packaging.length === 0 ? "No packaging yet." : "No SKUs match the filters."}
          </p>
        ) : (
          <div
            style={{
              background: "var(--ds-card-bg)",
              border: "0.5px solid var(--ds-border-warm)",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "60px minmax(0, 1fr) 100px 90px 110px 130px",
                gap: 0,
                padding: "8px 12px",
                background: "var(--ds-card-bg-hover)",
                borderBottom: "0.5px solid var(--ds-border-warm)",
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--ds-text-muted)",
                fontWeight: 600,
              }}
            >
              <span />
              <span>Name · supplier</span>
              <span>Fits</span>
              <span>Cost/unit</span>
              <span>Stock</span>
              <span>Last order</span>
            </div>
            <ul style={{ display: "flex", flexDirection: "column" }}>
              {filtered.map((p) => {
                const stock = getStock(p);
                const tint = STOCK_TINT[stock];
                const accent =
                  stock === "out"
                    ? "var(--ds-tier-urgent)"
                    : stock === "low"
                    ? "var(--ds-semantic-warn)"
                    : "transparent";
                const latest = latestOrderMap.get(p.id ?? "");
                return (
                  <li
                    key={p.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "60px minmax(0, 1fr) 100px 90px 110px 130px",
                      gap: 0,
                      alignItems: "center",
                      padding: "10px 12px",
                      borderBottom: "0.5px solid var(--ds-border-warm)",
                      borderLeft: `2px solid ${accent}`,
                      opacity: p.archived ? 0.5 : 1,
                    }}
                  >
                    <Link href={`/packaging/${encodeURIComponent(p.id ?? "")}`} style={{ display: "block" }}>
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 40,
                          height: 40,
                          background: "var(--ds-card-bg-hover)",
                          borderRadius: 6,
                          color: "var(--ds-text-muted)",
                        }}
                      >
                        <IconPackage size={18} stroke={1.5} />
                      </span>
                    </Link>
                    <Link
                      href={`/packaging/${encodeURIComponent(p.id ?? "")}`}
                      style={{ minWidth: 0, color: "var(--ds-text-primary)", textDecoration: "none" }}
                    >
                      <strong style={{ fontSize: 13, fontWeight: 500, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.name}
                      </strong>
                      {p.manufacturer && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--ds-text-muted)",
                            fontStyle: "italic",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            display: "block",
                          }}
                        >
                          {p.manufacturer}
                        </span>
                      )}
                    </Link>
                    <span
                      style={{
                        fontSize: 12,
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--ds-text-primary)",
                      }}
                    >
                      <strong style={{ fontWeight: 500 }}>{p.capacity}</strong>{" "}
                      <span style={{ fontSize: 10, color: "var(--ds-text-muted)" }}>
                        unit{p.capacity === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontVariantNumeric: "tabular-nums",
                        color: "var(--ds-text-primary)",
                      }}
                    >
                      {latest ? `${sym}${latest.pricePerUnit.toFixed(2)}` : "—"}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        padding: "3px 8px",
                        borderRadius: 3,
                        background: tint.bg,
                        color: tint.color,
                        width: "fit-content",
                      }}
                    >
                      {tint.text}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        color: "var(--ds-text-muted)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {latest
                        ? `${new Date(latest.orderedAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })} · ${latest.quantity} units`
                        : "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <AddCard label="new packaging" onClick={handleAdd} aspect="row" />
      </div>
    </div>
  );
}

function PillRow({
  label,
  options,
  isActive,
  onSelect,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  isActive: (id: string) => boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--ds-text-muted)",
          fontWeight: 600,
          marginRight: 4,
        }}
      >
        {label}
      </span>
      {options.map((o) => {
        const active = isActive(o.id);
        return (
          <button
            key={o.id || "all"}
            type="button"
            onClick={() => onSelect(o.id)}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              border: `0.5px solid ${active ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
              background: active ? "var(--ds-tier-quarter-focus)" : "var(--ds-card-bg)",
              color: active ? "#ffffff" : "var(--ds-text-muted)",
              borderRadius: 12,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
