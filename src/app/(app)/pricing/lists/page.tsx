"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { usePriceLists, savePriceList, useCustomers } from "@/lib/hooks";
import { newId } from "@/lib/supabase";
import {
  PageHeader,
  Section,
  DsButton,
  StatusTag,
} from "@/components/dulceria";
import { IconPlus, IconSearch } from "@tabler/icons-react";

export default function PriceListsPage() {
  const lists = usePriceLists(true);
  const customers = useCustomers();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState("");

  const customerCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of customers) {
      if (!c.defaultPriceListId) continue;
      m.set(c.defaultPriceListId, (m.get(c.defaultPriceListId) ?? 0) + 1);
    }
    return m;
  }, [customers]);

  async function handleAdd() {
    setCreating(true);
    try {
      const id = newId();
      await savePriceList({ id, name: "New price list", archived: false });
      router.push(`/pricing/lists/${encodeURIComponent(id)}?new=1`);
    } finally {
      setCreating(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lists.filter((l) => !q || l.name.toLowerCase().includes(q));
  }, [lists, search]);

  const active = filtered.filter((l) => !l.archived);
  const archived = filtered.filter((l) => l.archived);

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Price lists"
        meta={`B2B price lists · ${lists.filter((l) => !l.archived).length} active${lists.filter((l) => l.archived).length > 0 ? ` · ${lists.filter((l) => l.archived).length} archived` : ""}`}
        actions={
          <DsButton variant="primary" size="md" onClick={handleAdd} disabled={creating}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconPlus size={14} stroke={1.5} /> {creating ? "Creating…" : "New price list"}
            </span>
          </DsButton>
        }
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search price lists…"
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

        {lists.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            No price lists yet. Click New price list to start.
          </p>
        ) : (
          <>
            {active.length > 0 && (
              <Section title="Active" action={`${active.length} list${active.length === 1 ? "" : "s"}`}>
                <ul
                  style={{
                    padding: 16,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 12,
                    listStyle: "none",
                    margin: 0,
                  }}
                >
                  {active.map((l) => (
                    <PriceListCard
                      key={l.id}
                      list={l}
                      customers={customerCounts.get(l.id ?? "") ?? 0}
                    />
                  ))}
                </ul>
              </Section>
            )}
            {archived.length > 0 && (
              <Section title="Archived" action={`${archived.length} list${archived.length === 1 ? "" : "s"}`}>
                <ul
                  style={{
                    padding: 16,
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                    gap: 12,
                    listStyle: "none",
                    margin: 0,
                  }}
                >
                  {archived.map((l) => (
                    <PriceListCard
                      key={l.id}
                      list={l}
                      customers={customerCounts.get(l.id ?? "") ?? 0}
                    />
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PriceListCard({
  list,
  customers,
}: {
  list: ReturnType<typeof usePriceLists>[number];
  customers: number;
}) {
  return (
    <li>
      <Link
        href={`/pricing/lists/${encodeURIComponent(list.id ?? "")}`}
        style={{
          display: "block",
          background: "var(--ds-card-bg)",
          border: "0.5px solid var(--ds-border-warm)",
          borderLeft: `3px solid ${list.archived ? "var(--ds-tier-parked)" : "var(--ds-tier-quarter-focus)"}`,
          borderRadius: 8,
          padding: "14px 16px",
          textDecoration: "none",
          color: "var(--ds-text-primary)",
          opacity: list.archived ? 0.7 : 1,
        }}
        className="hover:[border-color:var(--ds-tier-quarter-focus)]"
      >
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: "-0.012em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {list.name}
        </div>
        {list.description && (
          <p
            style={{
              fontSize: 12,
              color: "var(--ds-text-muted)",
              marginTop: 4,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {list.description}
          </p>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8, alignItems: "center" }}>
          {list.defaultDiscountPercent !== undefined && (
            <StatusTag kind="neutral">−{list.defaultDiscountPercent}%</StatusTag>
          )}
          {list.validFrom && (
            <span style={{ fontSize: 10, color: "var(--ds-text-muted)" }}>from {list.validFrom}</span>
          )}
          {list.validTo && (
            <span style={{ fontSize: 10, color: "var(--ds-text-muted)" }}>until {list.validTo}</span>
          )}
          <span style={{ fontSize: 10, color: "var(--ds-text-muted)", marginLeft: "auto" }}>
            {customers} customer{customers === 1 ? "" : "s"}
          </span>
        </div>
      </Link>
    </li>
  );
}
