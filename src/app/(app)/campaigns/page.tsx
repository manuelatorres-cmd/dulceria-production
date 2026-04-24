"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { useCampaigns, saveCampaign } from "@/lib/hooks";
import { newId } from "@/lib/supabase";

/**
 * Campaigns list — Easter, Mother's Day, limited editions, launches.
 * One card per campaign, grouped by status. Quick-add at the top
 * creates an empty campaign and navigates to its detail page.
 */
export default function CampaignsPage() {
  const campaigns = useCampaigns();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  async function handleAdd() {
    setCreating(true);
    try {
      const id = newId();
      await saveCampaign({
        id,
        name: "New campaign",
        type: "seasonal",
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10),
        productIds: [],
        status: "planned",
      });
      router.push(`/campaigns/${encodeURIComponent(id)}?new=1`);
    } finally {
      setCreating(false);
    }
  }

  const byStatus = {
    active: campaigns.filter((c) => c.status === "active"),
    planned: campaigns.filter((c) => c.status === "planned"),
    wrapping: campaigns.filter((c) => c.status === "wrapping"),
    done: campaigns.filter((c) => c.status === "done"),
    cancelled: campaigns.filter((c) => c.status === "cancelled"),
  };

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Seasonal boxes, limited editions, collaborations, and launches. The brain auto-proposes ramp-up batches between productionStartDate and startDate."
      />

      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={handleAdd}
          disabled={creating}
          className="btn-primary"
        >
          {creating ? "Creating…" : "+ New campaign"}
        </button>
      </div>

      {campaigns.length === 0 ? (
        <p
          className="text-muted-foreground text-center py-12 italic"
          style={{ fontFamily: "var(--font-serif)", fontSize: 13 }}
        >
          No campaigns yet. Tap "New campaign" to plan one.
        </p>
      ) : null}

      {(
        [
          ["active", "Active"],
          ["planned", "Planned"],
          ["wrapping", "Wrapping up"],
          ["done", "Done"],
          ["cancelled", "Cancelled"],
        ] as const
      ).map(([key, label]) => {
        const list = byStatus[key];
        if (list.length === 0) return null;
        return (
          <section key={key} className="mb-6">
            <h2
              className="text-[13px] mb-2"
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 500,
                letterSpacing: "-0.012em",
              }}
            >
              {label}
              <span
                className="ml-2 text-[10px] uppercase text-muted-foreground"
                style={{ letterSpacing: "0.12em" }}
              >
                {list.length}
              </span>
            </h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {list.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/campaigns/${encodeURIComponent(c.id ?? "")}`}
                    className="block border border-border bg-card p-4 hover:border-foreground transition-colors"
                    style={{ borderRadius: 4 }}
                  >
                    <div
                      className="text-[14px] mb-1"
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontWeight: 500,
                        letterSpacing: "-0.012em",
                      }}
                    >
                      {c.name}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {c.type} · {c.startDate} → {c.endDate}
                    </div>
                    {c.targetTotalUnits ? (
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Target {c.targetTotalUnits} units
                      </div>
                    ) : null}
                    <div className="text-[10px] text-muted-foreground mt-2 uppercase" style={{ letterSpacing: "0.12em" }}>
                      {c.productIds.length} product{c.productIds.length === 1 ? "" : "s"}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
