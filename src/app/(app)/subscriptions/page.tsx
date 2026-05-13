"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  useSubscriptionTemplates,
  useSubscriptionRuns,
  saveSubscriptionTemplate,
} from "@/lib/hooks";
import { newId } from "@/lib/supabase";
import {
  PageHeader,
  Section,
  DsButton,
  DsTabNav,
  StatusTag,
} from "@/components/dulceria";
import { IconPlus, IconSearch } from "@tabler/icons-react";

type Filter = "all" | "active" | "inactive";

export default function SubscriptionsPage() {
  const templates = useSubscriptionTemplates(true);
  const runs = useSubscriptionRuns();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const runsByTemplate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runs) m.set(r.templateId, (m.get(r.templateId) ?? 0) + 1);
    return m;
  }, [runs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (q && !t.name.toLowerCase().includes(q)) return false;
      if (filter === "active" && !t.active) return false;
      if (filter === "inactive" && t.active) return false;
      return true;
    });
  }, [templates, filter, search]);

  const activeCount = templates.filter((t) => t.active).length;
  const inactiveCount = templates.length - activeCount;

  async function handleAdd() {
    setCreating(true);
    try {
      const id = newId();
      await saveSubscriptionTemplate({
        id,
        name: "New subscription",
        pieceCount: 8,
        frequency: "monthly",
        active: true,
      });
      router.push(`/subscriptions/${encodeURIComponent(id)}?new=1`);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Subscriptions"
        meta={`Recurring box templates · ${templates.length} total · ${activeCount} active${inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ""}`}
        actions={
          <DsButton variant="primary" size="md" onClick={handleAdd} disabled={creating}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconPlus size={14} stroke={1.5} /> {creating ? "Creating…" : "New subscription"}
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
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subscriptions…"
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
          <DsTabNav
            variant="pills"
            tabs={[
              { id: "all", label: "All", count: templates.length },
              { id: "active", label: "Active", count: activeCount },
              { id: "inactive", label: "Inactive", count: inactiveCount },
            ]}
            activeTab={filter}
            onChange={(id) => setFilter(id as Filter)}
          />
        </div>

        {templates.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            No subscription templates yet. Click New subscription to start.
          </p>
        ) : filtered.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "32px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            No templates match the current filter.
          </p>
        ) : (
          <Section title="Templates" action={`${filtered.length} of ${templates.length}`}>
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
              {filtered.map((t) => {
                const cycles = runsByTemplate.get(t.id ?? "") ?? 0;
                return (
                  <li key={t.id}>
                    <Link
                      href={`/subscriptions/${encodeURIComponent(t.id ?? "")}`}
                      style={{
                        display: "block",
                        background: "var(--ds-card-bg)",
                        border: "0.5px solid var(--ds-border-warm)",
                        borderLeft: `3px solid ${t.active ? "var(--ds-tier-positive)" : "var(--ds-tier-parked)"}`,
                        borderRadius: 8,
                        padding: "14px 16px",
                        textDecoration: "none",
                        color: "var(--ds-text-primary)",
                        opacity: t.active ? 1 : 0.6,
                      }}
                      className="hover:[border-color:var(--ds-tier-quarter-focus)]"
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          justifyContent: "space-between",
                          gap: 8,
                        }}
                      >
                        <strong
                          style={{
                            fontFamily: "var(--font-serif)",
                            fontSize: 15,
                            fontWeight: 500,
                            letterSpacing: "-0.012em",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {t.name}
                        </strong>
                        <span
                          style={{
                            fontSize: 10,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "var(--ds-text-muted)",
                            fontWeight: 600,
                          }}
                        >
                          {t.frequency}
                        </span>
                      </div>
                      <p style={{ fontSize: 11, color: "var(--ds-text-muted)", marginTop: 6 }}>
                        {t.pieceCount} pcs per box · {cycles} cycle{cycles === 1 ? "" : "s"} planned
                      </p>
                      {!t.active && (
                        <div style={{ marginTop: 8 }}>
                          <StatusTag kind="done">Inactive</StatusTag>
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}
