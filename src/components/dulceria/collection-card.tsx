"use client";

import Link from "next/link";

export function CollectionCard({
  href,
  name,
  count,
  unlabelled,
}: {
  href: string;
  name: string;
  count: number;
  unlabelled?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 4,
        padding: "20px 18px",
        background: "var(--ds-card-bg)",
        border: unlabelled ? "1px dashed var(--ds-border-warm)" : "0.5px solid var(--ds-border-warm)",
        borderRadius: 6,
        textDecoration: "none",
        color: "var(--ds-text-primary)",
        opacity: unlabelled ? 0.6 : 1,
        minHeight: 84,
      }}
      className="hover:[border-color:var(--ds-tier-quarter-focus)]"
    >
      <strong
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 16,
          fontWeight: 500,
          color: "var(--ds-text-primary)",
          fontStyle: unlabelled ? "italic" : "normal",
          textTransform: "capitalize",
        }}
      >
        {name}
      </strong>
      <span style={{ fontSize: 11, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
        {count} variant{count === 1 ? "" : "s"}
        {unlabelled && " · no labels"}
      </span>
    </Link>
  );
}
