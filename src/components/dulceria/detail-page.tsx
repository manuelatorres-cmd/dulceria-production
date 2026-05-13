"use client";

import Link from "next/link";
import { IconArrowLeft, IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { DsTabNav, type DsTabNavTab } from "./tab-nav";
import { StatusTag } from "./status-tag";

export interface DsDetailPageProps {
  title: string;
  /** Optional inline title editor — replaces the static title. */
  titleEditor?: ReactNode;
  /** Sub-header line, rendered italic muted. */
  meta?: string;
  /** Optional status pill rendered next to title. */
  statusBadge?: ReactNode;
  /** Optional breadcrumb (single up-link). */
  breadcrumb?: { label: string; href: string };
  /** Optional prev/next sibling navigation. */
  navAdjacent?: {
    prev?: { id: string; label: string; href: string };
    next?: { id: string; label: string; href: string };
  };
  /** Optional right-side action buttons / dropdowns. */
  actions?: ReactNode;
  /** Optional tab strip below the header. */
  tabs?: DsTabNavTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  children: ReactNode;
}

/**
 * Production-app design-system detail-page wrapper. Used by every
 * `[id]` route to keep header / breadcrumb / nav / tabs consistent.
 *
 * Wraps content in `.ds` scope. Pages that opt-in should NOT add an
 * outer `.ds` wrapper themselves.
 */
export function DsDetailPage({
  title,
  titleEditor,
  meta,
  statusBadge,
  breadcrumb,
  navAdjacent,
  actions,
  tabs,
  activeTab,
  onTabChange,
  children,
}: DsDetailPageProps) {
  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <header
        style={{
          padding: "16px 32px",
          borderBottom: "0.5px solid var(--ds-border-warm)",
          background: "var(--ds-page-bg)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {breadcrumb && (
          <Link
            href={breadcrumb.href}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.1em",
              color: "var(--ds-text-muted)",
              textDecoration: "none",
              width: "fit-content",
            }}
            className="hover:[color:var(--ds-text-primary)]"
          >
            <IconArrowLeft size={11} stroke={1.5} /> {breadcrumb.label}
          </Link>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            {titleEditor ?? <h1 className="text-ds-page-title">{title}</h1>}
            {statusBadge}
            {meta && (
              <span style={{ fontSize: 12, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
                {meta}
              </span>
            )}
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {navAdjacent && <AdjacentNav nav={navAdjacent} />}
            {actions}
          </div>
        </div>
      </header>

      {tabs && tabs.length > 0 && (
        <div style={{ padding: "0 32px", background: "var(--ds-page-bg)" }}>
          <DsTabNav tabs={tabs} activeTab={activeTab ?? tabs[0]?.id ?? ""} onChange={onTabChange} />
        </div>
      )}

      <div style={{ padding: "16px 32px 40px" }}>{children}</div>
    </div>
  );
}

function AdjacentNav({ nav }: { nav: NonNullable<DsDetailPageProps["navAdjacent"]> }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {nav.prev ? (
        <Link
          href={nav.prev.href}
          title={nav.prev.label}
          aria-label={`Previous: ${nav.prev.label}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            border: "0.5px solid var(--ds-border-warm)",
            background: "var(--ds-card-bg)",
            borderRadius: 4,
            color: "var(--ds-text-muted)",
            textDecoration: "none",
          }}
          className="hover:[color:var(--ds-text-primary)]"
        >
          <IconChevronLeft size={14} stroke={1.5} />
        </Link>
      ) : (
        <PlaceholderArrow side="left" />
      )}
      {nav.next ? (
        <Link
          href={nav.next.href}
          title={nav.next.label}
          aria-label={`Next: ${nav.next.label}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28,
            height: 28,
            border: "0.5px solid var(--ds-border-warm)",
            background: "var(--ds-card-bg)",
            borderRadius: 4,
            color: "var(--ds-text-muted)",
            textDecoration: "none",
          }}
          className="hover:[color:var(--ds-text-primary)]"
        >
          <IconChevronRight size={14} stroke={1.5} />
        </Link>
      ) : (
        <PlaceholderArrow side="right" />
      )}
    </div>
  );
}

function PlaceholderArrow({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        border: "0.5px solid var(--ds-border-warm)",
        background: "var(--ds-card-bg)",
        borderRadius: 4,
        opacity: 0.35,
      }}
    >
      {side === "left" ? <IconChevronLeft size={14} stroke={1.5} /> : <IconChevronRight size={14} stroke={1.5} />}
    </span>
  );
}

/** Convenience re-export so callers can render a StatusTag without an extra import. */
export { StatusTag };
