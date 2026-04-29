"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Prev / next pager for detail pages. Drop on top of any
 * /<resource>/[id] route so the user can flip through the list
 * without bouncing back to the index.
 *
 * Shows a position counter ("12 / 47") between two arrow chips
 * tagged with the prev / next item's name. Disables the relevant
 * arrow at the ends.
 *
 * @example
 *   <DetailNav
 *     items={products}
 *     currentId={productId}
 *     hrefFor={(p) => `/products/${encodeURIComponent(p.id!)}`}
 *     labelFor={(p) => p.name}
 *   />
 */
export function DetailNav<T extends { id?: string }>({
  items, currentId, hrefFor, labelFor,
}: {
  items: T[];
  currentId: string;
  hrefFor: (item: T) => string;
  labelFor?: (item: T) => string;
}) {
  const list = items.filter((i) => i.id);
  const idx = list.findIndex((i) => i.id === currentId);
  if (idx < 0 || list.length <= 1) return null;
  const prev = idx > 0 ? list[idx - 1] : null;
  const next = idx < list.length - 1 ? list[idx + 1] : null;

  return (
    <div className="flex items-center justify-between gap-2 mb-3 text-[11px] text-muted-foreground">
      <Link
        href={prev ? hrefFor(prev) : "#"}
        className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 max-w-[40%] ${
          prev ? "hover:border-foreground/30 hover:text-foreground" : "opacity-30 pointer-events-none"
        }`}
        aria-label="Previous item"
        aria-disabled={!prev}
      >
        <ChevronLeft className="w-3 h-3 shrink-0" />
        <span className="truncate">
          {prev && labelFor ? labelFor(prev) : "Previous"}
        </span>
      </Link>
      <span className="tabular-nums shrink-0">
        {idx + 1} <span className="opacity-60">/ {list.length}</span>
      </span>
      <Link
        href={next ? hrefFor(next) : "#"}
        className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 max-w-[40%] ${
          next ? "hover:border-foreground/30 hover:text-foreground" : "opacity-30 pointer-events-none"
        }`}
        aria-label="Next item"
        aria-disabled={!next}
      >
        <span className="truncate">
          {next && labelFor ? labelFor(next) : "Next"}
        </span>
        <ChevronRight className="w-3 h-3 shrink-0" />
      </Link>
    </div>
  );
}
