"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { IconPlus as Plus, IconCalendar as CalIcon } from "@tabler/icons-react";
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

/**
 * Production orders — internal demand sibling of customer orders.
 * Workshop drives these (restocking minimums, market events, campaign
 * runs, launches). Brain reads them alongside customer orders.
 */
export default function ProductionOrdersPage() {
  const orders = useProductionOrders();
  const items = useAllProductionOrderItems();
  const products = useProductsList();
  const campaigns = useCampaigns();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

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

  const sorted = [...orders].sort((a, b) => a.dueDate.localeCompare(b.dueDate));

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

  const statusGroups: Record<ProductionOrderStatus, typeof sorted> = {
    pending: [],
    in_production: [],
    done: [],
    cancelled: [],
  };
  for (const o of sorted) statusGroups[o.status].push(o);

  return (
    <div className="px-6 sm:px-10 pt-8 pb-12 max-w-[1400px] mx-auto">
      <div className="flex flex-wrap items-baseline gap-3 mb-4">
        <h1
          className="text-[26px] tracking-[-0.025em]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400 }}
        >
          Production orders
        </h1>
        <span className="text-[12px] text-muted-foreground">
          Internal demand · {orders.length} total
        </span>
        <button
          onClick={handleNew}
          disabled={busy}
          className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1 text-[12px] font-medium disabled:opacity-50"
        >
          <Plus className="w-3 h-3" /> {busy ? "Creating…" : "New production order"}
        </button>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-border bg-card/60 px-6 py-12 text-center">
          <CalIcon className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            No production orders yet. Create one for restocking or to drive a campaign run.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {PRODUCTION_ORDER_STATUSES.map((status) => {
            const list = statusGroups[status];
            if (list.length === 0) return null;
            return (
              <section key={status}>
                <h2
                  className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground font-semibold mb-2"
                >
                  {status.replace("_", " ")} · {list.length}
                </h2>
                <ul className="space-y-1.5">
                  {list.map((o) => {
                    const itemList = itemsByOrder.get(o.id!) ?? [];
                    const totalUnits = itemList.reduce((s, i) => s + i.targetUnits, 0);
                    const productNames = itemList
                      .slice(0, 3)
                      .map((i) => productMap.get(i.productId)?.name ?? "—")
                      .join(", ");
                    const moreCount = Math.max(0, itemList.length - 3);
                    const camp = o.campaignId ? campaignMap.get(o.campaignId) : null;
                    return (
                      <li key={o.id}>
                        <Link
                          href={`/production-orders/${encodeURIComponent(o.id!)}`}
                          className="flex items-center gap-3 rounded-[14px] border border-border bg-card/80 px-4 py-3 hover:border-foreground/30"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-medium truncate">
                              {o.name || "Untitled"}
                              <span className="ml-2 text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-normal">
                                {o.channel === "restock" ? "Restock" : "Campaign run"}
                              </span>
                              {o.targetLocation && (
                                <span className="ml-2 text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-normal">
                                  → {o.targetLocation}
                                </span>
                              )}
                              {camp && (
                                <span className="ml-2 text-[10px] uppercase tracking-[0.06em] text-[var(--accent-lilac-ink)] font-normal">
                                  · {camp.name}
                                </span>
                              )}
                            </p>
                            <p className="text-[11.5px] text-muted-foreground truncate">
                              {totalUnits > 0 ? `${totalUnits} pcs` : "no items yet"}
                              {productNames && ` · ${productNames}`}
                              {moreCount > 0 && ` · +${moreCount} more`}
                            </p>
                          </div>
                          <span className="text-[11px] tabular-nums text-muted-foreground shrink-0">
                            {o.dueDate}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
