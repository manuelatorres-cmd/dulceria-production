"use client";

import Link from "next/link";

export type DecoStockVariant = "in" | "low" | "out" | "ordered";

const BADGE: Record<DecoStockVariant, { bg: string; color: string; text: string }> = {
  in: { bg: "var(--ds-tint-ok)", color: "var(--ds-tier-positive)", text: "in" },
  low: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)", text: "low" },
  out: { bg: "var(--ds-tint-critical)", color: "var(--ds-tier-urgent)", text: "out" },
  ordered: { bg: "var(--ds-tint-info)", color: "var(--ds-tier-quarter-focus)", text: "ordered" },
};

function isShimmerType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("lustre") || t.includes("dust") || t.includes("pigment");
}

function isSheetType(type: string): boolean {
  const t = type.toLowerCase();
  return t.includes("sheet") || t.includes("transfer");
}

export function DecoSwatch({
  href,
  name,
  brand,
  productCount,
  colorHex,
  type,
  stockVariant,
  archived,
}: {
  href: string;
  name: string;
  brand?: string;
  productCount: number;
  colorHex?: string;
  type: string;
  stockVariant?: DecoStockVariant;
  archived?: boolean;
}) {
  const badge = stockVariant ? BADGE[stockVariant] : null;
  const shimmer = isShimmerType(type);
  const sheet = isSheetType(type);

  const colorBg: string =
    colorHex ??
    (shimmer
      ? "linear-gradient(135deg, #f0e3c8 0%, #fff7e3 30%, #d9c285 65%, #ffeec4 100%)"
      : sheet
      ? "repeating-linear-gradient(45deg, var(--ds-border-warm) 0 6px, var(--ds-card-bg-hover) 6px 12px)"
      : "var(--ds-card-bg-hover)");

  return (
    <Link
      href={href}
      style={{
        display: "block",
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderRadius: 6,
        overflow: "hidden",
        textDecoration: "none",
        color: "var(--ds-text-primary)",
        opacity: archived ? 0.5 : 1,
      }}
      className="hover:[border-color:var(--ds-tier-quarter-focus)]"
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "1.4 / 1",
          background: colorBg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {!colorHex && !shimmer && !sheet && (
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 22,
              color: "var(--ds-text-muted)",
              fontWeight: 400,
            }}
          >
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        {badge && (
          <span
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              fontSize: 9,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              padding: "2px 5px",
              borderRadius: 3,
              background: badge.bg,
              color: badge.color,
            }}
          >
            {badge.text}
          </span>
        )}
      </div>
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
        <strong
          style={{
            fontSize: 12,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </strong>
        {brand && (
          <span
            style={{
              fontSize: 10,
              color: "var(--ds-text-muted)",
              fontStyle: "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {brand}
          </span>
        )}
        <span style={{ fontSize: 10, color: "var(--ds-text-muted)" }}>
          {productCount === 0 ? "not yet used" : `used in ${productCount} product${productCount === 1 ? "" : "s"}`}
        </span>
      </div>
    </Link>
  );
}
