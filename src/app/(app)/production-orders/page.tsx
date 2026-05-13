"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconPlus, IconCalendar, IconSearch } from "@tabler/icons-react";
import {
  useProductionOrders,
  useAllProductionOrderItems,
  useProductsList,
  useCampaigns,
  saveProductionOrder,
} from "@/lib/hooks";
import {
  PRODUCTION_ORDER_STATUSES,
  type ProductionOrderChannel,
  type ProductionOrderStatus,
} from "@/types";
import { newId } from "@/lib/supabase";
import {
  PageHeader,
  Section,
  ListRow,
  StatusTag,
  DsButton,
  DsTabNav,
  type ListRowTier,
} from "@/components/dulceria";
import { usePersistedFilters } from "@/lib/use-persisted-filters";

type StatusFilter = "all" | ProductionOrderStatus;

const STATUS_LABEL: Record<ProductionOrderStatus, string> = {
  pending: "Pending",
  in_production: "In production",
  done: "Done",
  cancelled: "Cancelled",
};

type DueTone = "urgent" | "warn" | "default";

function relativeDate(iso: string, today: number): { label: string; tone: DueTone } {
  const dueMs = new Date(iso + "T23:59:59").getTime();
  const days = Math.ceil((dueMs - today) / 86_400_000);
  if (days < 0) return { label: `overdue ${Math.abs(days)}d`, tone: "urgent" };
  if (days === 0) return { label: "today", tone: "urgent" };
  if (days === 1) return { label: "tomorrow", tone: "warn" };
  if (days <= 3) return { label: `in ${days}d`, tone: "warn" };
  if (days <= 14) return { label: `in ${days}d`, tone: "default" };
  return { label: iso, tone: "default" };
}

function tierFromTone(tone: DueTone, status: ProductionOrderStatus): ListRowTier {
  if (status === "done") return "done";
  if (status === "cancelled") return "parked";
  if (tone === "urgent") return "urgent";
  if (tone === "warn") return "active";
  return "default";
}

