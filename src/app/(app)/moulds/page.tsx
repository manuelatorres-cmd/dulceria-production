"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMoulds, saveMould } from "@/lib/hooks";
import {
  PageHeader,
  MouldCard,
  AddCard,
  DsButton,
  inferMouldShape,
} from "@/components/dulceria";
import { IconPlus, IconSearch } from "@tabler/icons-react";
import { usePersistedFilters } from "@/lib/use-persisted-filters";

export default function MouldsPage() {
  const router = useRouter();
  const [f, setF] = usePersistedFilters("moulds-v2", {
    search: "",
    filterTag: "",
    filterBrand: "",
    showArchived: false,
  });
  const moulds = useMoulds(f.showArchived);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const m of moulds) for (const t of m.tags ?? []) set.add(t);
    return Array.from(set).sort();
  }, [moulds]);

  const allBrands = useMemo(() => {
    const set = new Set<string>();
    for (const m of moulds) if (m.brand) set.add(m.brand);
    return Array.from(set).sort();
  }, [moulds]);

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return moulds.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q) && !(m.brand ?? "").toLowerCase().includes(q)) return false;
      if (f.filterTag && !(m.tags ?? []).includes(f.filterTag)) return false;
      if (f.filterBrand && m.brand !== f.filterBrand) return false;
      return true;
    });
  }, [moulds, f.search, f.filterTag, f.filterBrand]);

  const totalCavities = useMemo(() => moulds.reduce((s, m) => s + (m.numberOfCavities || 0), 0), [moulds]);
  const productCount = useMemo(() => {
    const set = new Set<string>();
    for (const m of moulds) for (const t of m.tags ?? []) set.add(t);
    return set.size; // approximation: no direct mould→product link in pantry list
  }, [moulds]);

  async function handleAdd() {
    const id = await saveMould({ name: "New mould", cavityWeightG: 0, numberOfCavities: 0 });
    router.push(`/moulds/${encodeURIComponent(String(id))}?new=1`);
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Moulds"
        meta={`${moulds.length} moulds${productCount > 0 ? ` · used by ${productCount} product tag${productCount === 1 ? "" : "s"}` : ""} · total capacity ${totalCavities} fills simultaneously`}
        actions={
          <DsButton variant="primary" size="md" onClick={handleAdd}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconPlus size={14} stroke={1.5} /> New mould
            </span>
          </DsButton>
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
              placeholder="Search moulds…"
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

          {allTags.length > 0 && (
            <PillRow
              label="Tag"
              options={[{ id: "", label: "All" }, ...allTags.map((t) => ({ id: t, label: t }))]}
              isActive={(id) => f.filterTag === id}
              onSelect={(id) => setF("filterTag", id)}
            />
          )}
          {allBrands.length > 0 && (
            <PillRow
              label="Brand"
              options={[{ id: "", label: "All" }, ...allBrands.map((b) => ({ id: b, label: b }))]}
              isActive={(id) => f.filterBrand === id}
              onSelect={(id) => setF("filterBrand", id)}
            />
          )}
        </div>

        {filtered.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            {moulds.length === 0 ? "No moulds yet." : "No moulds match the filters."}
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            {filtered.map((m) => (
              <MouldCard
                key={m.id}
                href={`/moulds/${encodeURIComponent(m.id ?? "")}`}
                name={m.name}
                brand={m.brand}
                weightG={m.cavityWeightG}
                cavities={m.numberOfCavities}
                photoUrl={m.photo}
                shape={inferMouldShape(m.name, m.tags)}
                archived={m.archived}
              />
            ))}
            <AddCard label="new mould" onClick={handleAdd} aspect="mould" />
          </div>
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
