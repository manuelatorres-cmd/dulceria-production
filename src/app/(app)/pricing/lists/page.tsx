"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { usePriceLists, savePriceList, useCustomers } from "@/lib/hooks";
import { newId } from "@/lib/supabase";

/**
 * B2B price lists — list view.
 *
 * Each list is a named set of rules (product/collection/tag overrides)
 * that customers can be assigned to via customers.defaultPriceListId.
 * Create, rename, archive from here; drill into detail to manage rules.
 */
export default function PriceListsPage() {
  const lists = usePriceLists(true);
  const customers = useCustomers();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

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
      await savePriceList({
        id,
        name: "New price list",
        archived: false,
      });
      router.push(`/pricing/lists/${encodeURIComponent(id)}?new=1`);
    } finally {
      setCreating(false);
    }
  }

  const active = lists.filter((l) => !l.archived);
  const archived = lists.filter((l) => l.archived);

  return (
    <div>
      <PageHeader
        title="Price lists"
        accent="Pricing"
        description="Named B2B price lists. Assign one per customer; each list can override retail prices by product, collection, or tag."
      />

      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={handleAdd}
          disabled={creating}
          className="btn-primary"
        >
          {creating ? "Creating…" : "+ New price list"}
        </button>
      </div>

      {lists.length === 0 ? (
        <p
          className="text-muted-foreground italic text-center py-12 text-[13px]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          No price lists yet. Tap "New price list" to start.
        </p>
      ) : null}

      {active.length > 0 ? (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {active.map((l) => (
            <PriceListCard
              key={l.id}
              list={l}
              customers={customerCounts.get(l.id ?? "") ?? 0}
            />
          ))}
        </ul>
      ) : null}

      {archived.length > 0 ? (
        <section>
          <h3
            className="text-[10px] uppercase text-muted-foreground font-medium mb-2"
            style={{ letterSpacing: "0.12em" }}
          >
            Archived
          </h3>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {archived.map((l) => (
              <PriceListCard
                key={l.id}
                list={l}
                customers={customerCounts.get(l.id ?? "") ?? 0}
              />
            ))}
          </ul>
        </section>
      ) : null}
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
        className={
          "block border border-border bg-card p-4 transition-colors " +
          (list.archived
            ? "opacity-70 hover:opacity-100"
            : "hover:border-foreground")
        }
        style={{ borderRadius: 4 }}
      >
        <div
          className="text-[14.5px] mb-1"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          {list.name}
        </div>
        {list.description ? (
          <p className="text-[12px] text-muted-foreground mb-2 line-clamp-2">
            {list.description}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-3 text-[10.5px] text-muted-foreground uppercase" style={{ letterSpacing: "0.1em" }}>
          {list.defaultDiscountPercent !== undefined ? (
            <span>Blanket −{list.defaultDiscountPercent}%</span>
          ) : null}
          {list.validFrom ? <span>From {list.validFrom}</span> : null}
          {list.validTo ? <span>Until {list.validTo}</span> : null}
          <span>{customers} customer{customers === 1 ? "" : "s"}</span>
        </div>
      </Link>
    </li>
  );
}

