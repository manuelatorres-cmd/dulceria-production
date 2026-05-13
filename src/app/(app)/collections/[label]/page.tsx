"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { useVariants } from "@/lib/hooks";
import {
  PageHeader,
  Section,
  StatusTag,
  VariantRow,
  type VariantRowStatus,
} from "@/components/dulceria";
import type { Variant } from "@/types";

const UNLABELLED_SLUG = "unlabelled";

function getStatus(v: Variant): VariantRowStatus {
  const today = new Date().toISOString().split("T")[0];
  if (!v.endDate) return v.startDate <= today ? "standard" : "upcoming";
  if (v.startDate > today) return "upcoming";
  if (v.endDate < today) return "past";
  return "ongoing";
}

const STATUS_LABEL: Record<VariantRowStatus, string> = {
  ongoing: "ongoing",
  standard: "standard",
  upcoming: "upcoming",
  past: "past",
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function CollectionDetailPage({ params }: { params: Promise<{ label: string }> }) {
  const { label: rawSlug } = use(params);
  const slug = decodeURIComponent(rawSlug);
  const isUnlabelled = slug === UNLABELLED_SLUG;

  const variants = useVariants();

  const { matches, displayLabel } = useMemo(() => {
    if (isUnlabelled) {
      return {
        matches: variants.filter((v) => (v.labels ?? []).length === 0),
        displayLabel: "Unlabelled",
      };
    }
    const lower = slug.toLowerCase();
    let firstCasing = slug;
    const matches = variants.filter((v) => {
      for (const l of v.labels ?? []) {
        if (l.toLowerCase() === lower) {
          firstCasing = l;
          return true;
        }
      }
      return false;
    });
    return { matches, displayLabel: firstCasing };
  }, [variants, slug, isUnlabelled]);

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title={displayLabel}
        meta={`${matches.length} variant${matches.length === 1 ? "" : "s"}${isUnlabelled ? " · no labels" : ""}`}
      />
      <div style={{ padding: "16px 32px 40px" }}>
        {matches.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
              fontStyle: "italic",
            }}
          >
            {isUnlabelled ? "No unlabelled variants." : `No variants use "${displayLabel}" anymore.`}
          </p>
        ) : (
          <Section title="Variants" action={`${matches.length}`}>
            <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
              {matches.map((v) => {
                const status = getStatus(v);
                const dates =
                  status === "ongoing" || status === "standard"
                    ? `from ${formatDate(v.startDate)}`
                    : `${formatDate(v.startDate)} → ${formatDate(v.endDate ?? "")}`;
                const sub = v.description
                  ? v.description
                  : (v.labels ?? []).length > 0
                  ? (v.labels ?? []).join(" · ")
                  : "";
                return (
                  <VariantRow
                    key={v.id}
                    href={`/variants/${encodeURIComponent(v.id ?? "")}`}
                    name={v.name}
                    sub={sub}
                    dates={dates}
                    status={status}
                    statusLabel={STATUS_LABEL[status]}
                  />
                );
              })}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
