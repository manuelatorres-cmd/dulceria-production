"use client";

import type { ReactNode } from "react";

/**
 * Slim group divider per workflow redesign §3 (≤26px tall).
 * Colored dot · UPPERCASE mould-bucket name · "· N pcs/run" · count
 * Color is hashed from the label so each mould bucket gets a stable
 * dot tint without needing a per-mould-type registry.
 */
function colorForLabel(label: string): string {
  // Tiny deterministic hash → hue.
  let hash = 0;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 31 + label.charCodeAt(i)) & 0xffff;
  }
  const hue = hash % 360;
  // Constrain saturation/lightness so dots read on cream bg without glare.
  return `hsl(${hue}, 45%, 50%)`;
}

export function CategoryGroup({
  label,
  productCount,
  meta,
  children,
}: {
  label: string;
  productCount: number;
  meta?: string;
  children: ReactNode;
}) {
  const dotColor = colorForLabel(label);
  // Split "Bar mould · 3 pcs/run" into name + spec for two-tone rendering.
  const [primary, ...rest] = label.split(" · ");
  const specSuffix = rest.length > 0 ? ` · ${rest.join(" · ")}` : "";

  return (
    <div>
      <div className="mp-group-divider">
        <span className="dot" style={{ background: dotColor }} aria-hidden />
        <span>{primary}</span>
        {specSuffix ? (
          <span style={{ opacity: 0.6, fontWeight: 500 }}>{specSuffix}</span>
        ) : null}
        <span className="count-trail">
          {productCount} product{productCount === 1 ? "" : "s"}
          {meta ? ` · ${meta}` : ""}
        </span>
      </div>
      <div>{children}</div>
    </div>
  );
}
