"use client";

/**
 * Workshop dashboard — operational reality.
 *
 * Spec: docs/UNSHIPPED_REDESIGNS_BATCH.md, Redesign 2.
 *
 * Layout:
 *   PageHeader (title + meta + attention badge + actions)
 *   NOW bar — full-width strip with 3 states (in_progress / idle / done)
 *   4 ZoneCard utilization strip (capacity / moulds / ingredients / ready)
 *   2-col body: left = active batches + drafts; right = mould occupancy
 *               + ready to pack + compliance
 *   Quick actions row
 *
 * Different from /dashboard (cross-business status) and /plan (planned
 * schedule). This is what's running NOW.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useProductionPlans,
  useOrders,
  useCampaigns,
  useProductsList,
  useAllPlanProducts,
  useAllProductionDayLineItems,
  useProductionDays,
  useProductionSteps,
  useAllPlanStepStatuses,
  useCapacityConfig,
  usePeople,
  usePersonUnavailability,
  useBlockedDays,
  useAllIngredientStock,
  useStockLocationMinimums,
  useProductLocationTotals,
  useTodayProductionDay,
  useEquipment,
  useMouldsList,
} from "@/lib/hooks";
import { effectiveDailyCapacityMinutes } from "@/lib/capacity";
import { phaseKeyFromStepName } from "@/lib/production";
import {
  PageHeader,
  ZoneCard,
  type ZoneVariant,
  ListRow,
  type ListRowTier,
  StatusTag,
  AttentionItem,
  type AttentionVariant,
  DsButton,
  Section,
} from "@/components/dulceria";
import {
  IconClipboardList,
  IconCalendar,
  IconBox,
  IconShoppingBag,
  IconPlus,
  IconPlayerPlay,
  IconCircleCheck,
  IconThermometer,
  IconBucketDroplet,
  IconClock,
} from "@tabler/icons-react";

function isoForDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatHours(min: number): string {
  if (min <= 0) return "0h";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function WorkshopPage() {
  const router = useRouter();
  const plans = useProductionPlans();
  const orders = useOrders();
  const campaigns = useCampaigns(["planned", "active"]);
  const products = useProductsList();
  const planProducts = useAllPlanProducts();
  const lineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(30);
  const productionSteps = useProductionSteps();
  const planStepStatuses = useAllPlanStepStatuses();
  const config = useCapacityConfig();
  const people = usePeople(false);
  const unavailability = usePersonUnavailability();
  const blockedDays = useBlockedDays();
  const ingredientStock = useAllIngredientStock();
  const stockLocationMinimums = useStockLocationMinimums();
  const productLocationTotals = useProductLocationTotals();
  const todayDay = useTodayProductionDay();
  const equipment = useEquipment(false);
  const moulds = useMouldsList(true);

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const todayIso = useMemo(() => isoForDate(now), [now]);

  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const mouldById = useMemo(() => new Map(moulds.map((m) => [m.id!, m])), [moulds]);
  const planById = useMemo(() => new Map(plans.map((p) => [p.id!, p])), [plans]);
  const planProductByPlan = useMemo(() => {
    const m = new Map<string, (typeof planProducts)[number]>();
    for (const pp of planProducts) if (!m.has(pp.planId)) m.set(pp.planId, pp);
    return m;
  }, [planProducts]);
  const stepById = useMemo(() => new Map(productionSteps.map((s) => [s.id!, s])), [productionSteps]);
  const productionDayDateById = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of productionDays) if (d.id && d.date) m.set(d.id, d.date.slice(0, 10));
    return m;
  }, [productionDays]);

  // ─── Today's pipeline phases ────────────────────────────────────
  const today = useMemo(() => {
    const todayLineItems = lineItems.filter(
      (li) => productionDayDateById.get(li.productionDayId) === todayIso,
    );
    interface PhaseSlot {
      key: string;
      name: string;
      sortOrder: number;
      planIds: Set<string>;
      productNames: Set<string>;
      doneMoulds: number;
      totalMoulds: number;
      activeMinutes: number;
      hasInProgress: boolean;
    }
    const byPhase = new Map<string, PhaseSlot>();
    for (const li of todayLineItems) {
      const plan = planById.get(li.planId);
      if (!plan) continue;
      if (plan.status === "cancelled") continue;
      const pp = planProductByPlan.get(li.planId);
      const product = pp ? productById.get(pp.productId) : undefined;
      const mouldCount = pp?.quantity ?? 0;
      const doneSet = new Set<string>();
      for (const s of planStepStatuses) {
        if (s.planId === li.planId && s.done) doneSet.add(s.stepKey);
      }
      for (const stepId of li.stepIds) {
        const step = stepById.get(stepId);
        if (!step) continue;
        const phaseKey = phaseKeyFromStepName(step.name) ?? step.name;
        const cur = byPhase.get(phaseKey) ?? {
          key: phaseKey,
          name: step.name,
          sortOrder: step.sortOrder ?? 9999,
          planIds: new Set<string>(),
          productNames: new Set<string>(),
          doneMoulds: 0,
          totalMoulds: 0,
          activeMinutes: 0,
          hasInProgress: false,
        };
        cur.planIds.add(li.planId);
        if (product?.name) cur.productNames.add(product.name);
        cur.totalMoulds += mouldCount;
        cur.activeMinutes += step.activeMinutes ?? 0;
        const isDone =
          doneSet.has(phaseKey) ||
          [...doneSet].some((k) => k.startsWith(`${phaseKey}-`));
        if (isDone) cur.doneMoulds += mouldCount;
        else cur.hasInProgress = true;
        if (step.sortOrder != null && step.sortOrder < cur.sortOrder)
          cur.sortOrder = step.sortOrder;
        byPhase.set(phaseKey, cur);
      }
    }
    const phases = Array.from(byPhase.values()).sort((a, b) => a.sortOrder - b.sortOrder);
    return { phases, todayLineItems };
  }, [
    lineItems,
    productionDayDateById,
    todayIso,
    planById,
    planProductByPlan,
    productById,
    planStepStatuses,
    stepById,
  ]);

  // ─── NOW bar state ──────────────────────────────────────────────
  const nowState = useMemo(() => {
    if (today.phases.length === 0) {
      return { kind: "no-plan" as const };
    }
    const active = today.phases.find((p) => p.totalMoulds > p.doneMoulds);
    if (!active) {
      const totalMins = today.phases.reduce((s, p) => s + p.activeMinutes, 0);
      const batchCount = new Set(today.phases.flatMap((p) => [...p.planIds])).size;
      return { kind: "done" as const, totalMins, batchCount };
    }
    return {
      kind: "in-progress" as const,
      stepName: active.name,
      productNames: Array.from(active.productNames),
      doneMoulds: active.doneMoulds,
      totalMoulds: active.totalMoulds,
      pct: active.totalMoulds > 0 ? Math.round((active.doneMoulds / active.totalMoulds) * 100) : 0,
    };
  }, [today.phases]);

  // ─── Utilization: capacity ──────────────────────────────────────
  const capacityCard = useMemo(() => {
    const todayMins = today.todayLineItems.reduce((s, li) => s + (li.plannedMinutes ?? 0), 0);
    const cap = effectiveDailyCapacityMinutes(
      new Date(todayIso + "T12:00:00"),
      config,
      people,
      unavailability,
      blockedDays,
    );
    const pct = cap > 0 ? Math.round((todayMins / cap) * 100) : 0;
    const slack = Math.max(0, cap - todayMins);
    return { used: todayMins, capacity: cap, pct, slack };
  }, [today.todayLineItems, todayIso, config, people, unavailability, blockedDays]);

  // ─── Utilization: moulds ────────────────────────────────────────
  const mouldsCard = useMemo(() => {
    const used = new Set<string>();
    for (const li of today.todayLineItems) {
      const pp = planProductByPlan.get(li.planId);
      if (pp?.mouldId) used.add(pp.mouldId);
    }
    const ownedTotal = moulds
      .filter((m) => !m.archived)
      .reduce((s, m) => s + Math.max(1, m.quantityOwned ?? 1), 0);
    return { used: used.size, total: ownedTotal };
  }, [today.todayLineItems, planProductByPlan, moulds]);

  // ─── Utilization: ingredients ───────────────────────────────────
  const ingredientsShort = useMemo(
    () =>
      ingredientStock.filter(
        (i) =>
          typeof i.quantityG === "number" &&
          typeof i.lowStockThresholdG === "number" &&
          i.quantityG < (i.lowStockThresholdG ?? 0),
      ).length,
    [ingredientStock],
  );

  // ─── Utilization: ready to pack ─────────────────────────────────
  const readyToPack = useMemo(
    () => orders.filter((o) => o.status === "ready_to_pack"),
    [orders],
  );

  // ─── Active batches list ────────────────────────────────────────
  const activeBatches = useMemo(
    () =>
      plans
        .filter((p) => p.status === "active")
        .sort((a, b) => (a.batchNumber ?? "").localeCompare(b.batchNumber ?? "")),
    [plans],
  );
  const draftBatches = useMemo(
    () => plans.filter((p) => p.status === "draft").slice(0, 8),
    [plans],
  );

  // ─── Mould occupancy ────────────────────────────────────────────
  const mouldOccupancy = useMemo(() => {
    const inUseByMould = new Map<string, { planName: string; pieces: number }>();
    for (const li of today.todayLineItems) {
      const plan = planById.get(li.planId);
      const pp = planProductByPlan.get(li.planId);
      if (!plan || !pp?.mouldId) continue;
      const mould = mouldById.get(pp.mouldId);
      const cav = mould?.numberOfCavities ?? 0;
      const pieces = pp.quantity * cav;
      const cur = inUseByMould.get(pp.mouldId);
      if (!cur) {
        inUseByMould.set(pp.mouldId, {
          planName: plan.name ?? "Batch",
          pieces,
        });
      } else {
        cur.pieces += pieces;
      }
    }
    return moulds
      .filter((m) => !m.archived)
      .map((m) => {
        const slot = inUseByMould.get(m.id!);
        return {
          id: m.id!,
          name: m.name,
          inUse: !!slot,
          slot,
        };
      })
      .sort((a, b) => Number(b.inUse) - Number(a.inUse) || a.name.localeCompare(b.name));
  }, [today.todayLineItems, planById, planProductByPlan, mouldById, moulds]);

  // ─── Compliance ─────────────────────────────────────────────────
  const compliance = useMemo(() => {
    if (!todayDay || todayDay.closedAt) {
      return { rows: [] as Array<{ label: string; status: "ok" | "warn"; href: string }> };
    }
    const rows: Array<{ label: string; status: "ok" | "warn"; href: string }> = [];
    const tempCheckDevices = equipment.filter((e) => e.requiresTempCheck);
    if (tempCheckDevices.length > 0) {
      rows.push({
        label: "Temperature log",
        status: todayDay.tempLogComplete ? "ok" : "warn",
        href: "/production-brain/haccp",
      });
    }
    rows.push({
      label: "Cleaning checklist",
      status: todayDay.cleaningComplete ? "ok" : "warn",
      href: "/production-brain/haccp",
    });
    return { rows };
  }, [todayDay, equipment]);

  // ─── Attention count ────────────────────────────────────────────
  const attentionCount = useMemo(() => {
    let n = 0;
    if (compliance.rows.some((r) => r.status === "warn")) n++;
    if (ingredientsShort > 0) n++;
    return n;
  }, [compliance.rows, ingredientsShort]);

  const dateLabel = useMemo(
    () => now.toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "short" }),
    [now],
  );
  const timeLabel = formatTime(now);

  const nowStepLabel =
    nowState.kind === "in-progress"
      ? `${nowState.stepName} in progress`
      : nowState.kind === "done"
      ? "done for today"
      : "workshop idle";

  // ─── Render ─────────────────────────────────────────────────────
  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Workshop"
        meta={`${dateLabel} · ${timeLabel} · ${nowStepLabel} · ${formatHours(capacityCard.slack)} slack remaining today`}
        badges={
          attentionCount > 0 ? (
            <StatusTag kind="pending">{attentionCount} attention</StatusTag>
          ) : undefined
        }
        actions={
          <>
            <DsButton variant="default" size="md" onClick={() => router.push("/production-brain/manual")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconPlus size={14} stroke={1.5} /> New batch
              </span>
            </DsButton>
            <DsButton variant="primary" size="md" onClick={() => router.push("/production-brain/daily")}>
              Quick add to today
            </DsButton>
          </>
        }
      />

      <div style={{ padding: "16px 32px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* ── NOW bar ──────────────────────────────────────────── */}
        <NowBar state={nowState} />

        {/* ── Utilization strip ────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
          <ZoneCard
            label="Today's capacity"
            status={capacityCard.pct >= 90 ? "tight" : capacityCard.pct >= 75 ? "warn" : "ok"}
            statusVariant={capacityCard.pct >= 90 ? "urgent" : capacityCard.pct >= 75 ? "warn" : "ok"}
            accentVariant={capacityCard.pct >= 90 ? "urgent" : capacityCard.pct >= 75 ? "warn" : "ok"}
            value={
              <span>
                {formatHours(capacityCard.used)}
                <span style={{ fontSize: 16, color: "var(--ds-text-muted)", fontWeight: 400 }}>
                  {" / "}
                  {formatHours(capacityCard.capacity)}
                </span>
              </span>
            }
            subtitle={
              capacityCard.capacity === 0
                ? "no capacity configured today"
                : `${formatHours(capacityCard.slack)} slack${todayDay && !todayDay.closedAt ? " · day open" : ""}`
            }
            href="/plan?view=weekly"
          />
          <ZoneCard
            label="Moulds in use"
            status={mouldsCard.total === 0 ? "—" : `${Math.round((mouldsCard.used / mouldsCard.total) * 100)}%`}
            statusVariant={mouldsCard.used > 0 ? "warn" : "ok"}
            accentVariant={mouldsCard.used > 0 ? "warn" : "ok"}
            value={
              <span>
                {mouldsCard.used}
                <span style={{ fontSize: 16, color: "var(--ds-text-muted)", fontWeight: 400 }}>
                  {" / "}
                  {mouldsCard.total}
                </span>
              </span>
            }
            subtitle={
              mouldsCard.used > 0
                ? `${mouldsCard.total - mouldsCard.used} free`
                : "all moulds free"
            }
            href="/moulds"
          />
          <ZoneCard
            label="Ingredients"
            status={ingredientsShort > 0 ? "short" : "stable"}
            statusVariant={ingredientsShort > 0 ? "urgent" : "ok"}
            accentVariant={ingredientsShort > 0 ? "urgent" : "ok"}
            value={ingredientsShort}
            subtitle={
              ingredientsShort > 0
                ? "below threshold · order today"
                : "all ingredients stocked"
            }
            href="/shopping"
          />
          <ZoneCard
            label="Ready to pack"
            status={readyToPack.length > 0 ? "queued" : "clear"}
            statusVariant={readyToPack.length > 0 ? "ok" : "info"}
            accentVariant={readyToPack.length > 0 ? "ok" : "info"}
            value={readyToPack.length}
            subtitle={
              readyToPack.length > 0
                ? `orders staged · pack today`
                : "nothing ready yet"
            }
            href="/picking"
          />
        </div>

        {/* ── 2-col body ───────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 16 }}>
          {/* LEFT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Section
              title="Active in workshop now"
              action={`${activeBatches.length} active`}
              noBody
            >
              {activeBatches.length === 0 ? (
                <p
                  className="text-ds-meta"
                  style={{ padding: "16px 20px" }}
                >
                  No active batches.
                </p>
              ) : (
                activeBatches.slice(0, 8).map((plan) => {
                  const pp = planProductByPlan.get(plan.id ?? "");
                  const product = pp ? productById.get(pp.productId) : undefined;
                  const mould = pp ? mouldById.get(pp.mouldId) : undefined;
                  const cav = mould?.numberOfCavities ?? 0;
                  const pieces = pp ? (pp.actualYield ?? pp.quantity * cav) : 0;
                  return (
                    <ListRow
                      key={plan.id}
                      tier="active"
                      title={
                        <>
                          <span>{plan.name ?? "Batch"}</span>
                          {plan.batchNumber && (
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--ds-text-muted)",
                                fontWeight: 400,
                              }}
                            >
                              {plan.batchNumber}
                            </span>
                          )}
                        </>
                      }
                      meta={
                        <>
                          {product?.name ?? "—"} · {mould?.name ?? "no mould"} ·{" "}
                          {pieces} pcs
                        </>
                      }
                      side={
                        <StatusTag kind="scheduled">active</StatusTag>
                      }
                      onClick={() => router.push(`/production/${plan.id}`)}
                    />
                  );
                })
              )}
            </Section>

            <Section
              title="Draft batches awaiting decision"
              action={`${plans.filter((p) => p.status === "draft").length} drafts`}
              noBody
            >
              {draftBatches.length === 0 ? (
                <p className="text-ds-meta" style={{ padding: "16px 20px" }}>
                  No drafts on the bench.
                </p>
              ) : (
                draftBatches.map((plan) => {
                  const ageDays = plan.createdAt
                    ? Math.floor(
                        (now.getTime() - new Date(plan.createdAt).getTime()) / 86_400_000,
                      )
                    : 0;
                  return (
                    <ListRow
                      key={plan.id}
                      tier="parked"
                      title={<span>{plan.name ?? "Draft"}</span>}
                      meta={`created ${ageDays}d ago · not scheduled`}
                      side={
                        <Link
                          href={`/production/${plan.id}`}
                          style={{
                            fontSize: 11,
                            color: "var(--ds-text-muted)",
                            textDecoration: "none",
                          }}
                        >
                          review →
                        </Link>
                      }
                      onClick={() => router.push(`/production/${plan.id}`)}
                    />
                  );
                })
              )}
              {plans.filter((p) => p.status === "draft").length > 8 && (
                <p
                  className="text-ds-meta"
                  style={{ padding: "8px 20px 12px", textAlign: "center" }}
                >
                  +
                  {plans.filter((p) => p.status === "draft").length - 8}
                  {" "}more drafts
                </p>
              )}
            </Section>
          </div>

          {/* RIGHT */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Section title="Mould occupancy" action={`${mouldsCard.used}/${mouldsCard.total} in use`}>
              <div
                style={{
                  padding: "0 16px 12px",
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                {mouldOccupancy.length === 0 ? (
                  <p className="text-ds-meta">No moulds configured.</p>
                ) : (
                  mouldOccupancy.slice(0, 8).map((m) => (
                    <div
                      key={m.id}
                      style={{
                        background: "var(--ds-card-bg)",
                        border: "0.5px solid var(--ds-border-warm)",
                        borderLeft: `3px solid ${m.inUse ? "var(--ds-semantic-warn)" : "var(--ds-tier-positive)"}`,
                        borderRadius: 4,
                        padding: "8px 10px",
                      }}
                    >
                      <p
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: "var(--ds-text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.name}
                      </p>
                      <p
                        style={{
                          fontSize: 11,
                          color: "var(--ds-text-muted)",
                          fontStyle: "italic",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.inUse
                          ? `${m.slot?.planName} · ${m.slot?.pieces} pcs`
                          : "free"}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Section>

            <Section
              title="Ready to pack"
              action={
                <Link href="/picking" style={{ color: "inherit", textDecoration: "none" }}>
                  open picking →
                </Link>
              }
              noBody
            >
              {readyToPack.length === 0 ? (
                <p className="text-ds-meta" style={{ padding: "16px 20px" }}>
                  Nothing ready to pack right now.
                </p>
              ) : (
                readyToPack.slice(0, 5).map((o) => {
                  const todayMs = new Date(todayIso + "T00:00:00").getTime();
                  const overdue = o.deadline
                    ? new Date(o.deadline).getTime() < todayMs
                    : false;
                  return (
                    <ListRow
                      key={o.id}
                      tier={overdue ? "urgent" : "default"}
                      title={
                        <>
                          <span>{o.customerName ?? o.eventName ?? "Order"}</span>
                          {o.sourceRef && (
                            <span
                              style={{
                                fontSize: 11,
                                color: "var(--ds-text-muted)",
                              }}
                            >
                              {o.sourceRef}
                            </span>
                          )}
                        </>
                      }
                      meta={`due ${o.deadline ? new Date(o.deadline).toLocaleDateString("de-AT", { day: "numeric", month: "short" }) : "—"}`}
                      side={
                        <StatusTag kind={overdue ? "overdue" : "ready"}>
                          {overdue ? "overdue" : "ready"}
                        </StatusTag>
                      }
                      onClick={() => router.push(`/orders/${o.id}`)}
                    />
                  );
                })
              )}
            </Section>

            {compliance.rows.length > 0 && (
              <Section title="Compliance today">
                <div style={{ padding: "0 16px 12px" }}>
                  {compliance.rows.map((r, i) => (
                    <AttentionItem
                      key={i}
                      variant={r.status === "warn" ? "warn" : "positive"}
                      icon={
                        r.label.includes("Temperature") ? (
                          <IconThermometer size={14} stroke={1.5} />
                        ) : r.label.includes("Cleaning") ? (
                          <IconBucketDroplet size={14} stroke={1.5} />
                        ) : (
                          <IconClipboardList size={14} stroke={1.5} />
                        )
                      }
                      title={r.label}
                      detail={r.status === "warn" ? "log now" : "completed"}
                      action={
                        <Link
                          href={r.href}
                          style={{
                            fontSize: 11,
                            color: "var(--ds-tier-quarter-focus)",
                            textDecoration: "none",
                          }}
                        >
                          open →
                        </Link>
                      }
                    />
                  ))}
                </div>
              </Section>
            )}
          </div>
        </div>

        {/* ── Quick actions ────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 12,
          }}
        >
          <QuickAction icon={<IconPlus size={16} stroke={1.5} />} label="New order" href="/orders/new" />
          <QuickAction icon={<IconCalendar size={16} stroke={1.5} />} label="Open planner" href="/plan?view=weekly" />
          <QuickAction icon={<IconBox size={16} stroke={1.5} />} label="Stock" href="/stock" />
          <QuickAction icon={<IconShoppingBag size={16} stroke={1.5} />} label="Campaigns" href="/campaigns" />
        </div>
      </div>
    </div>
  );
}

function NowBar({
  state,
}: {
  state:
    | { kind: "in-progress"; stepName: string; productNames: string[]; doneMoulds: number; totalMoulds: number; pct: number }
    | { kind: "done"; totalMins: number; batchCount: number }
    | { kind: "no-plan" };
}) {
  if (state.kind === "no-plan") {
    return (
      <section
        style={{
          background: "var(--ds-card-bg)",
          border: "0.5px solid var(--ds-border-warm)",
          borderLeft: "3px solid var(--ds-tier-parked)",
          borderRadius: 8,
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ flex: 1 }}>
          <p className="text-ds-label">Workshop idle</p>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              fontWeight: 600,
              marginTop: 2,
              color: "var(--ds-text-primary)",
            }}
          >
            No batches scheduled today
          </p>
          <p className="text-ds-meta">Open the planner to schedule work for today.</p>
        </div>
        <Link
          href="/plan?view=weekly"
          style={{
            fontSize: 12,
            color: "var(--ds-tier-quarter-focus)",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          Open planner →
        </Link>
      </section>
    );
  }
  if (state.kind === "done") {
    return (
      <section
        style={{
          background: "var(--ds-tint-ok)",
          border: "0.5px solid var(--ds-tier-positive)",
          borderLeft: "3px solid var(--ds-tier-positive)",
          borderRadius: 8,
          padding: "14px 20px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <IconCircleCheck size={20} stroke={1.5} style={{ color: "var(--ds-tier-positive)" }} />
        <div style={{ flex: 1 }}>
          <p className="text-ds-label">All done for today</p>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              fontWeight: 600,
              marginTop: 2,
              color: "var(--ds-text-primary)",
            }}
          >
            {state.batchCount} batches completed · {formatHours(state.totalMins)} active
          </p>
          <p className="text-ds-meta">Close production day when ready.</p>
        </div>
        <Link
          href="/production-brain/daily"
          style={{
            fontSize: 12,
            color: "var(--ds-tier-quarter-focus)",
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          Close production day →
        </Link>
      </section>
    );
  }
  return (
    <section
      style={{
        background: "var(--ds-tint-warn)",
        border: "0.5px solid var(--ds-semantic-warn)",
        borderLeft: "3px solid var(--ds-semantic-warn)",
        borderRadius: 8,
        padding: "14px 20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <p className="text-ds-label">Now in progress</p>
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 18,
              fontWeight: 600,
              marginTop: 2,
              color: "var(--ds-text-primary)",
            }}
          >
            {state.stepName}
            {state.productNames.length > 0 && (
              <span style={{ fontWeight: 400, color: "var(--ds-text-muted)", fontSize: 14 }}>
                {" · "}
                {state.productNames.slice(0, 2).join(", ")}
                {state.productNames.length > 2 ? ` +${state.productNames.length - 2}` : ""}
              </span>
            )}
          </p>
          <p className="text-ds-meta">
            {state.doneMoulds}/{state.totalMoulds} moulds · {state.pct}% complete
            <span style={{ marginLeft: 8, fontStyle: "italic", opacity: 0.7 }}>
              · elapsed timer unavailable (no startedAt on lineItems)
            </span>
          </p>
        </div>
        <Link
          href="/production-brain/daily"
          style={{
            fontSize: 12,
            color: "var(--ds-tier-quarter-focus)",
            textDecoration: "none",
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <IconPlayerPlay size={14} stroke={1.5} /> Open daily →
        </Link>
      </div>
      <div
        aria-hidden
        style={{
          marginTop: 10,
          height: 4,
          background: "rgba(0,0,0,0.06)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${state.pct}%`,
            height: "100%",
            background: "var(--ds-semantic-warn)",
          }}
        />
      </div>
    </section>
  );
}

function QuickAction({
  icon,
  label,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      style={{
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderRadius: 6,
        padding: "10px 14px",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "var(--ds-text-primary)",
        textDecoration: "none",
        transition: "background 0.1s",
      }}
      className="hover:bg-[color:var(--ds-card-bg-hover)]"
    >
      <span style={{ color: "var(--ds-text-muted)" }}>{icon}</span>
      {label}
    </Link>
  );
}

// Used in deferred sections — kept imported so future expansion stays cheap.
void IconClock;
void AttentionItem as unknown;
