"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCustomers, saveCustomer, useOrders, useAllOrderItems } from "@/lib/hooks";
import { computeCustomerAnalytics } from "@/lib/customerAnalytics";
import { computeMissingRequiredCustomerFields } from "@/lib/customerRequiredFields";
import {
  PageHeader,
  Section,
  DsButton,
  DsTabNav,
  StatusTag,
  useToast,
} from "@/components/dulceria";
import { IconPlus, IconSearch, IconArchive, IconAlertTriangle } from "@tabler/icons-react";

type Sort = "name" | "lifetime" | "last";

export default function CustomersPage() {
  const customers = useCustomers(true);
  const orders = useOrders();
  const orderItems = useAllOrderItems();
  const toast = useToast();

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [sort, setSort] = useState<Sort>("name");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [busy, setBusy] = useState(false);

  const stats = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeCustomerAnalytics>>();
    for (const c of customers) {
      if (!c.id) continue;
      map.set(c.id, computeCustomerAnalytics({ customerId: c.id, orders, orderItems }));
    }
    return map;
  }, [customers, orders, orderItems]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const c of customers) for (const t of c.tags ?? []) tags.add(t);
    return Array.from(tags).sort();
  }, [customers]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers
      .filter((c) => (showArchived ? true : !c.archived))
      .filter((c) => !selectedTag || c.tags?.includes(selectedTag))
      .filter((c) => {
        if (!q) return true;
        return (
          c.companyName.toLowerCase().includes(q) ||
          (c.contactName ?? "").toLowerCase().includes(q) ||
          (c.email ?? "").toLowerCase().includes(q) ||
          (c.tags ?? []).some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        const sa = stats.get(a.id!);
        const sb = stats.get(b.id!);
        if (sort === "lifetime") return (sb?.lifetimeValue ?? 0) - (sa?.lifetimeValue ?? 0);
        if (sort === "last") {
          const la = sa?.lastOrderAt?.getTime() ?? 0;
          const lb = sb?.lastOrderAt?.getTime() ?? 0;
          return lb - la;
        }
        return a.companyName.localeCompare(b.companyName);
      });
  }, [customers, search, showArchived, selectedTag, sort, stats]);

  const activeCount = customers.filter((c) => !c.archived).length;
  const archivedCount = customers.length - activeCount;

  async function handleCreate() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await saveCustomer({
        companyName: newName.trim(),
        contactName: newContact.trim() || undefined,
        tags: [],
      });
      toast.success(`Created ${newName.trim()}`);
      setNewName("");
      setNewContact("");
      setCreating(false);
    } catch (e) {
      toast.error("Save failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Customers"
        meta={`B2B contacts, order history, follow-ups · ${activeCount} active${archivedCount > 0 ? ` · ${archivedCount} archived` : ""}`}
        actions={
          <DsButton variant="primary" size="md" onClick={() => setCreating(true)}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconPlus size={14} stroke={1.5} /> New customer
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
              placeholder="Search company, contact, email, tag…"
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
            <DsTabNav
              variant="pills"
              tabs={[
                { id: "", label: "All tags" },
                ...allTags.map((t) => ({ id: t, label: t })),
              ]}
              activeTab={selectedTag}
              onChange={(id) => setSelectedTag(id)}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <DsTabNav
              variant="pills"
              tabs={[
                { id: "name", label: "Name" },
                { id: "lifetime", label: "Lifetime value" },
                { id: "last", label: "Last order" },
              ]}
              activeTab={sort}
              onChange={(id) => setSort(id as Sort)}
            />
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 10px",
                fontSize: 11,
                border: `0.5px solid ${showArchived ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
                background: showArchived ? "var(--ds-tint-info)" : "var(--ds-card-bg)",
                color: showArchived ? "var(--ds-tier-quarter-focus)" : "var(--ds-text-muted)",
                borderRadius: 12,
                cursor: "pointer",
                marginLeft: "auto",
              }}
            >
              <IconArchive size={11} stroke={1.5} /> {showArchived ? "Showing archived" : "Show archived"}
            </button>
          </div>
        </div>

        {creating && (
          <Section title="New customer">
            <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Company name"
                autoFocus
                style={textInputStyle()}
              />
              <input
                type="text"
                value={newContact}
                onChange={(e) => setNewContact(e.target.value)}
                placeholder="Contact name (optional)"
                style={textInputStyle()}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <DsButton
                  variant="default"
                  size="sm"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                    setNewContact("");
                  }}
                >
                  Cancel
                </DsButton>
                <DsButton
                  variant="primary"
                  size="sm"
                  onClick={handleCreate}
                  disabled={!newName.trim() || busy}
                >
                  {busy ? "Saving…" : "Create"}
                </DsButton>
              </div>
            </div>
          </Section>
        )}

        {rows.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            {customers.length === 0
              ? "No customers yet. Click New customer to start tracking orders + follow-ups."
              : "No customers match the current filters."}
          </p>
        ) : (
          <Section title="Customers" action={`${rows.length} of ${customers.length}`}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {rows.map((c) => {
                const s = stats.get(c.id!);
                const miss = computeMissingRequiredCustomerFields(c);
                return (
                  <li key={c.id} style={{ borderTop: "0.5px solid var(--ds-border-warm)" }}>
                    <Link
                      href={`/customers/${encodeURIComponent(c.id!)}`}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "12px 20px",
                        textDecoration: "none",
                        color: "inherit",
                        opacity: c.archived ? 0.6 : 1,
                      }}
                      className="hover:bg-[color:var(--ds-card-bg-hover)]"
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            flexWrap: "wrap",
                            fontSize: 13,
                            fontWeight: 500,
                          }}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.companyName}
                          </span>
                          {c.archived && (
                            <span style={{ fontSize: 9, color: "var(--ds-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                              archived
                            </span>
                          )}
                          {miss.length > 0 && (
                            <span
                              title={`Missing: ${miss.join(", ")}`}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 2,
                                fontSize: 10,
                                color: "var(--ds-semantic-warn)",
                              }}
                            >
                              <IconAlertTriangle size={11} stroke={1.5} />
                              {miss.length}
                            </span>
                          )}
                          {c.tags?.map((t) => (
                            <StatusTag key={t} kind="neutral">{t}</StatusTag>
                          ))}
                        </div>
                        <p
                          style={{
                            fontSize: 11,
                            color: "var(--ds-text-muted)",
                            marginTop: 4,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {c.contactName && <>{c.contactName}</>}
                          {c.contactName && c.email && <> · </>}
                          {c.email}
                        </p>
                      </div>
                      <div
                        style={{
                          textAlign: "right",
                          fontSize: 11,
                          color: "var(--ds-text-muted)",
                          flexShrink: 0,
                        }}
                      >
                        {s && s.orderCount > 0 ? (
                          <>
                            <p style={{ fontWeight: 500, color: "var(--ds-text-primary)", fontVariantNumeric: "tabular-nums" }}>
                              {s.orderCount} order{s.orderCount === 1 ? "" : "s"}
                            </p>
                            <p style={{ fontVariantNumeric: "tabular-nums" }}>€{s.lifetimeValue.toFixed(2)}</p>
                            {s.daysSinceLastOrder != null && (
                              <p>last {s.daysSinceLastOrder === 0 ? "today" : `${s.daysSinceLastOrder}d ago`}</p>
                            )}
                          </>
                        ) : (
                          <p style={{ fontStyle: "italic" }}>no orders yet</p>
                        )}
                      </div>
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

function textInputStyle(): React.CSSProperties {
  return {
    padding: "5px 8px",
    fontSize: 13,
    border: "0.5px solid var(--ds-border-warm)",
    borderRadius: 4,
    background: "var(--ds-card-bg)",
    color: "var(--ds-text-primary)",
    outline: "none",
  };
}
