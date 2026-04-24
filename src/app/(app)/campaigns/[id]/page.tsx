"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  useCampaign,
  saveCampaign,
  deleteCampaign,
  useProductsList,
} from "@/lib/hooks";
import {
  CAMPAIGN_TYPES,
  CAMPAIGN_STATUSES,
  type CampaignStatus,
  type CampaignType,
} from "@/types";

/**
 * Campaign detail page — edit everything about one campaign + assign
 * products that belong to it. No delete confirmation in the overlay
 * (pattern with existing detail pages — delete is a two-step inline).
 */
export default function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const campaignId = decodeURIComponent(idStr);
  const campaign = useCampaign(campaignId);
  const products = useProductsList();
  const router = useRouter();

  const [name, setName] = useState("");
  const [type, setType] = useState<CampaignType>("seasonal");
  const [status, setStatus] = useState<CampaignStatus>("planned");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [productionStartDate, setProductionStartDate] = useState("");
  const [targetTotalUnits, setTargetTotalUnits] = useState<number | "">("");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync local form state when the campaign loads.
  useEffect(() => {
    if (!campaign) return;
    setName(campaign.name);
    setType(campaign.type);
    setStatus(campaign.status);
    setStartDate(campaign.startDate);
    setEndDate(campaign.endDate);
    setProductionStartDate(campaign.productionStartDate ?? "");
    setTargetTotalUnits(campaign.targetTotalUnits ?? "");
    setProductIds(campaign.productIds);
    setNotes(campaign.notes ?? "");
  }, [campaign]);

  const productsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.id) m.set(p.id, p.name);
    return m;
  }, [products]);

  async function save() {
    if (!campaign) return;
    setSaving(true);
    try {
      await saveCampaign({
        id: campaign.id,
        name: name.trim() || "Untitled",
        type,
        status,
        startDate,
        endDate,
        productionStartDate: productionStartDate || undefined,
        targetTotalUnits:
          targetTotalUnits === "" ? undefined : Number(targetTotalUnits),
        productIds,
        notes: notes.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!campaign?.id) return;
    await deleteCampaign(campaign.id);
    router.replace("/campaigns");
  }

  function toggleProduct(id: string) {
    setProductIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  if (!campaign) {
    return (
      <div className="py-12 text-center text-muted-foreground">Loading…</div>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <Link
          href="/campaigns"
          className="inline-flex items-center gap-1 text-[11px] uppercase text-muted-foreground hover:text-foreground"
          style={{ letterSpacing: "0.1em" }}
        >
          <ArrowLeft className="w-3 h-3" /> Campaigns
        </Link>
      </div>

      <PageHeader
        title={name || "Untitled campaign"}
        accent={type}
        description={`${startDate} → ${endDate}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Main form */}
        <section className="space-y-4">
          <Field label="Name">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                className="input"
                value={type}
                onChange={(e) => setType(e.target.value as CampaignType)}
              >
                {CAMPAIGN_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select
                className="input"
                value={status}
                onChange={(e) => setStatus(e.target.value as CampaignStatus)}
              >
                {CAMPAIGN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Start date">
              <input
                type="date"
                className="input"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </Field>
            <Field label="End date">
              <input
                type="date"
                className="input"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Ramp-up start (optional)">
              <input
                type="date"
                className="input"
                value={productionStartDate}
                onChange={(e) => setProductionStartDate(e.target.value)}
              />
            </Field>
            <Field label="Target total units (optional)">
              <input
                type="number"
                min={0}
                className="input"
                value={targetTotalUnits}
                onChange={(e) =>
                  setTargetTotalUnits(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
              />
            </Field>
          </div>

          <Field label="Notes">
            <textarea
              className="input"
              value={notes}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>

          <div className="flex justify-between items-center pt-3 border-t border-border">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-2 text-[11.5px]">
                <span className="text-muted-foreground">Delete campaign?</span>
                <button
                  onClick={doDelete}
                  className="text-[color:var(--color-status-alert)] font-medium hover:underline"
                  style={{ letterSpacing: "0.04em" }}
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-muted-foreground hover:underline"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="text-[11px] uppercase text-muted-foreground hover:text-[color:var(--color-status-alert)]"
                style={{ letterSpacing: "0.1em" }}
              >
                Delete campaign
              </button>
            )}
          </div>
        </section>

        {/* Product picker */}
        <aside
          className="border border-border bg-card p-4"
          style={{ borderRadius: 4 }}
        >
          <h3
            className="text-[13px] mb-2"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 500,
              letterSpacing: "-0.012em",
            }}
          >
            Products in this campaign
            <span
              className="ml-2 text-[10px] text-muted-foreground uppercase font-normal"
              style={{ letterSpacing: "0.12em" }}
            >
              {productIds.length}
            </span>
          </h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            Ticked products get campaign-ramp replenishment proposals.
          </p>
          <ul className="space-y-1 max-h-[60vh] overflow-y-auto">
            {products
              .filter((p) => !p.archived)
              .map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-2 px-2 py-1 hover:bg-muted/60 text-[12.5px] cursor-pointer">
                    <input
                      type="checkbox"
                      className="w-3.5 h-3.5"
                      checked={productIds.includes(p.id ?? "")}
                      onChange={() => p.id && toggleProduct(p.id)}
                    />
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontWeight: 500,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {p.name}
                    </span>
                  </label>
                </li>
              ))}
          </ul>
        </aside>
      </div>

      {productIds.length > 0 ? (
        <section className="mt-8">
          <h3
            className="text-[13px] mb-2"
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 500,
              letterSpacing: "-0.012em",
            }}
          >
            Assigned products
          </h3>
          <ul className="flex flex-wrap gap-2">
            {productIds.map((id) => (
              <li
                key={id}
                className="px-2 py-1 text-[11.5px] border border-border bg-muted"
                style={{ borderRadius: 3 }}
              >
                {productsById.get(id) ?? id.slice(0, 8)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
