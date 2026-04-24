"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useSubscriptionTemplates,
  useSubscriptionRuns,
  saveSubscriptionTemplate,
} from "@/lib/hooks";
import { newId } from "@/lib/supabase";

/**
 * Subscription templates — one recurring box shape per template.
 * Runs (ship cycles) live on the detail page. Q4 rollout per
 * questionnaire, but the scaffolding lives here so you can set them
 * up at any point.
 */
export default function SubscriptionsPage() {
  const templates = useSubscriptionTemplates(true);
  const runs = useSubscriptionRuns();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const runsByTemplate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of runs) {
      m.set(r.templateId, (m.get(r.templateId) ?? 0) + 1);
    }
    return m;
  }, [runs]);

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
    <div>
      <PageHeader
        title="Subscriptions"
        accent="Customers"
        description="Recurring box templates. Each has its own cadence, packaging, and piece count. Create cycles (runs) on the detail page with ship date + subscriber count."
      />

      <div className="flex justify-end mb-4">
        <button
          type="button"
          onClick={handleAdd}
          disabled={creating}
          className="btn-primary"
        >
          {creating ? "Creating…" : "+ New subscription"}
        </button>
      </div>

      {templates.length === 0 ? (
        <p
          className="text-muted-foreground italic text-center py-12 text-[13px]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          No subscription templates yet. Tap "New subscription" to start.
        </p>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                href={`/subscriptions/${encodeURIComponent(t.id ?? "")}`}
                className={
                  "block border border-border bg-card p-4 transition-colors " +
                  (t.active
                    ? "hover:border-foreground"
                    : "opacity-60 hover:opacity-100")
                }
                style={{ borderRadius: 4 }}
              >
                <div className="flex items-baseline justify-between mb-1">
                  <strong
                    className="text-[14.5px]"
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.012em",
                    }}
                  >
                    {t.name}
                  </strong>
                  <span
                    className="text-[10px] uppercase text-muted-foreground"
                    style={{ letterSpacing: "0.12em" }}
                  >
                    {t.frequency}
                  </span>
                </div>
                <div className="text-[11.5px] text-muted-foreground">
                  {t.pieceCount} pcs per box ·{" "}
                  {runsByTemplate.get(t.id ?? "") ?? 0} cycles planned
                  {!t.active ? " · inactive" : ""}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
