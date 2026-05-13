"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useCampaigns,
  saveCampaign,
  useProductionPlans,
  useAllPlanProducts,
  useAllPlanStepStatuses,
} from "@/lib/hooks";
import { newId } from "@/lib/supabase";
import {
  PageHeader,
  Section,
  CampaignCard,
  AddCampaignCard,
  DsButton,
  StatusTag,
  type CampaignCardVariant,
  type CampaignTypeTag,
} from "@/components/dulceria";
import {
  IconPlus,
  IconCalendar,
  IconSearch,
} from "@tabler/icons-react";
import type { Campaign } from "@/types";

type FilterKey =
  | "all"
  | "active"
  | "planned"
  | "done"
  | "seasonal"
  | "launch"
  | "market_event";

const FILTERS: Array<{ id: FilterKey; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "planned", label: "Planned" },
  { id: "done", label: "Done" },
  { id: "seasonal", label: "Seasonal" },
  { id: "launch", label: "Launch" },
  { id: "market_event", label: "Market event" },
];

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatShortDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("de-AT", { day: "numeric", month: "short" });
}

export default function CampaignsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const campaigns = useCampaigns();
  const plans = useProductionPlans();
  const planProducts = useAllPlanProducts();
  const stepStatuses = useAllPlanStepStatuses();

  const [search, setSearch] = useState<string>(searchParams.get("q") ?? "");
  const [filter, setFilter] = useState<FilterKey>(
    (searchParams.get("filter") as FilterKey | null) ?? "all",
  );
  const [creating, setCreating] = useState(false);

  async function handleAdd() {
    setCreating(true);
    try {
      const id = newId();
      await saveCampaign({
        id,
        name: "New campaign",
        type: "seasonal",
        startDate: isoToday(),
        endDate: new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10),
        productIds: [],
        status: "planned",
      });
      router.push(`/campaigns/${encodeURIComponent(id)}?new=1`);
    } finally {
      setCreating(false);
    }
  }

  const planProductsByPlan = useMemo(() => {
    const m = new Map<string, typeof planProducts>();
    for (const pp of planProducts) {
      const arr = m.get(pp.planId) ?? [];
      arr.push(pp);
      m.set(pp.planId, arr);
    }
    return m;
  }, [planProducts]);

  const todayMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  function plansForCampaign(c: Campaign): typeof plans {
    const matches: typeof plans = [];
    for (const p of plans) {
      const name = p.name ?? "";
      if (
        name.startsWith(`Campaign: ${c.name}`) ||
        name.includes(`Campaign: ${c.name} —`) ||
        name === c.name
      ) {
        matches.push(p);
      }
    }
    return matches;
  }

  function buildVm(c: Campaign) {
    const end = c.endDate ? new Date(c.endDate + "T23:59:59").getTime() : 0;
    const prodStart = c.productionStartDate
      ? new Date(c.productionStartDate + "T00:00:00").getTime()
      : 0;
    const daysToLaunch = end ? Math.ceil((end - todayMs) / 86_400_000) : null;
    const daysToProd = prodStart ? Math.ceil((prodStart - todayMs) / 86_400_000) : null;

    const productCount = Math.max(
      c.productIds?.length ?? 0,
      Object.keys(c.productTargets ?? {}).length,
    );

    const linkedPlans = plansForCampaign(c);
    const batchCount = linkedPlans.length;

    let doneSteps = 0;
    let totalSteps = 0;
    for (const p of linkedPlans) {
      const pps = planProductsByPlan.get(p.id ?? "") ?? [];
      totalSteps += pps.length * 5;
      doneSteps += stepStatuses.filter((s) => s.planId === p.id && s.done).length;
    }
    const progressPct = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

    let variant: CampaignCardVariant;
    if (c.status === "done") variant = "done";
    else if (c.status === "cancelled") variant = "planned";
    else if (daysToLaunch != null && daysToLaunch <= 7 && progressPct < 50) variant = "urgent";
    else if (daysToProd != null && daysToProd >= 0 && daysToProd <= 14) variant = "warn";
    else if (c.status === "active") variant = "active";
    else variant = "planned";

    let statusText = "";
    if (c.status === "done") statusText = "shipped";
    else if (c.status === "cancelled") statusText = "cancelled";
    else if (daysToLaunch == null) statusText = "no end date";
    else if (daysToLaunch < 0) statusText = `launched ${-daysToLaunch}d ago`;
    else if (daysToLaunch === 0) statusText = "launches today";
    else if (daysToProd != null && daysToProd > 0)
      statusText = `production starts in ${daysToProd}d`;
    else statusText = `${daysToLaunch}d to launch`;

    const dateLabel =
      c.startDate && c.endDate
        ? `${formatShortDate(c.startDate)} → ${formatShortDate(c.endDate)}`
        : c.startDate
        ? `from ${formatShortDate(c.startDate)}`
        : "no dates";
    const daysToLaunchLabel =
      daysToLaunch != null && daysToLaunch >= 0 && c.status !== "done"
        ? `${daysToLaunch}d to launch`
        : "";

    return {
      campaign: c,
      typeTag: (c.type as CampaignTypeTag) ?? "seasonal",
      variant,
      statusText,
      progressPct,
      productCount,
      batchCount,
      doneCount: doneSteps,
      dateLabel,
      daysToLaunchLabel,
    };
  }

  const allVms = useMemo(
    () => campaigns.map(buildVm),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaigns, todayMs, plans, planProductsByPlan, stepStatuses],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allVms.filter((vm) => {
      if (q && !vm.campaign.name.toLowerCase().includes(q)) return false;
      switch (filter) {
        case "active":
          return vm.campaign.status === "active";
        case "planned":
          return vm.campaign.status === "planned";
        case "done":
          return vm.campaign.status === "done";
        case "seasonal":
          return vm.campaign.type === "seasonal";
        case "launch":
          return vm.campaign.type === "launch";
        case "market_event":
          return vm.campaign.type === "market_event";
        case "all":
        default:
          return true;
      }
    });
  }, [allVms, filter, search]);

  const sections = useMemo(() => {
    const lists: Array<{ id: string; label: string; list: typeof filtered }> = [
      { id: "active", label: "Active", list: filtered.filter((v) => v.campaign.status === "active") },
      { id: "planned", label: "Planned", list: filtered.filter((v) => v.campaign.status === "planned") },
      { id: "wrapping", label: "Wrapping up", list: filtered.filter((v) => v.campaign.status === "wrapping") },
      { id: "done", label: "Done", list: filtered.filter((v) => v.campaign.status === "done") },
      { id: "cancelled", label: "Cancelled", list: filtered.filter((v) => v.campaign.status === "cancelled") },
    ];
    return lists.filter((s) => s.list.length > 0);
  }, [filtered]);

  const total = allVms.length;
  const activeCount = allVms.filter((v) => v.campaign.status === "active").length;
  const urgentCount = allVms.filter((v) => v.variant === "urgent").length;

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Campaigns"
        meta={`Seasonal boxes, limited editions, launches · ${total} total · ${activeCount} active · ${urgentCount} urgent`}
        badges={
          urgentCount > 0 ? (
            <StatusTag kind="overdue">{urgentCount} urgent</StatusTag>
          ) : undefined
        }
        actions={
          <>
            <DsButton variant="default" size="md" onClick={() => router.push("/calendar")}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconCalendar size={14} stroke={1.5} /> Calendar view
              </span>
            </DsButton>
            <DsButton variant="primary" size="md" onClick={handleAdd} disabled={creating}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <IconPlus size={14} stroke={1.5} />
                {creating ? "Creating…" : "New campaign"}
              </span>
            </DsButton>
          </>
        }
      />

      <div style={{ padding: "16px 32px 32px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {FILTERS.map((f) => {
              const active = filter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  style={{
                    padding: "4px 10px",
                    fontSize: 12,
                    border: `0.5px solid ${active ? "var(--ds-tier-quarter-focus)" : "var(--ds-border-warm)"}`,
                    background: active ? "var(--ds-tier-quarter-focus)" : "var(--ds-card-bg)",
                    color: active ? "#ffffff" : "var(--ds-text-muted)",
                    borderRadius: 14,
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              border: "0.5px solid var(--ds-border-warm)",
              background: "var(--ds-card-bg)",
              borderRadius: 14,
              minWidth: 220,
            }}
          >
            <IconSearch size={13} stroke={1.5} style={{ color: "var(--ds-text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search campaign name…"
              style={{
                fontSize: 12,
                border: "none",
                background: "transparent",
                outline: "none",
                flex: 1,
                color: "var(--ds-text-primary)",
              }}
            />
          </div>
        </div>

        {sections.length === 0 ? (
          <p
            className="text-ds-meta"
            style={{
              padding: "32px 0",
              textAlign: "center",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
            }}
          >
            No campaigns match the current filter.
          </p>
        ) : (
          sections.map((sec) => (
            <Section
              key={sec.id}
              title={sec.label}
              action={`${sec.list.length} campaign${sec.list.length === 1 ? "" : "s"}`}
            >
              <div
                style={{
                  padding: "0 16px 14px",
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 12,
                }}
              >
                {sec.list.map((vm) => (
                  <CampaignCard
                    key={vm.campaign.id}
                    href={`/campaigns/${encodeURIComponent(vm.campaign.id ?? "")}`}
                    name={vm.campaign.name || "Untitled campaign"}
                    typeTag={vm.typeTag}
                    variant={vm.variant}
                    dateLabel={vm.dateLabel}
                    daysToLaunchLabel={vm.daysToLaunchLabel}
                    stats={[
                      { label: "Products", value: vm.productCount },
                      { label: "Batches", value: vm.batchCount },
                      { label: "Done", value: vm.doneCount },
                    ]}
                    progressPct={vm.progressPct}
                    statusText={vm.statusText}
                  />
                ))}
                {sec.id === "planned" && (
                  <AddCampaignCard
                    label="new planned campaign"
                    onClick={handleAdd}
                    disabled={creating}
                  />
                )}
              </div>
            </Section>
          ))
        )}
      </div>
    </div>
  );
}
