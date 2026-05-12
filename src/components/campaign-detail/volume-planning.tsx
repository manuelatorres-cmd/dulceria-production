"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  saveCampaign,
  saveProductionOrder,
  saveProductionOrderItem,
  useAllVariantProducts,
  useProductionOrders,
  useAllProductionOrderItems,
} from "@/lib/hooks";
import type { Campaign, Product } from "@/types";
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconCheck,
  IconX,
  IconAlertTriangle,
} from "@tabler/icons-react";

interface Props {
  campaign: Campaign;
  products: Product[];
}

interface ResolvedRow {
  productId: string;
  productName: string;
  units: number;
  unitPrice: number;
  rowRevenue: number;
  /** True when a productTarget references a product that no longer exists. */
  missing: boolean;
}

function formatEuro(n: number): string {
  // Plain de-AT style: "€ 3.750,50". Use Intl for safety on negatives.
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function VolumePlanning({ campaign, products }: Props) {
  const variantProducts = useAllVariantProducts();
  const productionOrders = useProductionOrders();
  const productionOrderItems = useAllProductionOrderItems();

  // Per-product list price = max(unitPrice) across variant lines.
  const priceByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const vp of variantProducts) {
      const px = typeof vp.unitPrice === "number" ? vp.unitPrice : 0;
      if (px <= 0) continue;
      const cur = m.get(vp.productId) ?? 0;
      if (px > cur) m.set(vp.productId, px);
    }
    return m;
  }, [variantProducts]);

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id!, p])),
    [products],
  );

  // ─── View-mode rows ──────────────────────────────────────────────
  const rows = useMemo<ResolvedRow[]>(() => {
    const targets = campaign.productTargets ?? {};
    return Object.entries(targets).map(([productId, units]) => {
      const product = productById.get(productId);
      const unitPrice = priceByProduct.get(productId) ?? 0;
      return {
        productId,
        productName: product?.name ?? `SKU ${productId.slice(0, 6)}`,
        units: Number(units) || 0,
        unitPrice,
        rowRevenue: (Number(units) || 0) * unitPrice,
        missing: !product || !!product.archived,
      };
    });
  }, [campaign.productTargets, productById, priceByProduct]);

  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const projectedRevenue = rows.reduce((s, r) => s + r.rowRevenue, 0);
  const revenueTarget =
    typeof campaign.revenueTarget === "number" ? campaign.revenueTarget : null;

  // ─── Edit mode state ─────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draftTargets, setDraftTargets] = useState<Record<string, number>>({});
  const [draftRevenueTarget, setDraftRevenueTarget] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setDraftTargets({ ...(campaign.productTargets ?? {}) });
    setDraftRevenueTarget(
      typeof campaign.revenueTarget === "number" ? String(campaign.revenueTarget) : "",
    );
  }, [campaign.productTargets, campaign.revenueTarget, editing]);

  const draftRows = useMemo<ResolvedRow[]>(() => {
    return Object.entries(draftTargets).map(([productId, units]) => {
      const product = productById.get(productId);
      const unitPrice = priceByProduct.get(productId) ?? 0;
      return {
        productId,
        productName: product?.name ?? `SKU ${productId.slice(0, 6)}`,
        units: Number(units) || 0,
        unitPrice,
        rowRevenue: (Number(units) || 0) * unitPrice,
        missing: !product || !!product.archived,
      };
    });
  }, [draftTargets, productById, priceByProduct]);
  const draftTotalUnits = draftRows.reduce((s, r) => s + r.units, 0);
  const draftProjected = draftRows.reduce((s, r) => s + r.rowRevenue, 0);
  const draftRevenueTargetNum = parseFloat(draftRevenueTarget);
  const draftRevenueTargetValid =
    draftRevenueTarget === "" ||
    (!Number.isNaN(draftRevenueTargetNum) && draftRevenueTargetNum >= 0);

  async function handleSave() {
    if (!campaign.id) return;
    if (!draftRevenueTargetValid) {
      setSaveError("Revenue target must be a number ≥ 0 (or blank).");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const cleaned: Record<string, number> = {};
      for (const [pid, n] of Object.entries(draftTargets)) {
        const v = Math.floor(Number(n) || 0);
        if (v > 0) cleaned[pid] = v;
      }
      const nextProductIds = Array.from(
        new Set([...(campaign.productIds ?? []), ...Object.keys(cleaned)]),
      );
      const revTarget =
        draftRevenueTarget === "" ? undefined : Number(draftRevenueTargetNum);
      await saveCampaign({
        ...campaign,
        productTargets: cleaned,
        productIds: nextProductIds,
        revenueTarget: revTarget,
      });
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }
  function handleCancel() {
    setEditing(false);
    setSaveError(null);
  }
  function setUnitsForProduct(productId: string, value: number) {
    setDraftTargets((cur) => ({ ...cur, [productId]: Math.max(0, Math.floor(value || 0)) }));
  }
  function removeProductFromTargets(productId: string) {
    if (!confirm(`Remove this SKU from the campaign target?`)) return;
    setDraftTargets((cur) => {
      const next = { ...cur };
      delete next[productId];
      return next;
    });
  }

  // ─── PO lookup + create ──────────────────────────────────────────
  const existingPo = useMemo(() => {
    if (!campaign.id) return null;
    return (
      productionOrders.find(
        (po) => po.campaignId === campaign.id && po.status !== "cancelled",
      ) ?? null
    );
  }, [productionOrders, campaign.id]);
  const [poBusy, setPoBusy] = useState(false);
  const [poError, setPoError] = useState<string | null>(null);
  const [poJustCreated, setPoJustCreated] = useState<string | null>(null);

  async function handleCreatePo() {
    if (!campaign.id) return;
    if (rows.length === 0) {
      setPoError("Add at least one product target before creating a Production Order.");
      return;
    }
    setPoBusy(true);
    setPoError(null);
    try {
      const dueDate =
        campaign.productionStartDate ?? campaign.startDate ?? campaign.endDate;
      const poId = await saveProductionOrder({
        name: campaign.name,
        dueDate: dueDate ?? new Date().toISOString().slice(0, 10),
        status: "pending",
        channel: "campaign_run",
        campaignId: campaign.id,
        targetLocation: null,
        notes: `Auto-created from campaign Volume planning · ${new Date().toLocaleDateString("de-AT")}`,
      });
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (r.missing) continue;
        await saveProductionOrderItem({
          productionOrderId: poId,
          productId: r.productId,
          targetUnits: r.units,
          sortOrder: i,
        });
      }
      setPoJustCreated(poId);
    } catch (e) {
      setPoError(e instanceof Error ? e.message : String(e));
    } finally {
      setPoBusy(false);
    }
  }

  const linkedPoId = existingPo?.id ?? poJustCreated;
  const linkedPo = linkedPoId
    ? productionOrders.find((po) => po.id === linkedPoId) ?? null
    : null;
  const linkedPoItemCount = linkedPoId
    ? productionOrderItems.filter((it) => it.productionOrderId === linkedPoId).length
    : 0;

  // ─── Add SKU picker ──────────────────────────────────────────────
  const productsAvailable = useMemo(() => {
    const taken = new Set(Object.keys(draftTargets));
    return products
      .filter((p) => !p.archived)
      .filter((p) => !taken.has(p.id!))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [products, draftTargets]);

  // ─── Render helpers ──────────────────────────────────────────────
  const showRows = editing ? draftRows : rows;
  const showTotalUnits = editing ? draftTotalUnits : totalUnits;
  const showProjected = editing ? draftProjected : projectedRevenue;
  const effectiveTarget = editing
    ? draftRevenueTarget === ""
      ? null
      : draftRevenueTargetNum
    : revenueTarget;

  let statusLabel = "No target set";
  let statusColor = "var(--ds-text-muted)";
  if (effectiveTarget != null && !Number.isNaN(effectiveTarget)) {
    const delta = showProjected - effectiveTarget;
    if (delta >= 0) {
      statusLabel = `On target (+${formatEuro(delta)})`;
      statusColor = "var(--ds-tier-positive)";
    } else {
      statusLabel = `Under target (−${formatEuro(Math.abs(delta))})`;
      statusColor = "var(--ds-tier-urgent)";
    }
  }

  return (
    <section
      className="mb-4"
      style={{
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderRadius: 8,
        overflow: "hidden",
        color: "var(--ds-text-primary)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "14px 20px 10px",
          borderBottom: "0.5px solid var(--ds-border-warm)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 className="text-ds-card-title">Volume planning</h2>
          <p className="text-ds-meta" style={{ marginTop: 2 }}>
            Target units × list price → projected revenue.
          </p>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="hover:bg-[color:var(--ds-card-bg-hover)]"
              style={{
                padding: "4px 10px",
                fontSize: 12,
                border: "0.5px solid var(--ds-border-warm)",
                background: "var(--ds-card-bg)",
                color: "var(--ds-text-primary)",
                borderRadius: 4,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <IconPencil size={14} stroke={1.5} /> Edit mode
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  border: "0.5px solid var(--ds-border-warm)",
                  background: "var(--ds-card-bg)",
                  color: "var(--ds-text-primary)",
                  borderRadius: 4,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !draftRevenueTargetValid}
                style={{
                  padding: "4px 10px",
                  fontSize: 12,
                  border: "0.5px solid var(--ds-tier-quarter-focus)",
                  background: "var(--ds-tier-quarter-focus)",
                  color: "#ffffff",
                  borderRadius: 4,
                  opacity: !draftRevenueTargetValid || saving ? 0.55 : 1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <IconCheck size={14} stroke={1.5} /> {saving ? "Saving…" : "Save"}
              </button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <p
          style={{
            margin: 0,
            padding: "8px 20px",
            fontSize: 12,
            color: "var(--ds-tier-urgent)",
            background: "var(--ds-tint-critical)",
            borderBottom: "0.5px solid var(--ds-border-warm)",
          }}
        >
          {saveError}
        </p>
      )}

      {/* Table */}
      {showRows.length === 0 ? (
        <p
          style={{
            padding: "20px",
            fontSize: 13,
            color: "var(--ds-text-muted)",
            fontStyle: "italic",
          }}
        >
          No product targets yet.
          {editing && " Click \"+ Add product target\" below."}
        </p>
      ) : (
        <div style={{ padding: "8px 0" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: editing
                ? "1fr 110px 110px 130px 32px"
                : "1fr 110px 110px 130px",
              gap: 8,
              padding: "6px 20px",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--ds-text-muted)",
              fontWeight: 600,
            }}
          >
            <span>SKU</span>
            <span style={{ textAlign: "right" }}>Units</span>
            <span style={{ textAlign: "right" }}>Price</span>
            <span style={{ textAlign: "right" }}>Revenue if sold</span>
            {editing && <span />}
          </div>
          {showRows.map((row) => (
            <div
              key={row.productId}
              style={{
                display: "grid",
                gridTemplateColumns: editing
                  ? "1fr 110px 110px 130px 32px"
                  : "1fr 110px 110px 130px",
                gap: 8,
                padding: "8px 20px",
                fontSize: 13,
                borderTop: "0.5px solid var(--ds-border-warm)",
                background: row.missing ? "var(--ds-tint-critical)" : "transparent",
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  color: row.missing ? "var(--ds-tier-urgent)" : "var(--ds-text-primary)",
                  fontWeight: 500,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.missing && <IconAlertTriangle size={14} stroke={1.5} />}
                {row.productName}
                {row.missing && (
                  <span className="text-ds-meta" style={{ fontSize: 10 }}>
                    SKU missing
                  </span>
                )}
              </span>
              {editing ? (
                <input
                  type="number"
                  min={0}
                  value={row.units}
                  onChange={(e) =>
                    setUnitsForProduct(row.productId, Number(e.target.value) || 0)
                  }
                  style={{
                    fontSize: 13,
                    textAlign: "right",
                    border: "0.5px solid var(--ds-border-warm)",
                    background: "var(--ds-card-bg)",
                    color: "var(--ds-text-primary)",
                    borderRadius: 4,
                    padding: "2px 6px",
                    fontVariantNumeric: "tabular-nums",
                  }}
                />
              ) : (
                <span
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {row.units}
                </span>
              )}
              <span
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  color: row.unitPrice <= 0 ? "var(--ds-semantic-warn)" : "var(--ds-text-primary)",
                }}
                title={row.unitPrice <= 0 ? "No retail price set on any variant" : undefined}
              >
                {row.unitPrice > 0 ? formatEuro(row.unitPrice) : "—"}
              </span>
              <span
                style={{
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {row.unitPrice > 0 ? formatEuro(row.rowRevenue) : "—"}
              </span>
              {editing && (
                <button
                  type="button"
                  onClick={() => removeProductFromTargets(row.productId)}
                  aria-label="remove SKU"
                  style={{
                    color: "var(--ds-text-muted)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                  title="Remove this SKU"
                >
                  <IconTrash size={14} stroke={1.5} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add row */}
      {editing && (
        <div style={{ padding: "8px 20px 16px", borderTop: "0.5px solid var(--ds-border-warm)" }}>
          {!pickerOpen ? (
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              style={{
                fontSize: 12,
                color: "var(--ds-text-muted)",
                background: "transparent",
                border: "0.5px dashed var(--ds-border-warm)",
                borderRadius: 4,
                padding: "6px 12px",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              <IconPlus size={14} stroke={1.5} /> Add product target
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                onChange={(e) => {
                  const pid = e.target.value;
                  if (!pid) return;
                  setUnitsForProduct(pid, 1);
                  setPickerOpen(false);
                }}
                style={{
                  fontSize: 13,
                  padding: "4px 8px",
                  border: "0.5px solid var(--ds-border-warm)",
                  background: "var(--ds-card-bg)",
                  borderRadius: 4,
                  color: "var(--ds-text-primary)",
                  minWidth: 240,
                }}
                defaultValue=""
              >
                <option value="">— pick a product —</option>
                {productsAvailable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                style={{
                  fontSize: 12,
                  color: "var(--ds-text-muted)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                <IconX size={14} stroke={1.5} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Totals */}
      <div
        style={{
          padding: "14px 20px",
          borderTop: "0.5px solid var(--ds-border-warm)",
          background: "var(--ds-page-bg)",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 8,
          alignItems: "end",
        }}
      >
        <div>
          <p className="text-ds-label">Total units</p>
          <p
            style={{
              fontSize: 20,
              fontFamily: "var(--font-serif)",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              marginTop: 2,
              color: "var(--ds-text-primary)",
            }}
          >
            {showTotalUnits}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p
            style={{
              fontSize: 11,
              color: "var(--ds-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontWeight: 500,
            }}
          >
            Projected revenue
          </p>
          <p
            style={{
              fontSize: 20,
              fontFamily: "var(--font-serif)",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              marginTop: 2,
              color: "var(--ds-text-primary)",
            }}
          >
            {formatEuro(showProjected)}
          </p>
          {editing ? (
            <div style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="text-ds-label">Revenue target</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={draftRevenueTarget}
                placeholder="—"
                onChange={(e) => setDraftRevenueTarget(e.target.value)}
                style={{
                  fontSize: 13,
                  textAlign: "right",
                  width: 110,
                  border: "0.5px solid var(--ds-border-warm)",
                  background: "var(--ds-card-bg)",
                  color: "var(--ds-text-primary)",
                  borderRadius: 4,
                  padding: "2px 6px",
                  fontVariantNumeric: "tabular-nums",
                }}
              />
            </div>
          ) : (
            revenueTarget != null && (
              <p
                className="text-ds-meta"
                style={{ marginTop: 4, fontStyle: "normal" }}
              >
                Revenue target {formatEuro(revenueTarget)}
              </p>
            )
          )}
          <p
            style={{
              fontSize: 12,
              fontWeight: 500,
              marginTop: 6,
              color: statusColor,
            }}
          >
            {statusLabel}
          </p>
        </div>
      </div>

      {/* PO action footer */}
      <div
        style={{
          padding: "12px 20px",
          borderTop: "0.5px solid var(--ds-border-warm)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {linkedPoId ? (
          <>
            <span className="text-ds-meta">
              Linked Production Order · {linkedPo?.status ?? "pending"} ·{" "}
              {linkedPoItemCount} item{linkedPoItemCount === 1 ? "" : "s"}
              {linkedPo?.createdAt &&
                ` · created ${new Date(linkedPo.createdAt).toLocaleDateString("de-AT")}`}
            </span>
            <Link
              href={`/production-orders/${encodeURIComponent(linkedPoId)}`}
              style={{
                fontSize: 12,
                color: "var(--ds-text-inverse)",
                background: "var(--ds-tier-quarter-focus)",
                padding: "6px 14px",
                borderRadius: 4,
                textDecoration: "none",
                fontWeight: 500,
              }}
            >
              View Production Order →
            </Link>
          </>
        ) : (
          <>
            <span className="text-ds-meta">
              {rows.length === 0
                ? "Add at least one product target to create a Production Order."
                : "Create a Production Order to feed the auto-planner. Open /plan?view=weekly → Regenerate to schedule the batches."}
            </span>
            <button
              type="button"
              onClick={handleCreatePo}
              disabled={rows.length === 0 || poBusy}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                border: "0.5px solid var(--ds-tier-quarter-focus)",
                background: "var(--ds-tier-quarter-focus)",
                color: "#ffffff",
                borderRadius: 4,
                opacity: rows.length === 0 || poBusy ? 0.55 : 1,
                cursor: rows.length === 0 || poBusy ? "not-allowed" : "pointer",
                fontWeight: 500,
              }}
            >
              {poBusy ? "Creating…" : "Create Production Order"}
            </button>
          </>
        )}
      </div>
      {poError && (
        <p
          style={{
            margin: 0,
            padding: "8px 20px",
            fontSize: 12,
            color: "var(--ds-tier-urgent)",
            background: "var(--ds-tint-critical)",
          }}
        >
          {poError}
        </p>
      )}

      {/* Business Hub sync — deferred until cross-app API exists */}
      {campaign.businessHubCampaignId ? (
        <p
          className="text-ds-meta"
          style={{ padding: "8px 20px 14px", borderTop: "0.5px solid var(--ds-border-warm)" }}
        >
          Business Hub campaign linked ·{" "}
          <span
            style={{
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 11,
              color: "var(--ds-text-primary)",
            }}
          >
            {campaign.businessHubCampaignId}
          </span>{" "}
          · projected revenue not synced yet (no cross-app API wired).
        </p>
      ) : null}
    </section>
  );
}
