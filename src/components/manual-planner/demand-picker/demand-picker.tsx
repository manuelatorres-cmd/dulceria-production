"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ProductDemand } from "@/lib/manual-planner/aggregate-demand";
import type { SmartSuggestion } from "@/lib/manual-planner/smart-suggestions";
import { CategoryGroup } from "./category-group";
import { ProductRow } from "./product-row";
import {
  SourceFilterChips,
  applyChipFilter,
  type ChipKey,
} from "../source-filter-chips";

const VALID_CHIPS: ChipKey[] = [
  "all",
  "online",
  "b2b",
  "event",
  "shop",
  "restock-po",
  "campaign-po",
  "urgent",
  "in-draft",
];

function parseChips(raw: string | null): Set<ChipKey> {
  if (!raw) return new Set<ChipKey>();
  const parts = raw.split(",").map((s) => s.trim()).filter(Boolean) as ChipKey[];
  const set = new Set<ChipKey>();
  for (const p of parts) if (VALID_CHIPS.includes(p)) set.add(p);
  return set;
}

function serialiseChips(set: Set<ChipKey>): string {
  return [...set].join(",");
}

export function DemandPicker({
  products,
  draftProductId,
  draftOrderItemIds,
  draftPoItemIds,
  onPickOrderLine,
  onPickPoLine,
  onAcceptSuggestion,
}: {
  products: ProductDemand[];
  draftProductId: string | null;
  draftOrderItemIds: Set<string>;
  draftPoItemIds: Set<string>;
  onPickOrderLine: (args: { orderItemId: string; productId: string; qty: number; customerName: string }) => void;
  onPickPoLine: (args: { poItemId: string; productId: string; qty: number; poName: string }) => void;
  onAcceptSuggestion: (productId: string, suggestion: SmartSuggestion) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [chips, setChips] = useState<Set<ChipKey>>(parseChips(searchParams.get("chips")));
  const [search, setSearchState] = useState<string>(searchParams.get("q") ?? "");
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  // Sync URL when chips or search change.
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    const chipParam = serialiseChips(chips);
    if (!chipParam || chipParam === "all") params.delete("chips");
    else params.set("chips", chipParam);
    if (!search) params.delete("q");
    else params.set("q", search);
    const next = params.toString();
    const url = next ? `${pathname}?${next}` : pathname;
    router.replace(url, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chips, search, pathname, router]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const chipFiltered = applyChipFilter(products, chips);
    if (!q) return chipFiltered;
    return chipFiltered.filter((p) => p.productName.toLowerCase().includes(q));
  }, [products, chips, search]);

  const grouped = useMemo(() => {
    const m = new Map<string, { sort: number; products: ProductDemand[] }>();
    for (const p of filtered) {
      const cur = m.get(p.category) ?? { sort: p.categorySort, products: [] };
      cur.products.push(p);
      m.set(p.category, cur);
    }
    return Array.from(m.entries())
      .sort(([, a], [, b]) => a.sort - b.sort)
      .map(([label, { products: rows }]) => ({ label, products: rows }));
  }, [filtered]);

  const totalProducts = filtered.length;
  const totalPieces = filtered.reduce((s, p) => s + p.totalDemand, 0);

  function handleToggle(productId: string) {
    setExpandedProductId((cur) => (cur === productId ? null : productId));
  }

  return (
    <div
      className="flex flex-col"
      style={{
        background: "var(--mp-card-bg)",
        border: "0.5px solid var(--mp-border-warm)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        className="px-5 pt-4 pb-3"
        style={{ borderBottom: "0.5px solid var(--mp-border-warm)" }}
      >
        <h2
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--mp-text-primary)",
            marginBottom: 4,
          }}
        >
          Open demand
        </h2>
        <p
          className="text-[12px] italic"
          style={{ color: "var(--mp-text-muted)" }}
        >
          {totalProducts} product{totalProducts === 1 ? "" : "s"} · {totalPieces} pcs needed
        </p>
      </div>

      <div style={{ borderBottom: "0.5px solid var(--mp-border-warm)" }}>
        <SourceFilterChips
          products={products}
          selected={chips}
          onChange={setChips}
        />
        <div className="px-5 py-2">
          <input
            type="search"
            placeholder="Search product…"
            value={search}
            onChange={(e) => setSearchState(e.target.value)}
            style={{
              width: "100%",
              padding: "4px 8px",
              fontSize: 12,
              borderRadius: 4,
              border: "0.5px solid var(--mp-border-warm)",
              background: "var(--mp-page-bg, #fff)",
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ maxHeight: "calc(100vh - 320px)" }}>
        {grouped.length === 0 ? (
          <p
            className="px-5 py-6 text-[12.5px] italic text-center"
            style={{ color: "var(--mp-text-muted)" }}
          >
            No demand matches the current filter.
          </p>
        ) : (
          grouped.map((group) => (
            <CategoryGroup
              key={group.label}
              label={group.label}
              productCount={group.products.length}
            >
              {group.products.map((product) => (
                <ProductRow
                  key={product.productId}
                  product={product}
                  expanded={expandedProductId === product.productId}
                  onToggle={() => handleToggle(product.productId)}
                  inDraft={draftProductId === product.productId}
                  draftOrderItemIds={draftOrderItemIds}
                  draftPoItemIds={draftPoItemIds}
                  onPickOrderLine={onPickOrderLine}
                  onPickPoLine={onPickPoLine}
                  onAcceptSuggestion={onAcceptSuggestion}
                />
              ))}
            </CategoryGroup>
          ))
        )}
      </div>
    </div>
  );
}
