"use client";

import Link from "next/link";
import { AllergenDots } from "./allergen-dot";

export type ProductStockVariant = "in" | "low" | "out";

const ACCENT: Record<ProductStockVariant, string> = {
  out: "var(--ds-tier-urgent)",
  low: "var(--ds-semantic-warn)",
  in: "transparent",
};

const BADGE: Record<ProductStockVariant, { bg: string; color: string; text: string }> = {
  out: { bg: "var(--ds-tint-critical)", color: "var(--ds-tier-urgent)", text: "out" },
  low: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)", text: "low" },
  in: { bg: "var(--ds-tint-ok)", color: "var(--ds-tier-positive)", text: "in stock" },
};

/**
 * Compact product card — 1:1 image area with first letter or photo,
 * stock badge top-right, body with name + recipe ingredients + allergen
 * dots. Variant drives left border + badge color.
 */
export function ProductCard({
  href,
  name,
  photoUrl,
  recipeIngredients,
  allergens,
  stockVariant,
  stockLabel,
  archived,
}: {
  href: string;
  name: string;
  photoUrl?: string;
  recipeIngredients?: string[];
  allergens?: string[];
  stockVariant?: ProductStockVariant;
  stockLabel?: string;
  archived?: boolean;
}) {
  const variant: ProductStockVariant = stockVariant ?? "in";
  const accent = ACCENT[variant];
  const badge = BADGE[variant];
  const recipe = (recipeIngredients ?? []).join(" · ");

  return (
    <Link
      href={href}
      style={{
        display: "block",
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderLeft: accent === "transparent" ? "0.5px solid var(--ds-border-warm)" : `2px solid ${accent}`,
        borderRadius: 6,
        overflow: "hidden",
        color: "var(--ds-text-primary)",
        textDecoration: "none",
        opacity: archived ? 0.5 : 1,
      }}
      className="hover:[border-color:var(--ds-tier-quarter-focus)]"
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "1 / 1",
          background: "var(--ds-card-bg-hover)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 32,
              color: "var(--ds-text-muted)",
              fontWeight: 400,
            }}
          >
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        {stockLabel && (
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
            {stockLabel || badge.text}
          </span>
        )}
      </div>
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
        <strong
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--ds-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </strong>
        {recipe && (
          <p
            style={{
              fontSize: 10,
              color: "var(--ds-text-muted)",
              fontStyle: "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {recipe}
          </p>
        )}
        {(allergens?.length ?? 0) > 0 && (
          <div style={{ marginTop: 2 }}>
            <AllergenDots ids={allergens!} size={14} />
          </div>
        )}
      </div>
    </Link>
  );
}
