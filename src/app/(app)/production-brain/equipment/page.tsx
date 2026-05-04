"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/page-header";
import {
  useEquipmentInstances,
  useMachineLoads,
  useColdStorageUnits,
  useMouldPool,
  useMouldsList,
  useIngredients,
  useEquipment,
  saveMouldPoolInstance,
} from "@/lib/hooks";
import { MachineLoadModal } from "@/components/machine-load-modal";
import type { EquipmentInstance, MachineLoad, MouldPoolInstance } from "@/types";
import { BackButton } from "@/components/back-button";

/**
 * Production Brain · Equipment dashboard (phase 2 UI)
 *
 * Four panels: tempering machines (with live chocolate loads +
 * aging), mould pool (per-instance state grid), cold storage
 * (HACCP targets + frequency), and "other" equipment for melting
 * pots / coating belts / cooling.
 *
 * Read-only for now — write paths (load/unload chocolate, mark
 * mould deep-washed, log temperature) land in phase 3.
 */
export default function ProductionBrainEquipmentPage() {
  const equipment = useEquipment();
  const instances = useEquipmentInstances();
  const loads = useMachineLoads();
  const [loadModal, setLoadModal] = useState<EquipmentInstance | null>(null);

  async function handleMouldClick(inst: MouldPoolInstance, e: React.MouseEvent) {
    if (!inst.id) return;
    // Shift-click flips to/from 'broken'. Broken moulds drop out of the
    // usable pool until a replacement instance is inserted or the
    // operator un-breaks them (unlikely but reversible).
    if (e.shiftKey) {
      const next = inst.currentState === "broken" ? "available" : "broken";
      if (next === "broken" && !confirm(`Mark mould #${inst.instanceIndex} as broken? It will drop out of the usable pool.`)) {
        return;
      }
      await saveMouldPoolInstance({
        ...inst,
        currentState: next,
        stateChangedAt: new Date(),
      });
      return;
    }
    const current = inst.currentState;
    let nextState = current;
    if (current === "available") nextState = "needs-wash";
    else if (current === "needs-wash") nextState = "in-deep-wash";
    else if (current === "in-deep-wash") nextState = "available";
    else if (current === "loaded" || current === "filled" || current === "sealed") {
      nextState = "needs-wash";
    } else if (current === "retired") nextState = "available";
    else if (current === "broken") nextState = "available";
    await saveMouldPoolInstance({
      ...inst,
      currentState: nextState,
      stateChangedAt: new Date(),
      usesSinceDeepWash:
        nextState === "available" && current === "in-deep-wash"
          ? 0
          : inst.usesSinceDeepWash,
      retired: nextState === "retired",
    });
  }
  const storage = useColdStorageUnits();
  const mouldPool = useMouldPool();
  const moulds = useMouldsList();
  const ingredients = useIngredients();

  const equipmentById = useMemo(() => {
    const m = new Map<string, (typeof equipment)[number]>();
    for (const e of equipment) if (e.id) m.set(e.id, e);
    return m;
  }, [equipment]);

  const ingredientById = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of ingredients) if (i.id) m.set(i.id, i.name);
    return m;
  }, [ingredients]);

  const mouldById = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of moulds) if (x.id) m.set(x.id, x.name);
    return m;
  }, [moulds]);

  const activeLoadsByInstance = useMemo(() => {
    const m = new Map<string, MachineLoad>();
    for (const l of loads) {
      if (l.status !== "in_use" && l.status !== "draining") continue;
      const prev = m.get(l.equipmentInstanceId);
      if (!prev || new Date(l.loadedAt).getTime() > new Date(prev.loadedAt).getTime()) {
        m.set(l.equipmentInstanceId, l);
      }
    }
    return m;
  }, [loads]);

  const temperingInstances = instances.filter((i) => {
    const e = equipmentById.get(i.equipmentId);
    return e?.kind === "tempering" || e?.kind === "melting_pot";
  });
  const otherInstances = instances.filter((i) => !temperingInstances.includes(i));

  const mouldsByType = useMemo(() => {
    const m = new Map<string, MouldPoolInstance[]>();
    for (const entry of mouldPool) {
      const list = m.get(entry.mouldId) ?? [];
      list.push(entry);
      m.set(entry.mouldId, list);
    }
    return m;
  }, [mouldPool]);

  return (
    <div>
      <div className="px-4 pt-4">
        <BackButton />
      </div>
      <PageHeader
        title="Equipment"
        description="Live workshop snapshot — machines, mould pool, cold storage."
      />

      {/* Tempering + melting pots */}
      <section className="rounded-sm border border-border bg-card p-4 mb-4">
        <SectionHeader count={temperingInstances.length}>
          Tempering machines &amp; melting pots
        </SectionHeader>
        {temperingInstances.length === 0 ? (
          <EmptyBlock>
            No equipment instances yet. Add one at <code>/production-brain/equipment</code> (coming
            soon) or insert rows directly into <code>equipmentInstances</code>.
          </EmptyBlock>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {temperingInstances.map((inst) => {
              const load = activeLoadsByInstance.get(inst.id ?? "");
              const choc = load ? ingredientById.get(load.ingredientId) ?? "?" : null;
              const ageDays = load ? daysSince(load.loadedAt) : null;
              const aging =
                ageDays !== null && ageDays >= load!.agingAlertThresholdDays;
              return (
                <li
                  key={inst.id}
                  className="rounded-sm border border-border bg-muted p-3 text-sm"
                >
                  <div className="flex items-baseline justify-between">
                    <strong className="tracking-tight">{inst.name}</strong>
                    <StatusDot status={inst.status} aging={aging} />
                  </div>
                  {load ? (
                    <>
                      <p className="text-xs text-muted-foreground mt-1">
                        <span className="text-foreground font-medium">{choc}</span> ·{" "}
                        {Math.round(load.remainingQuantityG / 100) / 10} kg loaded
                      </p>
                      <div className="h-1 rounded-full bg-background/70 mt-2 overflow-hidden">
                        <div
                          className="h-full bg-status-ok"
                          style={{
                            width: `${Math.min(
                              100,
                              Math.round(
                                (load.remainingQuantityG /
                                  Math.max(load.loadedQuantityG, 1)) *
                                  100,
                              ),
                            )}%`,
                          }}
                        />
                      </div>
                      <p
                        className={
                          "text-[11px] mt-2 " +
                          (aging ? "text-status-warn" : "text-muted-foreground")
                        }
                      >
                        In machine {ageDays}d {aging ? "· aging — use or switch" : "· fresh"}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      {inst.status === "running" ? "Running, no load recorded" : "Idle"}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground mt-2 uppercase tracking-wider">
                    {inst.brand ? `${inst.brand} ` : ""}
                    {inst.model ?? ""}
                    {inst.capacityKg ? ` · ${inst.capacityKg} kg` : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => setLoadModal(inst)}
                    className="mt-2 text-[10px] uppercase text-muted-foreground hover:text-foreground"
                    style={{ letterSpacing: "0.1em" }}
                  >
                    {load ? "Manage load →" : "Load chocolate →"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Mould pool */}
      <section className="rounded-sm border border-border bg-card p-4 mb-4">
        <SectionHeader count={mouldPool.length}>Mould pool · by type</SectionHeader>
        {mouldPool.length === 0 ? (
          <EmptyBlock>
            No mould instances tracked yet. Create rows in <code>mouldPool</code> (one per
            physical copy of each mould) to populate this view.
          </EmptyBlock>
        ) : (
          <ul className="space-y-4">
            {Array.from(mouldsByType.entries()).map(([mouldId, list]) => {
              const summary = summariseMouldGroup(list);
              return (
                <li key={mouldId}>
                  <div className="flex items-baseline justify-between mb-2">
                    <strong className="text-sm tracking-tight">
                      {mouldById.get(mouldId) ?? mouldId.slice(0, 8)}
                    </strong>
                    <span className="text-[11px] text-muted-foreground">
                      {summary.join(" · ")}
                    </span>
                  </div>
                  <div className="grid grid-cols-10 sm:grid-cols-20 gap-1">
                    {list.map((inst) => (
                      <button
                        key={inst.id}
                        type="button"
                        onClick={(e) => handleMouldClick(inst, e)}
                        title={`#${inst.instanceIndex} · ${inst.currentState} · used ${inst.usesSinceDeepWash}/${inst.deepWashThreshold}\nShift-click to mark broken`}
                        className={
                          "aspect-square rounded cursor-pointer hover:outline hover:outline-1 hover:outline-foreground " +
                          MOULD_STATE_CLASS[inst.currentState]
                        }
                      />
                    ))}
                  </div>
                  {list.some((i) => i.currentState === "needs-wash" || i.currentState === "in-deep-wash") ? (
                    <p className="text-[10.5px] text-status-warn mt-1.5">
                      Deep-wash due on {list.filter((i) => i.currentState === "needs-wash" || i.currentState === "in-deep-wash").length} instance(s) · click a square to update
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Cold storage */}
      <section className="rounded-sm border border-border bg-card p-4 mb-4">
        <SectionHeader count={storage.length}>Cold storage · HACCP</SectionHeader>
        {storage.length === 0 ? (
          <EmptyBlock>
            No cold-storage units defined. Insert rows into <code>coldStorageUnits</code> so
            temperature logs can land against each fridge/freezer.
          </EmptyBlock>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {storage.map((unit) => (
              <li
                key={unit.id}
                className="rounded-sm border border-border bg-muted p-3 text-sm"
              >
                <div className="flex items-baseline justify-between">
                  <strong className="tracking-tight">{unit.name}</strong>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {unit.type}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 capitalize">
                  {unit.location}
                </p>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Target{" "}
                  <span className="text-foreground font-medium">
                    {unit.targetTempMinC ?? "?"}–{unit.targetTempMaxC ?? "?"} °C
                  </span>
                  {" · "}
                  {unit.requiresTempCheck
                    ? `${unit.checkFrequencyPerDay}×/day check`
                    : "no check required"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Other equipment */}
      {otherInstances.length > 0 ? (
        <section className="rounded-sm border border-border bg-card p-4">
          <SectionHeader count={otherInstances.length}>Other equipment</SectionHeader>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {otherInstances.map((inst) => (
              <li
                key={inst.id}
                className="rounded-sm border border-border bg-muted p-3 text-sm"
              >
                <div className="flex items-baseline justify-between">
                  <strong className="tracking-tight">{inst.name}</strong>
                  <StatusDot status={inst.status} aging={false} />
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 uppercase tracking-wider">
                  {equipmentById.get(inst.equipmentId)?.kind ?? "other"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loadModal ? (
        <MachineLoadModal
          instance={loadModal}
          activeLoad={activeLoadsByInstance.get(loadModal.id ?? "")}
          onClose={() => setLoadModal(null)}
        />
      ) : null}
    </div>
  );
}

function SectionHeader({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <h3 className="uppercase tracking-wider text-[10px] text-muted-foreground font-semibold mb-3">
      {children}
      {count !== undefined ? (
        <span className="normal-case font-normal text-muted-foreground">
          {" "}
          · {count}
        </span>
      ) : null}
    </h3>
  );
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground italic">{children}</p>;
}

function StatusDot({
  status,
  aging,
}: {
  status: string;
  aging: boolean;
}) {
  const cls = aging
    ? "bg-status-warn"
    : status === "running"
      ? "bg-status-ok"
      : status === "maintenance" || status === "retired"
        ? "bg-status-alert"
        : "bg-muted-foreground/30";
  return <span className={"inline-block w-2 h-2 rounded-full " + cls} />;
}

const MOULD_STATE_CLASS: Record<string, string> = {
  available: "bg-status-ok-bg",
  loaded: "bg-status-warn-bg",
  filled: "bg-status-warn-bg",
  sealed: "bg-status-warn-bg",
  "needs-wash": "bg-status-alert-bg",
  "in-deep-wash": "bg-accent-lilac-bg",
  retired: "bg-muted/50 opacity-50",
  broken: "bg-destructive/20 opacity-70 ring-1 ring-destructive",
};

function summariseMouldGroup(list: MouldPoolInstance[]): string[] {
  const counts: Record<string, number> = {};
  for (const inst of list) {
    counts[inst.currentState] = (counts[inst.currentState] ?? 0) + 1;
  }
  return Object.entries(counts).map(([state, n]) => `${n} ${state}`);
}

function daysSince(d: Date | string): number {
  const ms = Date.now() - new Date(d).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
