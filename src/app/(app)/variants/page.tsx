"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useVariants, saveVariant, useAllVariantProducts } from "@/lib/hooks";
import {
  PageHeader,
  CategorySection,
  VariantRow,
  AddCard,
  DsButton,
  type VariantRowStatus,
} from "@/components/dulceria";
import { IconPlus, IconSearch, IconCalendar } from "@tabler/icons-react";
import { usePersistedFilters } from "@/lib/use-persisted-filters";
import type { Variant } from "@/types";

type StatusFilter = "all" | VariantRowStatus;

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "ongoing", label: "Active" },
  { id: "past", label: "Past" },
  { id: "upcoming", label: "Upcoming" },
  { id: "standard", label: "Standard" },
];

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function getStatus(v: Variant, today: string): VariantRowStatus {
  if (!v.endDate) {
    return v.startDate <= today ? "standard" : "upcoming";
  }
  if (v.startDate > today) return "upcoming";
  if (v.endDate < today) return "past";
  return "ongoing";
}

function formatDate(iso?: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00").getTime();
  const db = new Date(b + "T00:00:00").getTime();
  return Math.round((db - da) / 86_400_000);
}

export default function VariantsPage() {
  const router = useRouter();
  const variants = useVariants();
  const allVariantProducts = useAllVariantProducts();
  const [f, setF] = usePersistedFilters("variants-v2", {
    search: "",
    filterStatus: "all" as StatusFilter,
    filterLabel: "",
  });

  const today = isoToday();

  const knownLabels = useMemo(() => {
    const seen = new Map<string, string>();
    for (const v of variants) for (const l of v.labels ?? []) {
      const key = l.toLowerCase().trim();
      if (key && !seen.has(key)) seen.set(key, l.trim());
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [variants]);

  const productCountByVariant = useMemo(() => {
    const m = new Map<string, number>();
    for (const cr of allVariantProducts) m.set(cr.variantId, (m.get(cr.variantId) ?? 0) + 1);
    return m;
  }, [allVariantProducts]);

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return variants
      .filter((v) => {
        if (q && !v.name.toLowerCase().includes(q)) return false;
        if (f.filterStatus !== "all" && getStatus(v, today) !== f.filterStatus) return false;
        if (f.filterLabel && !(v.labels ?? []).some((l) => l.toLowerCase() === f.filterLabel.toLowerCase())) return false;
        return true;
      })
      .map((v) => ({ v, status: getStatus(v, today) }));
  }, [variants, f.search, f.filterStatus, f.filterLabel, today]);

  const groups = useMemo(() => {
    const order: Array<{ id: VariantRowStatus; label: string }> = [
      { id: "ongoing", label: "Active" },
      { id: "standard", label: "Standard" },
      { id: "upcoming", label: "Upcoming" },
      { id: "past", label: "Past" },
    ];
    return order
      .map((g) => ({ ...g, list: filtered.filter((row) => row.status === g.id).map((r) => r.v) }))
      .filter((g) => g.list.length > 0);
  }, [filtered]);

  const totals = useMemo(() => {
    let active = 0;
    let past = 0;
    for (const v of variants) {
      const s = getStatus(v, today);
      if (s === "ongoing" || s === "standard") active++;
      else if (s === "past") past++;
    }
    return { active, past };
  }, [variants, today]);

  async function handleAdd() {
    const id = await saveVariant({
      name: "New variant",
      startDate: today,
      labels: [],
      kind: "curated",
      vatRatePercent: 10,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    router.push(`/variants/${encodeURIComponent(String(id))}?new=1`);
  }

  function statusLabel(v: Variant, status: VariantRowStatus): string {
    if (status === "ongoing") return "ongoing";
    if (status === "standard") return "standard";
    if (status === "past" && v.endDate) {
      const ago = daysBetween(v.endDate, today);
      return `past · ${ago}d ago`;
    }
    if (status === "upcoming") {
      const inDays = daysBetween(today, v.startDate);
      return `upcoming · in ${inDays}d`;
    }
    return status;
  }

  function dateRange(v: Variant, status: VariantRowStatus): string {
    if (status === "ongoing" || status === "standard") return `from ${formatDate(v.startDate)}`;
    return `${formatDate(v.startDate)} → ${formatDate(v.endDate ?? "")}`;
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Variants"
        meta={`${variants.length} variants · ${totals.active} ongoing · ${totals.past} past · seasonal & standard product assortments`}
        actions={
          <>
            <DsButton variant="default" size="md" disabled title="Coming soon">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconCalendar size={14} stroke={1.5} /> Calendar view
              </span>
            </DsButton>
            <DsButton variant="primary" size="md" onClick={handleAdd}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconPlus size={14} stroke={1.5} /> New variant
              </span>
            </DsButton>
          </>
        }
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              border: "0.5px solid var(--ds-border-warm)",
              background: "var(--ds-card-bg)",
              borderRadius: 14,
              maxWidth: 360,
            }}
          >
            <IconSearch size={13} stroke={1.5} style={{ color: "var(--ds-text-muted)" }} />
            <input
              type="text"
              value={f.search}
              onChange={(e) => setF("search", e.target.value)}
              placeholder="Search variants…"
              style={{
                fontSize: 12,
                border: "none",
                background: "transparent",
                outline: "none",
                flex: 1,
                color: "var(--ds-text-primary)",
              }}
            />
          </div>
          <PillRow
            label="Status"
            options={STATUS_FILTERS.map((s) => ({ id: s.id, label: s.label }))}
            isActive={(id) => f.filterStatus === id}
            onSelect={(id) => setF("filterStatus", id as StatusFilter)}
          />
          {knownLabels.length > 0 && (
            <PillRow
              label="Label"
              options={[{ id: "", label: "All" }, ...knownLabels.map((l) => ({ id: l, label: l }))]}
              isActive={(id) => f.filterLabel === id}
              onSelect={(id) => setF("filterLabel", id)}
            />
          )}
        </div>

        {groups.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            {variants.length === 0 ? "No variants yet." : "No variants match the filters."}
          </p>
        ) : (
          groups.map((g) => (
            <CategorySection
              key={g.id}
              title={g.label}
              count={`${g.list.length} variant${g.list.length === 1 ? "" : "s"}`}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {g.list.map((v) => {
                  const status = getStatus(v, today);
                  const count = v.id ? productCountByVariant.get(v.id) ?? 0 : 0;
                  const isBox = (v.labels ?? []).map((l) => l.toLowerCase()).some((l) => l.includes("box"));
                  const isB2b = (v.labels ?? []).map((l) => l.toLowerCase()).some((l) => l.includes("b2b"));
                  const sub = [
                    v.kind ?? "curated",
                    `${count} product${count === 1 ? "" : "s"}${isBox ? " in box" : ""}`,
                    isB2b ? "B2B" : null,
                  ]
                    .filter((x): x is string => Boolean(x))
                    .join(" · ");
                  return (
                    <VariantRow
                      key={v.id}
                      href={`/variants/${encodeURIComponent(v.id ?? "")}`}
                      name={v.name}
                      sub={sub}
                      dates={dateRange(v, status)}
                      status={status}
                      statusLabel={statusLabel(v, status)}
                    />
                  );
                })}
                {g.id === "ongoing" && (
                  <AddCard label="new variant" onClick={handleAdd} aspect="row" />
                )}
              </div>
            </CategorySection>
          ))
        )}
      </div>
    </div>
  );
}

function PillRow({
  label,
  options,
  isActive,
  onSelect,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  isActive: (id: string) => boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--ds-text-muted)",
          fontWeight: 600,
          marginRight: 4,
        }}
      >
        {label}
      </span>
      {options.map((o) => {
        const active = isActive(o.id);
        return (
          <button
            key={o.id || "all"}
            type="button"
            onClick={() => onSelect(o.id)}
            style={{
              padding: "3px 10px",
              fontSize: 11,
              border: `0.5px solid ${active ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
              background: active ? "var(--ds-tier-quarter-focus)" : "var(--ds-card-bg)",
              color: active ? "#ffffff" : "var(--ds-text-muted)",
              borderRadius: 12,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