export default function ProductionOrdersPage() {
  const router = useRouter();
  const orders = useProductionOrders();
  const items = useAllProductionOrderItems();
  const products = useProductsList();
  const campaigns = useCampaigns();
  const [busy, setBusy] = useState(false);

  const [f, setF] = usePersistedFilters("production-orders-v2", {
    search: "",
    filterStatus: "all" as StatusFilter,
  });

  const productMap = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const campaignMap = useMemo(() => new Map(campaigns.map((c) => [c.id!, c])), [campaigns]);

  const itemsByOrder = useMemo(() => {
    const m = new Map<string, typeof items>();
    for (const it of items) {
      const arr = m.get(it.productionOrderId) ?? [];
      arr.push(it);
      m.set(it.productionOrderId, arr);
    }
    return m;
  }, [items]);

  const todayMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const filtered = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    return orders.filter((o) => {
      if (q && !o.name?.toLowerCase().includes(q)) return false;
      if (f.filterStatus !== "all" && o.status !== f.filterStatus) return false;
      return true;
    });
  }, [orders, f.search, f.filterStatus]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [filtered],
  );

  const statusGroups = useMemo(() => {
    const g: Record<ProductionOrderStatus, typeof sorted> = {
      pending: [],
      in_production: [],
      done: [],
      cancelled: [],
    };
    for (const o of sorted) g[o.status].push(o);
    return g;
  }, [sorted]);

  const statusCounts = useMemo(() => {
    const c: Record<ProductionOrderStatus, number> = {
      pending: 0,
      in_production: 0,
      done: 0,
      cancelled: 0,
    };
    for (const o of orders) c[o.status]++;
    return c;
  }, [orders]);

  async function handleNew() {
    setBusy(true);
    try {
      const id = newId();
      await saveProductionOrder({
        id,
        name: "New production order",
        dueDate: new Date(Date.now() + 7 * 24 * 3600_000).toISOString().slice(0, 10),
        status: "pending" satisfies ProductionOrderStatus,
        channel: "restock" satisfies ProductionOrderChannel,
        campaignId: null,
        targetLocation: null,
        notes: null,
      });
      router.push(`/production-orders/${encodeURIComponent(id)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Production orders"
        meta={`Internal demand · ${orders.length} total${statusCounts.pending > 0 ? ` · ${statusCounts.pending} pending` : ""}${statusCounts.in_production > 0 ? ` · ${statusCounts.in_production} in production` : ""}`}
        actions={
          <DsButton variant="primary" size="md" onClick={handleNew} disabled={busy}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconPlus size={14} stroke={1.5} /> {busy ? "Creating…" : "New production order"}
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
              placeholder="Search production orders…"
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
              { id: "all", label: "All", count: orders.length },
              { id: "pending", label: "Pending", count: statusCounts.pending },
              { id: "in_production", label: "In production", count: statusCounts.in_production },
              { id: "done", label: "Done", count: statusCounts.done },
              { id: "cancelled", label: "Cancelled", count: statusCounts.cancelled },
            ]}
            activeTab={f.filterStatus}
            onChange={(id) => setF("filterStatus", id as StatusFilter)}
          />
        </div>

        {orders.length === 0 ? (
          <div
            style={{
              borderRadius: 14,
              border: "1px dashed var(--ds-border-warm)",
              background: "var(--ds-card-bg)",
              padding: "48px 24px",
              textAlign: "center",
            }}
          >
            <IconCalendar size={28} stroke={1.5} style={{ color: "var(--ds-text-muted)", margin: "0 auto 8px" }} />
            <p style={{ fontSize: 13, color: "var(--ds-text-muted)" }}>
              No production orders yet. Create one for restocking or to drive a campaign run.
            </p>
          </div>
        ) : sorted.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "32px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            No orders match the current filter.
          </p>
        ) : (
          PRODUCTION_ORDER_STATUSES.map((status) => {
            const list = statusGroups[status];
            if (list.length === 0) return null;
            return (
              <Section
                key={status}
                title={STATUS_LABEL[status]}
                action={`${list.length} order${list.length === 1 ? "" : "s"}`}
              >
                <ul
                  style={{
                    padding: "0 0 14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    listStyle: "none",
                    margin: 0,
                  }}
                >
                  {list.map((o) => {
                    const itemList = itemsByOrder.get(o.id!) ?? [];
                    const totalUnits = itemList.reduce((s, i) => s + i.targetUnits, 0);
                    const productNames = itemList
                      .slice(0, 3)
                      .map((i) => productMap.get(i.productId)?.name ?? "—")
                      .join(", ");
                    const moreCount = Math.max(0, itemList.length - 3);
                    const camp = o.campaignId ? campaignMap.get(o.campaignId) : null;
                    const dateMeta = relativeDate(o.dueDate, todayMs);
                    const tier = tierFromTone(dateMeta.tone, status);

                    return (
                      <li key={o.id} style={{ listStyle: "none" }}>
                        <Link
                          href={`/production-orders/${encodeURIComponent(o.id!)}`}
                          style={{ textDecoration: "none", color: "inherit", display: "block" }}
                        >
                          <ListRow
                            tier={tier}
                            title={
                              <span style={{ display: "inline-flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                                <span>{o.name || "Untitled"}</span>
                                <StatusTag kind="neutral">
                                  {o.channel === "restock" ? "Restock" : "Campaign run"}
                                </StatusTag>
                                {o.targetLocation && (
                                  <StatusTag kind="neutral">→ {o.targetLocation}</StatusTag>
                                )}
                              </span>
                            }
                            meta={
                              <span>
                                {totalUnits > 0 ? `${totalUnits} pcs` : "no items yet"}
                                {productNames && ` · ${productNames}`}
                                {moreCount > 0 && ` · +${moreCount} more`}
                                {camp && (
                                  <span style={{ marginLeft: 6, color: "var(--ds-tier-quarter-focus)" }}>
                                    · campaign: {camp.name}
                                  </span>
                                )}
                              </span>
                            }
                            side={
                              <span
                                style={{
                                  fontSize: 11,
                                  fontVariantNumeric: "tabular-nums",
                                  color:
                                    dateMeta.tone === "urgent"
                                      ? "var(--ds-tier-urgent)"
                                      : dateMeta.tone === "warn"
                                      ? "var(--ds-semantic-warn)"
                                      : "var(--ds-text-muted)",
                                  fontWeight: dateMeta.tone === "urgent" ? 600 : 400,
                                }}
                              >
                                {dateMeta.label}
                              </span>
                            }
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Section>
            );
          })
        )}
      </div>
    </div>
  );
}
