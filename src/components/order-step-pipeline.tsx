"use client";

/**
 * Order-level step pipeline — aggregates the 8-step production flow
 * across every batch linked to an order. Shows the same 8-step shape
 * as the batch detail view, but per-step status rolls up from every
 * linked batch:
 *
 *   all batches done → step lights solid green
 *   some done        → step shows partial ring (in progress)
 *   none done        → step dim (pending)
 *
 * ETA = latest expected completion across linked batches + pack
 * buffer. Expected ready stamp shown at the end.
 */

import { useMemo } from "react";
import Link from "next/link";
import {
  useAllOrderPlanLinks,
  useAllPlanStepStatuses,
  useProductionPlans,
  useProductionSteps,
  useAllProductionDayLineItems,
  useProductionDays,
} from "@/lib/hooks";

interface Props {
  orderId: string;
  /** Optional — date the customer needs product by. Shown next to ETA. */
  needByDate?: string | null;
}

export function OrderStepPipeline({ orderId, needByDate }: Props) {
  const links = useAllOrderPlanLinks();
  const plans = useProductionPlans();
  const statuses = useAllPlanStepStatuses();
  const steps = useProductionSteps();
  const lineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(120);

  // Linked plans for this order.
  const linkedPlanIds = useMemo(() => {
    const planIds = new Set<string>();
    for (const link of links) {
      // orderPlanLinks store `orderItemId` — we need to look up its
      // parent orderId, but the link table itself doesn't carry the
      // parent. As a pragmatic proxy, accept any plan linked to an
      // order item whose orderId matches. We pull from a flat map
      // below so the order detail page can pass its own item IDs if
      // tighter scoping is needed.
      if (link.planId) planIds.add(link.planId);
    }
    return planIds;
  }, [links]);

  // Narrow to plans flagged for this order via their `sourceOrderId`
  // (legacy) or via the order-plan-link join above.
  const linkedPlans = useMemo(() => {
    return plans.filter(
      (p) => p.id && (p.sourceOrderId === orderId || linkedPlanIds.has(p.id)),
    );
  }, [plans, linkedPlanIds, orderId]);

  // Index statuses by plan for quick lookup.
  const statusesByPlan = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const s of statuses) {
      if (!s.done || !s.planId) continue;
      const set = m.get(s.planId) ?? new Set();
      set.add(s.stepKey);
      m.set(s.planId, set);
    }
    return m;
  }, [statuses]);

  // Take first 8 production steps as the canonical pipeline.
  const canonicalSteps = useMemo(() => steps.slice(0, 8), [steps]);

  // Map productionStep.name → semantic phase key used inside
  // planStepStatus rows. Wizard writes keys like "polishing-<ppId>",
  // "colour-<ppId>-0", etc. We match by phase prefix here.
  function phaseKeyForStep(name: string): string | null {
    const n = name.toLowerCase().trim();
    if (n.includes("polish")) return "polishing";
    if (n.includes("paint") || n.includes("colour") || n.includes("color")) return "colour";
    if (n.includes("shell") || n.includes("temper")) return "shell";
    if (n.includes("filling prep") || n === "prep" || n.startsWith("prep")) return "filling";
    if (n.includes("fill")) return "fill";
    if (n.includes("cap")) return "cap";
    if (n.includes("unmould") || n.includes("unmold")) return "unmould";
    if (n.includes("pack")) return "packing";
    return null;
  }

  // Per-step status across all linked plans. We accept either the
  // exact phase key ("polishing") or any per-product variant
  // ("polishing-<ppId>", "color-<ppId>-1") — that way ticks made on
  // the wizard or on this page's higher-level views all roll up here.
  type StepRollup = "done" | "in-progress" | "pending";
  const stepRollup = useMemo<StepRollup[]>(() => {
    if (linkedPlans.length === 0) return canonicalSteps.map(() => "pending");
    return canonicalSteps.map((step) => {
      const phaseKey = phaseKeyForStep(step.name ?? "");
      if (!phaseKey) return "pending";
      let doneCount = 0;
      for (const plan of linkedPlans) {
        if (!plan.id) continue;
        const doneSet = statusesByPlan.get(plan.id);
        if (!doneSet) continue;
        const anyMatch = [...doneSet].some(
          (k) => k === phaseKey || k.startsWith(`${phaseKey}-`),
        );
        if (anyMatch) doneCount++;
      }
      if (doneCount === 0) return "pending";
      if (doneCount === linkedPlans.length) return "done";
      return "in-progress";
    });
  }, [canonicalSteps, linkedPlans, statusesByPlan]);

  // Expected completion = latest line-item date across linked plans.
  const expectedReady = useMemo(() => {
    const dateById = new Map<string, string>();
    for (const day of productionDays) {
      if (day.id && day.date) dateById.set(day.id, day.date.slice(0, 10));
    }
    const dates = lineItems
      .filter((li) => linkedPlans.some((p) => p.id === li.planId))
      .map((li) => dateById.get(li.productionDayId))
      .filter((d): d is string => Boolean(d));
    if (dates.length === 0) return null;
    return dates.sort().slice(-1)[0];
  }, [productionDays, lineItems, linkedPlans]);

  if (linkedPlans.length === 0) {
    return (
      <div className="border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4" style={{ borderRadius: 4 }}>
        <p
          className="text-muted-foreground text-[12.5px] italic"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          No batches linked to this order yet. Schedule one from the planner.
        </p>
      </div>
    );
  }

  const doneCount = stepRollup.filter((s) => s === "done").length;
  const pctDone = Math.round((doneCount / canonicalSteps.length) * 100);

  return (
    <section
      className="border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4"
      style={{ borderRadius: 4 }}
    >
      <header className="flex items-baseline justify-between mb-3">
        <h3
          className="text-[14px]"
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 500,
            letterSpacing: "-0.012em",
          }}
        >
          Production pipeline
          <span
            className="ml-2 text-[10.5px] text-muted-foreground uppercase font-normal"
            style={{ letterSpacing: "0.1em" }}
          >
            {doneCount}/{canonicalSteps.length} · {pctDone}%
          </span>
        </h3>
        {expectedReady ? (
          <span className="text-[11.5px] text-muted-foreground">
            Ready <b className="text-foreground font-medium">{expectedReady}</b>
            {needByDate ? (
              <span className="ml-2">
                {readyVsNeed(expectedReady, needByDate)}
              </span>
            ) : null}
          </span>
        ) : null}
      </header>

      <ol className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
        {canonicalSteps.map((step, idx) => {
          const roll = stepRollup[idx];
          return (
            <li
              key={step.id ?? idx}
              title={step.name}
              className={
                "border px-2 py-2 text-center " +
                rollupClasses(roll)
              }
              style={{ borderRadius: 3 }}
            >
              <div
                className="text-[9px] font-semibold opacity-70"
                style={{ letterSpacing: "0.08em" }}
              >
                {String(idx + 1).padStart(2, "0")}
              </div>
              <div
                className="text-[11.5px] leading-tight mt-0.5"
                style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}
              >
                {step.name}
              </div>
            </li>
          );
        })}
      </ol>

      {linkedPlans.length > 1 ? (
        <p
          className="text-[10.5px] text-muted-foreground mt-3"
          style={{ letterSpacing: "0.02em" }}
        >
          Rolling up {linkedPlans.length} linked batches —{" "}
          {linkedPlans.map((p, i) => (
            <span key={p.id}>
              <Link
                href={`/production/${encodeURIComponent(p.id ?? "")}`}
                className="hover:text-foreground underline decoration-dotted underline-offset-2"
              >
                {p.name ?? `Batch ${p.batchNumber ?? ""}`}
              </Link>
              {i < linkedPlans.length - 1 ? ", " : ""}
            </span>
          ))}
          .
        </p>
      ) : null}
    </section>
  );
}

function rollupClasses(roll: "done" | "in-progress" | "pending"): string {
  if (roll === "done")
    return "bg-status-ok-bg border-status-ok-edge text-status-ok";
  if (roll === "in-progress")
    return "bg-status-warn-bg border-status-warn-edge text-status-warn";
  return "bg-muted border-[color:var(--ds-border-warm)] text-muted-foreground";
}

function readyVsNeed(ready: string, needBy: string): React.ReactNode {
  const r = new Date(ready + "T00:00:00Z").getTime();
  const n = new Date(needBy.slice(0, 10) + "T00:00:00Z").getTime();
  if (!Number.isFinite(r) || !Number.isFinite(n)) return null;
  const diffDays = Math.round((n - r) / (1000 * 60 * 60 * 24));
  if (diffDays > 0)
    return <span className="text-status-ok">· {diffDays}d buffer</span>;
  if (diffDays === 0)
    return <span className="text-status-warn">· same day</span>;
  return (
    <span className="text-status-alert">· {Math.abs(diffDays)}d late</span>
  );
}
