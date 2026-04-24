"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useProductionPlans,
  useAllPlanProducts,
  useProductsList,
  useAllPlanStepStatuses,
  useProductionSteps,
} from "@/lib/hooks";

/**
 * Production Brain · Daily view (phase 1 scaffold)
 *
 * Replaces the old `/production` index. Shows today's batches as
 * compact cards, click to expand the active batch with its 8-step
 * pipeline + tasks. Real step interaction stays on the existing
 * /production/[id] page until phase-1 wires the new flow.
 */
export default function ProductionBrainDailyPage() {
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const plans = useProductionPlans();
  const planProducts = useAllPlanProducts();
  const products = useProductsList();
  const stepStatuses = useAllPlanStepStatuses();
  const steps = useProductionSteps();

  const productsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.id) m.set(p.id, p.name);
    return m;
  }, [products]);

  const todayBatches = useMemo(() => {
    return plans
      .filter((p) => p.status === "active" || p.status === "draft")
      .slice(0, 12);
  }, [plans]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? todayBatches[0],
    [plans, selectedPlanId, todayBatches],
  );

  const selectedPlanProducts = useMemo(
    () => planProducts.filter((pp) => pp.planId === selectedPlan?.id),
    [planProducts, selectedPlan?.id],
  );

  const selectedSteps = useMemo(() => {
    return steps.slice(0, 8);
  }, [steps]);

  const selectedStepStatuses = useMemo(
    () => stepStatuses.filter((s) => s.planId === selectedPlan?.id),
    [stepStatuses, selectedPlan?.id],
  );

  return (
    <div>
      <PageHeader
        title={`Daily — ${new Date().toLocaleDateString(undefined, {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}`}
        description="Today's batches in execution order. Pick a batch to inspect its pipeline."
      />

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
        {/* LEFT — batch list */}
        <aside className="rounded-xl border border-border bg-card p-3">
          <h3 className="uppercase tracking-wider text-[10px] text-muted-foreground font-semibold mb-3">
            Batches today · {todayBatches.length}
          </h3>
          {todayBatches.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              No active or draft batches. Create one in the planner.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {todayBatches.map((plan) => {
                const isActive = (selectedPlan?.id ?? null) === plan.id;
                const planLines = planProducts.filter((pp) => pp.planId === plan.id);
                const lineSummary = planLines
                  .slice(0, 2)
                  .map(
                    (pp) =>
                      `${productsById.get(pp.productId) ?? "?"} ×${pp.quantity}`,
                  )
                  .join(", ");
                return (
                  <li key={plan.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id ?? null)}
                      className={
                        "w-full text-left rounded-md border px-2.5 py-2 text-xs transition-colors " +
                        (isActive
                          ? "border-foreground bg-card shadow-sm"
                          : "border-border bg-muted hover:bg-card")
                      }
                    >
                      <div className="font-medium">
                        {plan.name ?? `Batch ${plan.batchNumber ?? ""}`}
                      </div>
                      {lineSummary ? (
                        <div className="text-muted-foreground mt-0.5 truncate">
                          {lineSummary}
                          {planLines.length > 2 ? ` +${planLines.length - 2} more` : ""}
                        </div>
                      ) : null}
                      <div className="text-[10px] text-muted-foreground mt-1 capitalize">
                        {plan.status ?? "draft"}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* RIGHT — selected batch */}
        <main className="rounded-xl border border-border bg-card p-5">
          {!selectedPlan ? (
            <p className="text-sm text-muted-foreground italic">
              No batch selected. Pick one from the list.
            </p>
          ) : (
            <>
              <div className="flex items-baseline justify-between mb-1">
                <h2 className="text-xl font-semibold tracking-tight">
                  {selectedPlan.name ?? `Batch ${selectedPlan.batchNumber ?? ""}`}
                </h2>
                <span className="text-xs text-muted-foreground capitalize">
                  {selectedPlan.status ?? "draft"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mb-5">
                {selectedPlanProducts.length} product line(s) ·{" "}
                {selectedSteps.length} steps
              </p>

              {/* Step pipeline */}
              <ol className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-6">
                {selectedSteps.map((step, idx) => {
                  const status = selectedStepStatuses.find(
                    (s) => s.stepKey === step.id,
                  );
                  const done = status?.done ?? false;
                  return (
                    <li
                      key={step.id ?? idx}
                      className={
                        "rounded-lg border px-2 py-2 text-center text-xs " +
                        (done
                          ? "bg-status-ok-bg border-status-ok-edge text-status-ok"
                          : "bg-muted border-border")
                      }
                    >
                      <div className="text-[9px] font-semibold opacity-70">
                        {String(idx + 1).padStart(2, "0")}
                      </div>
                      <div className="font-medium">{step.name}</div>
                      <div className="text-[9px] opacity-70 mt-0.5">
                        {step.activeMinutes ?? 0}m
                      </div>
                    </li>
                  );
                })}
              </ol>

              {/* Lines */}
              <h3 className="uppercase tracking-wider text-[10px] text-muted-foreground font-semibold mb-2">
                Product lines
              </h3>
              {selectedPlanProducts.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No products on this batch yet.
                </p>
              ) : (
                <ul className="space-y-1">
                  {selectedPlanProducts.map((pp) => (
                    <li
                      key={pp.id}
                      className="rounded-md bg-muted border border-border px-2.5 py-1.5 text-xs flex items-center justify-between"
                    >
                      <span className="font-medium">
                        {productsById.get(pp.productId) ?? pp.productId.slice(0, 8)}
                      </span>
                      <span className="text-muted-foreground">qty {pp.quantity}</span>
                    </li>
                  ))}
                </ul>
              )}

              <p className="text-xs text-muted-foreground mt-6">
                The legacy <code>/production/{selectedPlan.id}</code> page is still
                where step actions are recorded. Phase-1 will land step
                interaction here in a follow-up commit.
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
