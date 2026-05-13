"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Typeahead product picker.
 *
 * Behaviour:
 *   - Empty focus / click on the empty field → shows the full list
 *     (capped at `maxResults`).
 *   - Typing filters the list (case-insensitive substring on name).
 *   - Click / Enter on a row → selects the product, fills the input
 *     with its name, closes the dropdown.
 *   - Click outside → closes the dropdown (without clearing the
 *     input, so the user can resume editing).
 *
 * Price preview: if `priceForProduct` is provided, each row shows a
 * small net-price hint so the user can compare.
 */
export interface ProductPickerProduct {
  id?: string;
  name: string;
  archived?: boolean;
}

export function ProductPicker({
  products,
  selectedProductId,
  selectedName,
  onSelect,
  priceForProduct,
  placeholder = "Search product…",
  autoFocus = false,
  maxResults = 20,
}: {
  products: ProductPickerProduct[];
  /** Currently selected product id, if any. Controls the "clear on
   *  type" behaviour so typing after a selection re-opens the
   *  dropdown. */
  selectedProductId?: string;
  /** Display name shown in the input when a product is selected. */
  selectedName?: string;
  onSelect: (productId: string, product: ProductPickerProduct) => void;
  priceForProduct?: (productId: string) => number | null;
  placeholder?: string;
  autoFocus?: boolean;
  maxResults?: number;
}) {
  const [query, setQuery] = useState<string>(selectedName ?? "");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the input in sync when the parent swaps the selection (e.g.
  // the user picks a different product via a side action).
  useEffect(() => {
    if (selectedName != null) setQuery(selectedName);
  }, [selectedName]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const el = containerRef.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const active = products.filter((p) => p.id && !p.archived);
    const base = q
      ? active.filter((p) => p.name.toLowerCase().includes(q))
      : active;
    return base.slice(0, maxResults);
  }, [products, query, maxResults]);

  function pick(p: ProductPickerProduct) {
    if (!p.id) return;
    onSelect(p.id, p);
    setQuery(p.name);
    setOpen(false);
    inputRef.current?.blur();
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          } else if (e.key === "Enter" && matches.length === 1) {
            e.preventDefault();
            pick(matches[0]);
          }
        }}
        placeholder={placeholder}
        className="input"
        autoFocus={autoFocus}
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-lg max-h-56 overflow-y-auto">
          {matches.map((p) => {
            const price = priceForProduct?.(p.id!);
            const isSelected = p.id === selectedProductId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => pick(p)}
                className={`flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover:bg-muted ${isSelected ? "bg-muted/50" : ""}`}
              >
                <span className="flex-1 truncate">{p.name}</span>
                {price != null && (
                  <span className="text-xs text-muted-foreground tabular-nums">€{price.toFixed(2)}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {open && matches.length === 0 && query.trim().length > 0 && (
        <div className="absolute z-20 left-0 right-0 mt-1 rounded-md border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] shadow-lg px-3 py-2 text-xs text-muted-foreground">
          No matching products.
        </div>
      )}
    </div>
  );
}
