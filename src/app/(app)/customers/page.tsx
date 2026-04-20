"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import {
  useCustomers, saveCustomer, useOrders, useAllOrderItems,
} from "@/lib/hooks";
import { computeCustomerAnalytics } from "@/lib/customerAnalytics";
import { Plus, Search, X, Archive } from "lucide-react";

export default function CustomersPage() {
  const customers = useCustomers(true);
  const orders = useOrders();
  const orderItems = useAllOrderItems();

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [sortKey, setSortKey] = useState<"name" | "lifetime" | "last">("name");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [busy, setBusy] = useState(false);

  // Pre-compute analytics once so we can sort / filter on them.
  const stats = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeCustomerAnalytics>>();
    for (const c of customers) {
      if (!c.id) continue;
      map.set(
        c.id,
        computeCustomerAnalytics({
          customerId: c.id,
          orders,
          orderItems,
        }),
      );
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
      .filter((c) => showArchived ? true : !c.archived)
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
        if (sortKey === "lifetime") return (sb?.lifetimeValue ?? 0) - (sa?.lifetimeValue ?? 0);
        if (sortKey === "last") {
          const la = sa?.lastOrderAt?.getTime() ?? 0;
          const lb = sb?.lastOrderAt?.getTime() ?? 0;
          return lb - la;
        }
        return a.companyName.localeCompare(b.companyName);
      });
  }, [customers, search, showArchived, selectedTag, sortKey, stats]);

  async function handleCreate() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await saveCustomer({
        companyName: newName.trim(),
        contactName: newContact.trim() || undefined,
        tags: [],
      });
      setNewName("");
      setNewContact("");
      setCreating(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Customers" description="B2B contacts, order history, follow-ups" />
      <div className="px-4 pb-8 space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 relative min-w-0">
            <Search aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by company, contact, email, tag…"
              aria-label="Search customers"
              className="input !pl-9"
            />
          </div>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New customer
          </button>
        </div>

        {creating && (
          <div className="rounded-lg border border-border bg-card p-3 space-y-2">
            <p className="text-xs font-medium text-muted-foreground">New customer</p>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Company name"
              className="input text-sm"
              autoFocus
            />
            <input
              type="text"
              value={newContact}
              onChange={(e) => setNewContact(e.target.value)}
              placeholder="Contact name (optional)"
              className="input text-sm"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setCreating(false); setNewName(""); setNewContact(""); }} className="text-xs text-muted-foreground">Cancel</button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || busy}
                className="rounded-full bg-accent text-accent-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                {busy ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          {allTags.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {allTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setSelectedTag(selectedTag === t ? "" : t)}
                  className={`rounded-full border px-2 py-0.5 ${
                    selectedTag === t
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
              {selectedTag && (
                <button onClick={() => setSelectedTag("")} className="text-muted-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          <div className="ml-auto flex items-center gap-1">
            <span className="text-muted-foreground">Sort:</span>
            {(["name", "lifetime", "last"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setSortKey(k)}
                className={`rounded-full px-2 py-0.5 ${
                  sortKey === k ? "bg-accent text-accent-foreground" : "border border-border text-muted-foreground"
                }`}
              >
                {k === "name" ? "Name" : k === "lifetime" ? "Lifetime value" : "Last order"}
              </button>
            ))}
            <button
              onClick={() => setShowArchived((v) => !v)}
              className={`ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 border ${
                showArchived ? "border-primary text-primary" : "border-border text-muted-foreground"
              }`}
            >
              <Archive className="w-3 h-3" /> {showArchived ? "Showing archived" : "Show archived"}
            </button>
          </div>
        </div>

        {/* List */}
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {customers.length === 0
                ? "No customers yet. Create the first one to start tracking orders and follow-ups."
                : "No customers match the current filters."}
            </p>
          </div>
        ) : (
          <ul className="rounded-lg border border-border bg-card divide-y divide-border">
            {rows.map((c) => {
              const s = stats.get(c.id!);
              return (
                <li key={c.id}>
                  <Link
                    href={`/customers/${encodeURIComponent(c.id!)}`}
                    className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/30"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-medium truncate">
                          {c.companyName}
                          {c.archived && <span className="ml-1.5 text-[10px] text-muted-foreground uppercase">archived</span>}
                        </p>
                        {c.tags?.map((t) => (
                          <span key={t} className="rounded-full border border-border px-1.5 py-0 text-[10px] text-muted-foreground">
                            {t}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.contactName && <>{c.contactName}</>}
                        {c.contactName && c.email && <> · </>}
                        {c.email}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground shrink-0">
                      {s && s.orderCount > 0 ? (
                        <>
                          <p className="font-medium text-foreground tabular-nums">
                            {s.orderCount} order{s.orderCount === 1 ? "" : "s"}
                          </p>
                          <p className="tabular-nums">€{s.lifetimeValue.toFixed(2)}</p>
                          {s.daysSinceLastOrder != null && (
                            <p>
                              last {s.daysSinceLastOrder === 0 ? "today" : `${s.daysSinceLastOrder}d ago`}
                            </p>
                          )}
                        </>
                      ) : (
                        <p>no orders yet</p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
