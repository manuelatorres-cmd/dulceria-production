"use client";

import { useMemo } from "react";
import {
  PageHeader,
  HubCard,
  Section,
} from "@/components/dulceria";
import {
  useReplenishmentProposals,
  useProductionPlans,
  useTodayProductionDay,
  useAllProductionDayLineItems,
  useOrders,
  useEquipmentInstances,
  useMachineLoads,
  useHaccpIncidents,
} from "@/lib/hooks";

/**
 * Production-brain hub landing. Was a bare redirect; now a wayfinding
 * landing with one HubCard per specialised planning surface.
 */
export default function ProductionBrainHubPage() {
  const pendingProposals = useReplenishmentProposals("pending");
  const plans = useProductionPlans();
  const todayDay = useTodayProductionDay();
  const allLineItems = useAllProductionDayLineItems();
  const orders = useOrders();
  const instances = useEquipmentInstances();
  const machineLoads = useMachineLoads();
  const openIncidents = useHaccpIncidents(true);

  const draftPlansCount = useMemo(
    () => plans.filter((p) => p.status === "draft").length,
    [plans],
  );

  const todayBatchesCount = useMemo(() => {
    if (!todayDay) return 0;
    // Today's batches = unique planIds in lineItems tied to today's day row.
    const planIds = new Set<string>();
    for (const li of allLineItems) {
      if (li.productionDayId === todayDay.id && li.planId) planIds.add(li.planId);
    }
    return planIds.size;
  }, [allLineItems, todayDay]);

  const openOrdersCount = useMemo(
    () =>
      orders.filter(
        (o) => o.status === "pending" || o.status === "in_production" || o.status === "ready_to_pack",
      ).length,
    [orders],
  );

  const machinesLoaded = useMemo(() => {
    const activeInstanceIds = new Set(
      machineLoads
        .filter((l) => l.status !== "draining" && (l.remainingQuantityG ?? 0) > 0)
        .map((l) => l.equipmentInstanceId),
    );
    return instances.filter((i) => activeInstanceIds.has(i.id ?? "")).length;
  }, [instances, machineLoads]);

  const pendingProposalsCount = pendingProposals.length;
  const openIncidentsCount = openIncidents.length;

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Production brain"
        meta="Specialised planning surfaces for production work"
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <Section title="Specialised surfaces">
          <div
            style={{
              padding: 16,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            <HubCard
              href="/production-brain/planner"
              icon="LayoutBoardSplit"
              title="Planner (replen)"
              description="Drag replenishment proposals onto a 4-week grid"
              stat={`${pendingProposalsCount} pending proposal${pendingProposalsCount === 1 ? "" : "s"}`}
              badge={pendingProposalsCount > 0 ? "warn" : undefined}
            />
            <HubCard
              href="/production-brain/manual"
              icon="Edit"
              title="Manual planner"
              description="Hand-compose batches in 3-zone builder"
              stat={`${draftPlansCount} draft${draftPlansCount === 1 ? "" : "s"}`}
            />
            <HubCard
              href="/production-brain/daily"
              icon="CalendarEvent"
              title="Daily"
              description="Single-day execution + step toggles"
              stat={`${todayBatchesCount} batch${todayBatchesCount === 1 ? "" : "es"} today`}
            />
            <HubCard
              href="/production-brain/needed"
              icon="ListCheck"
              title="Needed vs stock"
              description="Multi-order picker against current stock"
              stat={`${openOrdersCount} open order${openOrdersCount === 1 ? "" : "s"}`}
            />
            <HubCard
              href="/production-brain/equipment"
              icon="Settings"
              title="Equipment"
              description="Machine loads, mould pool, cold storage"
              stat={`${machinesLoaded} machine${machinesLoaded === 1 ? "" : "s"} loaded`}
            />
            <HubCard
              href="/production-brain/haccp"
              icon="AlertTriangle"
              title="HACCP"
              description="Temperature logs + incident tracking"
              stat={`${openIncidentsCount} open incident${openIncidentsCount === 1 ? "" : "s"}`}
              badge={openIncidentsCount > 0 ? "urgent" : undefined}
            />
          </div>
        </Section>
      </div>
    </div>
  );
}
