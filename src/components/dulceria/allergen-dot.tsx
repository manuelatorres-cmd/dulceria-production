"use client";

import { allergenShortCode, allergenLabel } from "@/types";

const TINT: Record<string, { bg: string; color: string }> = {
  A: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)" },        // gluten — caramel
  G: { bg: "var(--ds-tint-info)", color: "var(--ds-tier-quarter-focus)" },   // milk — info teal
  H: { bg: "#e8d5bc", color: "#a67f55" },                                    // nuts — cocoa
  E: { bg: "#e8d5bc", color: "#a67f55" },                                    // peanuts — cocoa
  F: { bg: "var(--ds-tint-ok)", color: "var(--ds-tier-positive)" },    // soy — mint
  C: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)" },        // eggs — caramel
  ALK: { bg: "var(--ds-tint-critical)", color: "var(--ds-tier-urgent)" },    // alcohol — rose
  N: { bg: "var(--ds-tint-warn)", color: "var(--ds-semantic-warn)" },        // sesame
  O: { bg: "var(--ds-tint-critical)", color: "var(--ds-tier-urgent)" },      // sulphites
  D: { bg: "var(--ds-tint-info)", color: "var(--ds-tier-quarter-focus)" },   // fish
  default: { bg: "var(--ds-border-warm)", color: "var(--ds-text-muted)" },
};

export function AllergenDot({ id, size = 16 }: { id: string; size?: number }) {
  const code = allergenShortCode(id) ?? id.slice(0, 1).toUpperCase();
  const style = TINT[code] ?? TINT.default;
  return (
    <span
      title={allergenLabel(id)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        fontSize: size === 16 ? 9 : Math.round(size * 0.55),
        fontWeight: 700,
        letterSpacing: 0,
        borderRadius: "50%",
        background: style.bg,
        color: style.color,
        cursor: "help",
      }}
    >
      {code}
    </span>
  );
}

export function AllergenDots({ ids, size = 16 }: { ids: string[]; size?: number }) {
  const codes = new Set<string>();
  const filtered = ids.filter((id) => {
    const c = allergenShortCode(id);
    if (!c) return false;
    if (codes.has(c)) return false;
    codes.add(c);
    return true;
  });
  if (filtered.length === 0) return null;
  return (
    <div style={{ display: "inline-flex", gap: 3, flexWrap: "wrap", alignItems: "center" }}>
      {filtered.map((id) => (
        <AllergenDot key={id} id={id} size={size} />
      ))}
    </div>
  );
}
