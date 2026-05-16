"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  saveCampaign,
  saveProductionOrder,
  saveProductionOrderItem,
  useAllVariantPackagingProducts,
  useAllVariantPackagings,
  usePackagingList,
  useProductionOrders,
  useAllProductionOrderItems,
  useVariants,
} from "@/lib/hooks";
import type { Campaign, Product } from "@/types";
import {
  IconPencil,
  IconPlus,
  IconTrash,
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";

interface Props {
  campaign: Campaign;
  products: Product[];
}

interface ResolvedRow {
  vpId: string;
  variantName: string;
  packagingLabel: string;
  capacity: number;
  units: number;
  unitPrice: number;
  rowRevenue: number;
  /** True when the variant or packaging row no longer exists / is archived. */
  missing: boolean;
}

function formatEuro(n: number): string {
  return new Intl.NumberFormat("de-AT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

export function VolumePlanning({ campaign, products }: Props) {
  const variants = useVariants();
  const variantPackagings = useAllVariantPackagings();
  const variantPackagingProducts = useAllVariantPackagingProducts();
  const packagings = usePackagingList(true);
  const productionOrders = useProductionOrders();
  const productionOrderItems = useAllProductionOrderItems();

  const variantById = useMemo(
    () => new Map(variants.map((v) => [v.id!, v])),
    [variants],
  );
  const packagingById = useMemo(
    () => new Map(packagings.map((p) => [p.id!, p])),
    [packagings],
  );
  const vpById = useMemo(
    () => new Map(variantPackagings.map((vp) => [vp.id!, vp])),
    [variantPackagings],
  );
  const productById = useMemo(
    () => new Map(products.map((p) => [p.id!, p])),
    [products],
  );

  // Per-vp composition: vpId → list of {productId, qty}
  const compositionByVp = useMemo(() => {
    const m = new Map<string, Array<{ productId: string; qty: number }>>();
    for (const r of variantPackagingProducts) {
      const list = m.get(r.variantPackagingId) ?? [];
      list.push({ productId: r.productId, qty: r.qty });
      m.set(r.variantPackagingId, list);
    }
    return m;
  }, [variantPackagingProducts]);

  function capacityOf(vpId: string): number {
    return (compositionByVp.get(vpId) ?? []).reduce((s, r) => s + r.qty, 0);
  }

  function buildRow(vpId: string, units: number): ResolvedRow {
    const vp = vpById.get(vpId);
    if (!vp) {
      return {
        vpId,
        variantName: `Missing variant size ${vpId.slice(0, 6)}`,
        packagingLabel: "",
        capacity: 0,
        units,
        unitPrice: 0,
        rowRevenue: 0,
        missing: true,
      };
    }
    const variant = variantById.get(vp.variantId);
    const packaging = vp.packagingId ? packagingById.get(vp.packagingId) : null;
    const cap = capacityOf(vpId);
    const price = vp.price ?? vp.sellPrice ?? 0;
    return {
      vpId,
      variantName: variant?.name ?? `SKU ${vp.variantId.slice(0, 6)}`,
      packagingLabel: packaging
        ? `${packaging.name}${cap > 0 ? ` · ${cap} pcs` : ""}`
        : cap > 0
          ? `Loose · ${cap} pcs`
          : "Loose",
      capacity: cap,
      units,
      unitPrice: price,
      rowRevenue: units * price,
      missing: !variant,
    };
  }

  // ─── View-mode rows (variant-size targets) ────────────────────────
  const rows = useMemo<ResolvedRow[]>(() => {
    const targets = campaign.variantPackagingTargets ?? {};
    return Object.entries(targets)
      .map(([vpId, units]) => buildRow(vpId, Number(units) || 0))
      .sort((a, b) => a.variantName.localeCompare(b.variantName));
  }, [campaign.variantPackagingTargets, vpById, variantById, packagingById, compositionByVp]);

  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const projectedRevenue = rows.reduce((s, r) => s + r.rowRevenue, 0);
  const revenueTarget =
    typeof campaign.revenueTarget === "number" ? campaign.revenueTarget : null;

  // Legacy product-level targets (read-only display when present + no
  // variant-level targets yet). Helps users see what they had before.
  const legacyProductTargets = campaign.productTargets ?? {};
  const hasLegacy = Object.keys(legacyProductTargets).length > 0;

  // ─── Edit mode state ─────────────────────────────────────────────
  const [editing, setEditing] = useState(false);
  const [draftTargets, setDraftTargets] = useState<Record<string, number>>({});
  const [draftRevenueTarget, setDraftRevenueTarget] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showProductExpansion, setShowProductExpansion] = useState(false);

  useEffect(() => {
    setDraftTargets({ ...(campaign.variantPackagingTargets ?? {}) });
    setDraftRevenueTarget(
      typeof campaign.revenueTarget === "number" ? String(campaign.revenueTarget) : "",
    );
  }, [campaign.variantPackagingTargets, campaign.revenueTarget, editing]);

  const draftRows = useMemo<ResolvedRow[]>(() => {
    return Object.entries(draftTargets)
      .map(([vpId, units]) => buildRow(vpId, Number(units) || 0))
      .sort((a, b) => a.variantName.localeCompare(b.variantName));
  }, [draftTargets, vpById, variantById, packagingById, compositionByVp]);

  const draftTotalUnits = draftRows.reduce((s, r) => s + r.units, 0);
  const draftProjected = draftRows.reduce((s, r) => s + r.rowRevenue, 0);
  const draftRevenueTargetNum = parseFloat(draftRevenueTarget);
  const draftRevenueTargetValid =
    draftRevenueTarget === "" ||
    (!Number.isNaN(draftRevenueTargetNum) && draftRevenueTargetNum >= 0);

  // Computed product expansion — sum (units × qty) per product across
  // all selected variant sizes. This is what the Production Order will
  // actually contain.
  const productExpansion = useMemo(() => {
    const sourceRows = editing ? draftRows : rows;
    const totals = new Map<string, number>();
    for (const r of sourceRows) {
      if (r.missing || r.units <= 0) continue;
      const comp = compositionByVp.get(r.vpId) ?? [];
      for (const c of comp) {
        const prev = totals.get(c.productId) ?? 0;
        totals.set(c.productId, prev + c.qty * r.units);
      }
    }
    return Array.from(totals.entries())
      .map(([productId, pieces]) => ({
        productId,
        productName: productById.get(productId)?.name ?? `SKU ${productId.slice(0, 6)}`,
        pieces,
      }))
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }, [editing, draftRows, rows, compositionByVp, productById]);

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
      for (const [vpId, n] of Object.entries(draftTargets)) {
        const v = Math.floor(Number(n) || 0);
        if (v > 0) cleaned[vpId] = v;
      }
      // Keep productIds in sync with the expansion so /campaigns
      // overview + replenishment scheduler still see this campaign as
      // covering the products they care about.
      const expandedProductIds = new Set<string>(campaign.productIds ?? []);
      for (const vpId of Object.keys(cleaned)) {
        const comp = compositionByVp.get(vpId) ?? [];
        for (const c of comp) expandedProductIds.add(c.productId);
      }
      const revTarget =
        draftRevenueTarget === "" ? undefined : Number(draftRevenueTargetNum);
      await saveCampaign({
        ...campaign,
        variantPackagingTargets: cleaned,
        productIds: Array.from(expandedProductIds),
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
  function setUnitsForVp(vpId: string, value: number) {
    setDraftTargets((cur) => ({ ...cur, [vpId]: Math.max(0, Math.floor(value || 0)) }));
  }
  function removeVpFromTargets(vpId: string) {
    if (!confirm(`Remove this variant size from the campaign target?`)) return;
    setDraftTargets((cur) => {
      const next = { ...cur };
      delete next[vpId];
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
    if (productExpansion.length === 0) {
      setPoError("Add at least one variant-size target before creating a Production Order.");
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
      // Persist the per-product piece totals (expansion of variant
      // selections × VariantPackagingProduct.qty).
      for (let i = 0; i < productExpansion.length; i++) {
        const p = productExpansion[i];
        await saveProductionOrderItem({
          productionOrderId: poId,
          productId: p.productId,
          targetUnits: p.pieces,
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

  // ─── Variant-size picker ─────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const vpsAvailable = useMemo(() => {
    const taken = new Set(Object.keys(draftTargets));
    return variantPackagings
      .filter((vp) => !taken.has(vp.id!))
      .filter((vp) => {
        const variant = variantById.get(vp.variantId);
        if (!variant) return false;
        // Hide variants whose sale window has ended.
        if (variant.endDate && variant.endDate < today) return false;
        return true;
      })
      .map((vp) => buildRow(vp.id!, 0))
      .sort((a, b) => {
        const v = a.variantName.localeCompare(b.variantName);
        return v !== 0 ? v : a.packagingLabel.localeCompare(b.packagingLabel);
      });
  }, [variantPackagings, draftTargets, variantById, packagingById, compositionByVp, today]);

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

  const totalPiecesForPo = productExpansion.reduce((s, p) => s + p.pieces, 0);

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
            Pick variant sizes (e.g. PB Cups · 1 cup of 15) → expands to product piece counts at PO creation.
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

      {/* Legacy productTargets banner — show only when there are
          legacy entries AND no new variant-size targets yet, so users
          know where their old data is and can migrate. */}
      {hasLegacy && rows.length === 0 && !editing && (
        <div
          style={{
            padding: "10px 20px",
            fontSize: 12,
            color: "var(--ds-text-muted)",
            background: "var(--ds-tint-info)",
            borderBottom: "0.5px solid var(--ds-border-warm)",
          }}
        >
          <strong style={{ color: "var(--ds-text-primary)" }}>Legacy product-level targets:</strong>{" "}
          {Object.entries(legacyProductTargets)
            .map(([pid, n]) => `${productById.get(pid)?.name ?? pid.slice(0, 6)}: ${n}`)
            .join(" · ")}
          . Click Edit mode to re-pick at variant-size level.
        </div>
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
          No variant-size targets yet.
          {editing && " Click \"+ Add variant size\" below."}
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
            <span>Variant size</span>
            <span style={{ textAlign: "right" }}>Units</span>
            <span style={{ textAlign: "right" }}>Price</span>
            <span style={{ textAlign: "right" }}>Revenue if sold</span>
            {editing && <span />}
          </div>
          {showRows.map((row) => (
            <div
              key={row.vpId}
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
                  display: "flex",
                  flexDirection: "column",
                  color: row.missing ? "var(--ds-tier-urgent)" : "var(--ds-text-primary)",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {row.missing && <IconAlertTriangle size={14} stroke={1.5} />}
                  {row.variantName}
                </span>
                <span
                  className="text-ds-meta"
                  style={{ fontSize: 11, fontStyle: "normal" }}
                >
                  {row.packagingLabel}
                </span>
              </span>
              {editing ? (
                <input
                  type="number"
                  min={0}
                  value={row.units}
                  onChange={(e) =>
                    setUnitsForVp(row.vpId, Number(e.target.value) || 0)
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
                    height: "fit-content",
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
                title={row.unitPrice <= 0 ? "No price set on this variant size" : undefined}
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
                  onClick={() => removeVpFromTargets(row.vpId)}
                  aria-label="remove variant size"
                  style={{
                    color: "var(--ds-text-muted)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                  title="Remove this variant size"
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
              <IconPlus size={14} stroke={1.5} /> Add variant size
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                onChange={(e) => {
                  const vpId = e.target.value;
                  if (!vpId) return;
                  setUnitsForVp(vpId, 1);
                  setPickerOpen(false);
                }}
                style={{
                  fontSize: 13,
                  padding: "4px 8px",
                  border: "0.5px solid var(--ds-border-warm)",
                  background: "var(--ds-card-bg)",
                  borderRadius: 4,
                  color: "var(--ds-text-primary)",
                  minWidth: 320,
                }}
                defaultValue=""
              >
                <option value="">— pick a variant size —</option>
                {vpsAvailable.map((row) => (
                  <option key={row.vpId} value={row.vpId}>
                    {row.variantName} · {row.packagingLabel}
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

      {/* Product expansion (read-only) — what the PO will actually contain */}
      {showRows.length > 0 && productExpansion.length > 0 && (
        <div style={{ borderTop: "0.5px solid var(--ds-border-warm)" }}>
          <button
            type="button"
            onClick={() => setShowProductExpansion((s) => !s)}
            style={{
              width: "100%",
              padding: "10px 20px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--ds-text-muted)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            {showProductExpansion ? (
              <IconChevronDown size={14} stroke={1.5} />
            ) : (
              <IconChevronRight size={14} stroke={1.5} />
            )}
            <span>
              Expands to <strong style={{ color: "var(--ds-text-primary)" }}>{totalPiecesForPo}</strong> product piece
              {totalPiecesForPo === 1 ? "" : "s"} across <strong style={{ color: "var(--ds-text-primary)" }}>{productExpansion.length}</strong> product
              {productExpansion.length === 1 ? "" : "s"}
            </span>
          </button>
          {showProductExpansion && (
            <div style={{ padding: "0 20px 12px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 110px",
                  gap: 8,
                  padding: "4px 0",
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--ds-text-muted)",
                  fontWeight: 600,
                }}
              >
                <span>Product</span>
                <span style={{ textAlign: "right" }}>Pieces</span>
              </div>
              {productExpansion.map((p) => (
                <div
                  key={p.productId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 110px",
                    gap: 8,
                    padding: "4px 0",
                    fontSize: 12,
                    borderTop: "0.5px solid var(--ds-border-warm)",
                  }}
                >
                  <span>{p.productName}</span>
                  <span
                    style={{
                      textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {p.pieces}
                  </span>
                </div>
              ))}
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
          <p className="text-ds-label">Total units (variant sizes)</p>
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
              {productExpansion.length === 0
                ? "Add at least one variant-size target to create a Production Order."
                : `Create a Production Order with ${totalPiecesForPo} piece${totalPiecesForPo === 1 ? "" : "s"} across ${productExpansion.length} product${productExpansion.length === 1 ? "" : "s"}. Open /plan?view=weekly → Regenerate to schedule the batches.`}
            </span>
            <button
              type="button"
              onClick={handleCreatePo}
              disabled={productExpansion.length === 0 || poBusy}
              style={{
                padding: "6px 14px",
                fontSize: 12,
                border: "0.5px solid var(--ds-tier-quarter-focus)",
                background: "var(--ds-tier-quarter-focus)",
                color: "#ffffff",
                borderRadius: 4,
                opacity: productExpansion.length === 0 || poBusy ? 0.55 : 1,
                cursor: productExpansion.length === 0 || poBusy ? "not-allowed" : "pointer",
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
