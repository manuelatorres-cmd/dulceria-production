"use client";

/**
 * Multi-select chip strip above the demand list (spec §3.1).
 *
 * Each chip toggles independently; "All" clears every other selection.
 * Counts come from a derived predicate function the parent computes once
 * over the filtered ProductDemand[] — keeps this component a pure renderer.
 */

import type { ProductDemand } from "@/lib/manual-planner/aggregate-demand";

export type ChipKey =
  | "all"
  | "online"
  | "b2b"
  | "event"
  | "shop"
  | "restock-po"
  | "campaign-po"
  | "urgent"
  | "in-draft";

const CHIP_LABELS: Record<ChipKey, string> = {
  all: "All",
  online: "Online",
  b2b: "B2B",
  event: "Event",
  shop: "Shop",
  "restock-po": "Restock-PO",
  "campaign-po": "Campaign-PO",
  urgent: "Urgent",
  "in-draft": "Already in draft",
};

const CHIP_ORDER: ChipKey[] = [
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

/** Per-product predicates. ProductDemand passes when at least one of its
 *  source lines matches the chip predicate (or, for "in-draft", the
 *  product-level inDraftQty/draftCount > 0). */
export function productMatchesChip(p: ProductDemand, chip: ChipKey): boolean {
  if (chip === "all") return true;
  if (chip === "in-draft") return p.draftCount > 0 || p.inDraftQty > 0;
  if (chip === "urgent") return p.orderItems.some((l) => l.priority === "urgent");
  if (chip === "online" || chip === "b2b" || chip === "event" || chip === "shop") {
    return p.orderItems.some((l) => l.channel === chip);
  }
  if (chip === "restock-po") return p.poItems.some((l) => l.channel === "restock");
  if (chip === "campaign-po") return p.poItems.some((l) => l.channel === "campaign_run");
  return false;
}

export function applyChipFilter(products: ProductDemand[], selected: Set<ChipKey>): ProductDemand[] {
  if (selected.size === 0 || selected.has("all")) return products;
  return products.filter((p) => {
    for (const chip of selected) {
      if (productMatchesChip(p, chip)) return true;
    }
    return false;
  });
}

export function SourceFilterChips({
  products,
  selected,
  onChange,
}: {
  products: ProductDemand[];
  selected: Set<ChipKey>;
  onChange: (next: Set<ChipKey>) => void;
}) {
  function toggle(chip: ChipKey): void {
    const next = new Set(selected);
    if (chip === "all") {
      next.clear();
      next.add("all");
    } else {
      next.delete("all");
      if (next.has(chip)) next.delete(chip);
      else next.add(chip);
      if (next.size === 0) next.add("all");
    }
    onChange(next);
  }

  return (
    <div
      role="toolbar"
      aria-label="Source filter chips"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "8px 12px",
        borderBottom: "0.5px solid var(--ds-border-warm, #d8d2c7)",
      }}
    >
      {CHIP_ORDER.map((chip) => {
        const isActive = selected.has(chip) || (chip === "all" && selected.size === 0);
        const count = chip === "all"
          ? products.length
          : products.filter((p) => productMatchesChip(p, chip)).length;
        return (
          <button
            key={chip}
            type="button"
            onClick={() => toggle(chip)}
            aria-pressed={isActive}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: isActive ? 600 : 500,
              borderRadius: 999,
              border: isActive
                ? "1px solid var(--ds-primary, #1c3937)"
                : "0.5px solid var(--ds-border-warm, #d8d2c7)",
              background: isActive ? "var(--ds-primary, #1c3937)" : "transparent",
              color: isActive ? "#fff" : "var(--ds-text-primary, #1f1d18)",
              cursor: "pointer",
              transition: "background 0.1s ease, color 0.1s ease",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>{CHIP_LABELS[chip]}</span>
            <span
              className="tabular-nums"
              style={{
                fontSize: 10,
                opacity: 0.75,
                padding: "0 4px",
                borderRadius: 8,
                background: isActive ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.06)",
              }}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
