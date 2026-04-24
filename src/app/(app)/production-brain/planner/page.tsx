"use client";

import { useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useReplenishmentProposals,
  useCampaigns,
  useProductionPlans,
  useProductsList,
  useAllProductionDayLineItems,
  useProductionDays,
} from "@/lib/hooks";

/**
 * Production Brain · Planner (phase 1 scaffold)
 *
 * Month calendar + replenishment-proposal sidebar. Drag-drop wiring
 * lands in the next commit; this commit gives the layout, tab nav,
 * and live data plumbing so we can swap mock blocks for real ones
 * one at a time.
 */
export default function ProductionBrainPlannerPage() {
  const proposals = useReplenishmentProposals(["pending"]);
  const campaigns = useCampaigns(["active", "planned"]);
  const plans = useProductionPlans();
  const products = useProductsList();
  const lineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(60);

  const productsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.id) m.set(p.id, p.name);
    return m;
  }, [products]);

  /** Map productionDayId → ISO 'YYYY-MM-DD' date string. */
  const productionDayDateById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) {
      if (d.id && d.date) m.set(d.id, d.date.slice(0, 10));
    }
    return m;
  }, [productionDays]);

  /** Map ISO date → list of plan IDs scheduled on that date. */
  const planIdsByDate = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const li of lineItems) {
      const date = productionDayDateById.get(li.productionDayId);
      if (!date) continue;
      const list = m.get(date) ?? [];
      list.push(li.planId);
      m.set(date, list);
    }
    return m;
  }, [lineItems, productionDayDateById]);

  const planById = useMemo(() => {
    const m = new Map<string, (typeof plans)[number]>();
    for (const p of plans) if (p.id) m.set(p.id, p);
    return m;
  }, [plans]);

  const weeks = useMemo(() => buildMonthGrid(new Date()), []);

  return (
    <div>
      <PageHeader
        title="Planner"
        description="Drag replenishment proposals and orders onto the month calendar. Capacity heatmap shows daily load. Drag-drop UI lands in the next phase-1 commit."
      />

      {/* Campaign strip */}
      {campaigns.length > 0 ? (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {campaigns.map((c) => (
            <div
              key={c.id}
              className="rounded-sm border border-border bg-card p-3 text-sm"
            >
              <div className="flex items-center justify-between">
                <strong className="tracking-tight">{c.name}</strong>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {c.status}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {c.startDate} → {c.endDate}
                {c.targetTotalUnits ? ` · ${c.targetTotalUnits} target` : ""}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4">
        {/* Calendar */}
        <section className="rounded-sm border border-border bg-card p-4">
          <header className="flex items-center justify-between mb-3">
            <h3 className="uppercase tracking-wider text-[10px] text-muted-foreground font-semibold">
              Month view
            </h3>
            <p className="text-xs text-muted-foreground">
              {plans.length} batches scheduled across the month
            </p>
          </header>
          <div className="grid grid-cols-5 gap-1.5 text-xs">
            {["Mon", "Tue", "Wed", "Thu", "Fri"].map((label) => (
              <div
                key={label}
                className="text-center text-[10px] uppercase tracking-wider text-muted-foreground py-1"
              >
                {label}
              </div>
            ))}
            {weeks.flatMap((week, wi) =>
              week.map((day, di) => {
                const inMonth = day.inMonth;
                const planIdsForDay = planIdsByDate.get(day.iso) ?? [];
                const dayPlans = Array.from(new Set(planIdsForDay))
                  .map((id) => planById.get(id))
                  .filter((p): p is NonNullable<typeof p> => Boolean(p));
                return (
                  <div
                    key={`${wi}-${di}`}
                    className={
                      "min-h-[96px] rounded-sm border p-1.5 " +
                      (inMonth
                        ? "bg-muted border-border"
                        : "bg-card border-border opacity-40")
                    }
                  >
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span className={inMonth ? "text-foreground font-medium" : ""}>
                        {day.day}
                      </span>
                      {dayPlans.length > 0 ? (
                        <span>{dayPlans.length}</span>
                      ) : null}
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {dayPlans.slice(0, 3).map((plan) => (
                        <li
                          key={plan.id}
                          className="rounded px-1.5 py-0.5 text-[10px] truncate bg-card border border-border"
                          title={plan.name ?? ""}
                        >
                          {plan.name ?? `Batch ${plan.batchNumber ?? ""}`}
                        </li>
                      ))}
                      {dayPlans.length > 3 ? (
                        <li className="text-[10px] text-muted-foreground">
                          +{dayPlans.length - 3} more
                        </li>
                      ) : null}
                    </ul>
                  </div>
                );
              }),
            )}
          </div>
        </section>

        {/* Sidebar — replenishment proposals */}
        <aside className="rounded-sm border border-border bg-card p-3">
          <h3 className="uppercase tracking-wider text-[10px] text-muted-foreground font-semibold mb-3">
            Proposals · {proposals.length}
          </h3>
          {proposals.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Engine quiet. Run the replenishment engine job to populate
              proposals (or create one manually).
            </p>
          ) : (
            <ul className="space-y-1.5">
              {proposals.map((p) => (
                <li
                  key={p.id}
                  className="rounded-md border border-border bg-muted px-2 py-1.5 text-xs flex flex-col gap-0.5"
                >
                  <strong className="text-foreground">
                    {productsById.get(p.productId) ?? p.productId.slice(0, 8)}
                  </strong>
                  <span className="text-muted-foreground text-[10px]">
                    Tier {p.priorityTier} · {p.suggestedBatchSize} pcs
                  </span>
                  <span className="text-muted-foreground text-[10px]">
                    needed {p.earliestNeededDate}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

interface DayCell {
  iso: string;
  day: number;
  inMonth: boolean;
}

/** Build a 4-week × 5-workday grid centred on the given month.
 *  Skips Sat/Sun for compactness — workshop is closed weekends. */
function buildMonthGrid(anchor: Date): DayCell[][] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  // Start from the Monday of the first week of the month.
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const firstDow = firstOfMonth.getUTCDay(); // 0 = Sun
  const offsetToMon = (firstDow + 6) % 7;
  const cursor = new Date(firstOfMonth);
  cursor.setUTCDate(cursor.getUTCDate() - offsetToMon);
  const weeks: DayCell[][] = [];
  for (let w = 0; w < 4; w++) {
    const week: DayCell[] = [];
    for (let d = 0; d < 5; d++) {
      const iso = cursor.toISOString().slice(0, 10);
      week.push({
        iso,
        day: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    // Skip Sat + Sun.
    cursor.setUTCDate(cursor.getUTCDate() + 2);
    weeks.push(week);
  }
  return weeks;
}
