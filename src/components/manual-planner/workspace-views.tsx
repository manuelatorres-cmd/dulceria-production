"use client";

/**
 * 4-tab demand workspace per MANUAL_PLANNER_WORKSPACE_BATCH.md §3.1.
 *
 * - DemandViewSwitcher renders the 4 tabs and persists the active
 *   view to localStorage (`dulceria.manual-planner.view.v1`).
 * - ProductView wraps the existing DemandPicker (no behaviour change).
 * - CampaignView groups by `productionOrders.campaignId` + a "no
 *   campaign" bucket; checkboxes per product + Build button drives
 *   `buildDraftsFromCampaign`.
 * - MouldView groups by `defaultMouldId.numberOfCavities`; banner
 *   above each group shows total demand + mould-fill minimum + surplus.
 * - CustomerView groups by `orders.customerName + orders.eventName`;
 *   isolated flag shows a badge.
 */

import { useEffect, useMemo, useState } from "react";
import type { ProductDemand } from "@/lib/manual-planner/aggregate-demand";
import type { SmartSuggestion } from "@/lib/manual-planner/smart-suggestions";
import type {
  Campaign,
  Order,
  OrderItem,
  Product,
  ProductionOrder,
  ProductionOrderItem,
  Mould,
} from "@/types";
import { DemandPicker } from "./demand-picker/demand-picker";
import { buildDraftsFromCampaign } from "@/lib/manual-planner/build-drafts-from-campaign";

const STORAGE_KEY = "dulceria.manual-planner.view.v1";

export type WorkspaceView = "product" | "campaign" | "mould" | "customer";

const VALID: WorkspaceView[] = ["product", "campaign", "mould", "customer"];

export function loadWorkspaceView(): WorkspaceView {
  if (typeof window === "undefined") return "product";
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw && (VALID as string[]).includes(raw)) return raw as WorkspaceView;
  } catch {
    /* ignore */
  }
  return "product";
}

function saveWorkspaceView(v: WorkspaceView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, v);
  } catch {
    /* ignore */
  }
}

const TAB_LABELS: Record<WorkspaceView, string> = {
  product: "By product",
  campaign: "By campaign",
  mould: "By mould",
  customer: "By customer",
};

export function DemandViewSwitcher({
  active,
  onChange,
  counts,
}: {
  active: WorkspaceView;
  onChange: (v: WorkspaceView) => void;
  counts: Record<WorkspaceView, number>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Demand workspace views"
      style={{
        display: "flex",
        gap: 4,
        padding: "8px 12px",
        borderBottom: "1px solid var(--mp-border-warm)",
        background: "var(--mp-page-bg)",
      }}
    >
      {VALID.map((v) => {
        const isActive = v === active;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(v)}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: isActive ? 700 : 500,
              borderRadius: 6,
              border: "1px solid transparent",
              background: isActive ? "var(--mp-teal, #1c5651)" : "transparent",
              color: isActive ? "#fff" : "var(--mp-text-primary)",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontFamily: "inherit",
            }}
          >
            <span>{TAB_LABELS[v]}</span>
            <span
              className="tabular-nums"
              style={{
                fontSize: 10,
                padding: "0 5px",
                borderRadius: 8,
                background: isActive ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.08)",
                fontWeight: 600,
              }}
            >
              {counts[v]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Wraps DemandPicker — no behavioural change. */
export function ProductView(props: React.ComponentProps<typeof DemandPicker>) {
  return <DemandPicker {...props} />;
}

// ─── Campaign view ─────────────────────────────────────────────────

export function CampaignView({
  campaigns,
  productionOrders,
  productionOrderItems,
  products,
  productDemands,
}: {
  campaigns: Campaign[];
  productionOrders: ProductionOrder[];
  productionOrderItems: ProductionOrderItem[];
  products: Product[];
  productDemands: ProductDemand[];
}) {
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const demandByProduct = useMemo(
    () => new Map(productDemands.map((p) => [p.productId, p])),
    [productDemands],
  );

  const groups = useMemo(() => {
    type CampaignGroup = {
      campaign: Campaign | null;
      lineItems: Array<{ productId: string; productName: string; targetUnits: number; dueDate: string | null }>;
    };
    const byCampaign = new Map<string, CampaignGroup>();
    const ensure = (c: Campaign | null): CampaignGroup => {
      const key = c?.id ?? "none";
      const existing = byCampaign.get(key);
      if (existing) return existing;
      const fresh: CampaignGroup = { campaign: c, lineItems: [] };
      byCampaign.set(key, fresh);
      return fresh;
    };
    const campaignById = new Map(campaigns.map((c) => [c.id!, c]));
    const poById = new Map(productionOrders.map((p) => [p.id!, p]));
    // Aggregate items per (campaignId, productId)
    const acc = new Map<string, { campaign: Campaign | null; productId: string; target: number; due: string | null }>();
    for (const item of productionOrderItems) {
      const po = poById.get(item.productionOrderId);
      if (!po) continue;
      const campaign = po.campaignId ? campaignById.get(po.campaignId) ?? null : null;
      const k = `${campaign?.id ?? "none"}|${item.productId}`;
      const cur = acc.get(k);
      const due = po.dueDate ? String(po.dueDate).slice(0, 10) : null;
      if (cur) {
        cur.target += item.targetUnits ?? 0;
        if (due && (!cur.due || due < cur.due)) cur.due = due;
      } else {
        acc.set(k, { campaign, productId: item.productId, target: item.targetUnits ?? 0, due });
      }
    }
    for (const entry of acc.values()) {
      const product = productById.get(entry.productId);
      const productName = product?.name ?? entry.productId.slice(0, 8);
      ensure(entry.campaign).lineItems.push({
        productId: entry.productId,
        productName,
        targetUnits: entry.target,
        dueDate: entry.due,
      });
    }
    const out = Array.from(byCampaign.values()).sort((a, b) => {
      if (a.campaign && !b.campaign) return -1;
      if (!a.campaign && b.campaign) return 1;
      const dueA = a.campaign?.startDate ?? "9999";
      const dueB = b.campaign?.startDate ?? "9999";
      return dueA.localeCompare(dueB);
    });
    for (const g of out) g.lineItems.sort((a, b) => a.productName.localeCompare(b.productName));
    return out;
  }, [campaigns, productionOrders, productionOrderItems, productById]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Map<string, Set<string>>>(new Map());
  const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function toggleCampaign(key: string): void {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else {
        next.add(key);
        // Default all checked.
        const g = groups.find((gg) => (gg.campaign?.id ?? "none") === key);
        if (g) {
          setSelected((sel) => {
            const ns = new Map(sel);
            ns.set(key, new Set(g.lineItems.map((li) => li.productId)));
            return ns;
          });
        }
      }
      return next;
    });
  }

  function toggleProduct(campaignKey: string, productId: string): void {
    setSelected((sel) => {
      const ns = new Map(sel);
      const set = new Set(ns.get(campaignKey) ?? []);
      if (set.has(productId)) set.delete(productId);
      else set.add(productId);
      ns.set(campaignKey, set);
      return ns;
    });
  }

  async function handleBuild(g: typeof groups[number]): Promise<void> {
    if (!g.campaign?.id) {
      setToast("Loose-demand bucket can't be built in bulk — use product view.");
      return;
    }
    const key = g.campaign.id;
    const picks = [...(selected.get(key) ?? [])];
    if (picks.length === 0) {
      setToast("Select at least one product first.");
      return;
    }
    setBusyCampaignId(key);
    try {
      const res = await buildDraftsFromCampaign(key, picks);
      const summary: string[] = [];
      if (res.built.length > 0) summary.push(`Built ${res.built.length} draft${res.built.length === 1 ? "" : "s"}`);
      for (const s of res.skipped) summary.push(`Skipped ${s.productName} (${s.reason})`);
      setToast(summary.join(" · ") || "Nothing changed.");
    } catch (err) {
      setToast(`Build failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyCampaignId(null);
    }
  }

  return (
    <div style={{ background: "var(--mp-card-bg)", border: "1px solid var(--mp-border-warm)", borderRadius: 10, overflow: "hidden" }}>
      {toast ? (
        <div
          style={{
            padding: "8px 14px",
            fontSize: 12,
            background: "var(--mp-today-tint)",
            borderBottom: "1px solid var(--mp-border-warm)",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span style={{ flex: 1 }}>{toast}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              opacity: 0.7,
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {groups.length === 0 ? (
        <p style={{ padding: 18, fontStyle: "italic", color: "var(--mp-text-muted)", fontSize: 12 }}>
          No campaigns with open demand.
        </p>
      ) : (
        groups.map((g) => {
          const key = g.campaign?.id ?? "none";
          const isOpen = expanded.has(key);
          const totalUnits = g.lineItems.reduce((s, li) => s + li.targetUnits, 0);
          const dueLabel = g.campaign?.startDate
            ? new Date(g.campaign.startDate).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
            : null;
          return (
            <div key={key} style={{ borderBottom: "1px solid var(--mp-border-warm)" }}>
              <button
                type="button"
                onClick={() => toggleCampaign(key)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  background: "var(--mp-page-bg)",
                  border: "none",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ fontSize: 11, opacity: 0.5 }}>{isOpen ? "▾" : "▸"}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>
                  {g.campaign ? g.campaign.name : "No campaign"}
                </span>
                <span style={{ fontSize: 11, color: "var(--mp-text-muted)" }}>
                  · {g.lineItems.length} product{g.lineItems.length === 1 ? "" : "s"} · {totalUnits} pcs
                  {dueLabel ? ` · starts ${dueLabel}` : ""}
                </span>
              </button>
              {isOpen ? (
                <div style={{ padding: 8 }}>
                  {g.lineItems.map((li) => {
                    const sel = selected.get(key) ?? new Set<string>();
                    const isPicked = sel.has(li.productId);
                    const demand = demandByProduct.get(li.productId);
                    const inDraft = (demand?.draftCount ?? 0) > 0;
                    return (
                      <label
                        key={li.productId}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "20px 1fr 90px 90px",
                          gap: 8,
                          alignItems: "center",
                          padding: "5px 8px",
                          fontSize: 12.5,
                          cursor: "pointer",
                          borderRadius: 4,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isPicked}
                          onChange={() => toggleProduct(key, li.productId)}
                        />
                        <span style={{ fontWeight: 500 }}>
                          {li.productName}
                          {inDraft ? (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                padding: "1px 5px",
                                borderRadius: 3,
                                background: "rgba(0,0,0,0.06)",
                                color: "var(--mp-text-muted)",
                              }}
                            >
                              in draft{(demand?.draftCount ?? 0) > 1 ? ` × ${demand!.draftCount}` : ""}
                            </span>
                          ) : null}
                        </span>
                        <span className="tabular-nums" style={{ textAlign: "right", color: "var(--mp-text-muted)" }}>
                          {li.targetUnits} pcs
                        </span>
                        <span style={{ fontSize: 11, color: "var(--mp-text-muted)" }}>
                          {li.dueDate ?? "—"}
                        </span>
                      </label>
                    );
                  })}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      padding: "8px 4px 2px",
                      borderTop: "1px solid var(--mp-border-warm)",
                      marginTop: 4,
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <span style={{ fontSize: 11, color: "var(--mp-text-muted)" }}>
                      {(selected.get(key)?.size ?? 0)} selected
                    </span>
                    <button
                      type="button"
                      disabled={busyCampaignId === key || !g.campaign?.id || (selected.get(key)?.size ?? 0) === 0}
                      onClick={() => { void handleBuild(g); }}
                      style={{
                        padding: "4px 12px",
                        background: "var(--mp-teal)",
                        color: "#fff",
                        border: "none",
                        borderRadius: 5,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: busyCampaignId === key ? "wait" : "pointer",
                        opacity: (selected.get(key)?.size ?? 0) === 0 ? 0.5 : 1,
                        fontFamily: "inherit",
                      }}
                    >
                      {busyCampaignId === key ? "Building…" : `Build ${(selected.get(key)?.size ?? 0)} draft${(selected.get(key)?.size ?? 0) === 1 ? "" : "s"}`}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Mould view ────────────────────────────────────────────────────

export function MouldView({
  productDemands,
  moulds,
  onPickOrderLine,
  onPickPoLine,
  draftProductId,
}: {
  productDemands: ProductDemand[];
  moulds: Mould[];
  onPickOrderLine: (args: { orderItemId: string; productId: string; qty: number; customerName: string }) => void;
  onPickPoLine: (args: { poItemId: string; productId: string; qty: number; poName: string }) => void;
  draftProductId: string | null;
}) {
  const groups = useMemo(() => {
    const byCavities = new Map<number, ProductDemand[]>();
    for (const p of productDemands) {
      const cav = p.numberOfCavities || 0;
      const arr = byCavities.get(cav) ?? [];
      arr.push(p);
      byCavities.set(cav, arr);
    }
    const list = Array.from(byCavities.entries()).map(([cav, items]) => ({
      cavities: cav,
      items: items.sort((a, b) => b.totalDemand - a.totalDemand),
    }));
    list.sort((a, b) => a.cavities - b.cavities);
    return list;
  }, [productDemands]);

  return (
    <div style={{ background: "var(--mp-card-bg)", border: "1px solid var(--mp-border-warm)", borderRadius: 10, overflow: "hidden" }}>
      {groups.length === 0 ? (
        <p style={{ padding: 18, fontStyle: "italic", color: "var(--mp-text-muted)", fontSize: 12 }}>
          No demand to group.
        </p>
      ) : (
        groups.map((g) => {
          const totalDemand = g.items.reduce((s, p) => s + p.totalDemand, 0);
          const mouldFills = g.cavities > 0 ? Math.ceil(totalDemand / g.cavities) : 0;
          const surplus = mouldFills * g.cavities - totalDemand;
          return (
            <div key={g.cavities} style={{ borderBottom: "1px solid var(--mp-border-warm)" }}>
              <div
                style={{
                  padding: "10px 14px",
                  background: "var(--mp-page-bg)",
                  fontSize: 12,
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontWeight: 700 }}>{g.cavities}-cav mould bucket</span>
                <span style={{ color: "var(--mp-text-muted)" }}>·</span>
                <span className="tabular-nums">{g.items.length} products</span>
                <span style={{ color: "var(--mp-text-muted)" }}>·</span>
                <span className="tabular-nums">{totalDemand} pcs demand</span>
                <span style={{ color: "var(--mp-text-muted)" }}>·</span>
                <span className="tabular-nums">{mouldFills} mould fills minimum</span>
                {surplus > 0 ? (
                  <>
                    <span style={{ color: "var(--mp-text-muted)" }}>·</span>
                    <span
                      className="tabular-nums"
                      style={{ color: "var(--mp-rose, #993556)", fontWeight: 600 }}
                    >
                      {surplus} cavities surplus
                    </span>
                  </>
                ) : null}
              </div>
              <div>
                {g.items.map((p) => (
                  <MouldProductRow
                    key={p.productId}
                    product={p}
                    inDraft={draftProductId === p.productId}
                    onPickOrderLine={onPickOrderLine}
                    onPickPoLine={onPickPoLine}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function MouldProductRow({
  product,
  inDraft,
  onPickOrderLine,
  onPickPoLine,
}: {
  product: ProductDemand;
  inDraft: boolean;
  onPickOrderLine: (args: { orderItemId: string; productId: string; qty: number; customerName: string }) => void;
  onPickPoLine: (args: { poItemId: string; productId: string; qty: number; poName: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: "1px solid var(--mp-border-warm)" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          padding: "7px 14px",
          background: inDraft ? "var(--mp-draft-tint)" : "transparent",
          border: "none",
          borderLeft: inDraft ? "3px solid var(--mp-draft-border)" : "3px solid transparent",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 12.5,
        }}
      >
        <span style={{ fontSize: 11, opacity: 0.5 }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontWeight: 600, flex: 1 }}>{product.productName}</span>
        <span className="tabular-nums" style={{ fontWeight: 600 }}>
          {product.totalDemand} <span style={{ color: "var(--mp-text-muted)", fontWeight: 400 }}>pcs</span>
        </span>
        {product.draftCount > 0 ? (
          <span
            style={{
              fontSize: 10,
              padding: "1px 5px",
              borderRadius: 3,
              background: "rgba(0,0,0,0.06)",
              color: "var(--mp-text-muted)",
            }}
          >
            {inDraft ? "editing" : `in draft × ${product.draftCount}`}
          </span>
        ) : null}
      </button>
      {open ? (
        <div style={{ padding: "4px 14px 8px 38px" }}>
          {product.orderItems.length === 0 && product.poItems.length === 0 ? (
            <p style={{ fontSize: 11.5, fontStyle: "italic", color: "var(--mp-text-muted)" }}>
              No open lines.
            </p>
          ) : null}
          {product.orderItems.map((l) => (
            <button
              key={l.orderItemId}
              type="button"
              onClick={() =>
                onPickOrderLine({
                  orderItemId: l.orderItemId,
                  productId: product.productId,
                  qty: l.remaining,
                  customerName: l.customerName,
                })
              }
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 60px 80px",
                gap: 8,
                width: "100%",
                padding: "3px 0",
                fontSize: 11.5,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <span>{l.customerName} <span style={{ color: "var(--mp-text-muted)" }}>· {l.channel}</span></span>
              <span className="tabular-nums" style={{ color: "var(--mp-text-muted)", textAlign: "right" }}>
                {l.remaining} pcs
              </span>
              <span className="tabular-nums" style={{ color: "var(--mp-text-muted)" }}>
                {l.dueDate ? l.dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
              </span>
            </button>
          ))}
          {product.poItems.map((l) => (
            <button
              key={l.poItemId}
              type="button"
              onClick={() =>
                onPickPoLine({
                  poItemId: l.poItemId,
                  productId: product.productId,
                  qty: l.remaining,
                  poName: l.poName,
                })
              }
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 60px 80px",
                gap: 8,
                width: "100%",
                padding: "3px 0",
                fontSize: 11.5,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <span>{l.poName} <span style={{ color: "var(--mp-text-muted)" }}>· {l.channel}</span></span>
              <span className="tabular-nums" style={{ color: "var(--mp-text-muted)", textAlign: "right" }}>
                {l.remaining} pcs
              </span>
              <span className="tabular-nums" style={{ color: "var(--mp-text-muted)" }}>
                {l.dueDate ? l.dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ─── Customer view ─────────────────────────────────────────────────

export function CustomerView({
  orders,
  orderItems,
  products,
  productDemands,
  onPickOrderLine,
  onIsolatedClick,
}: {
  orders: Order[];
  orderItems: OrderItem[];
  products: Product[];
  productDemands: ProductDemand[];
  onPickOrderLine: (args: { orderItemId: string; productId: string; qty: number; customerName: string }) => void;
  onIsolatedClick: (customerLabel: string) => void;
}) {
  const productById = useMemo(() => new Map(products.map((p) => [p.id!, p])), [products]);
  const demandByProduct = useMemo(
    () => new Map(productDemands.map((p) => [p.productId, p])),
    [productDemands],
  );
  const openOrderStatuses = new Set(["pending", "in_production", "ready_to_pack"]);

  const groups = useMemo(() => {
    type CustomerGroup = {
      key: string;
      label: string;
      isolated: boolean;
      items: Array<{
        orderItemId: string;
        productId: string;
        productName: string;
        qty: number;
        dueDate: string | null;
        orderId: string;
      }>;
    };
    const byKey = new Map<string, CustomerGroup>();
    for (const order of orders) {
      if (!openOrderStatuses.has(order.status)) continue;
      const label = order.customerName || order.eventName || order.sourceRef || "Anonymous";
      const key = label;
      const group = byKey.get(key) ?? {
        key,
        label,
        isolated: !!order.isolated,
        items: [],
      };
      if (order.isolated) group.isolated = true;
      byKey.set(key, group);
    }
    for (const it of orderItems) {
      const order = orders.find((o) => o.id === it.orderId);
      if (!order || !openOrderStatuses.has(order.status)) continue;
      if (it.variantId) continue; // variant lines deferred
      const label = order.customerName || order.eventName || order.sourceRef || "Anonymous";
      const group = byKey.get(label);
      if (!group) continue;
      const product = productById.get(it.productId);
      group.items.push({
        orderItemId: it.id!,
        productId: it.productId,
        productName: product?.name ?? it.productId.slice(0, 8),
        qty: it.quantity,
        dueDate: order.deadline ? new Date(order.deadline).toISOString().slice(0, 10) : null,
        orderId: order.id!,
      });
    }
    const list = Array.from(byKey.values()).filter((g) => g.items.length > 0);
    list.sort((a, b) => a.label.localeCompare(b.label));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, orderItems, productById]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(key: string): void {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div style={{ background: "var(--mp-card-bg)", border: "1px solid var(--mp-border-warm)", borderRadius: 10, overflow: "hidden" }}>
      {groups.length === 0 ? (
        <p style={{ padding: 18, fontStyle: "italic", color: "var(--mp-text-muted)", fontSize: 12 }}>
          No customer-side demand.
        </p>
      ) : (
        groups.map((g) => {
          const isOpen = expanded.has(g.key);
          return (
            <div key={g.key} style={{ borderBottom: "1px solid var(--mp-border-warm)" }}>
              <button
                type="button"
                onClick={() => toggle(g.key)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  background: "var(--mp-page-bg)",
                  border: "none",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <span style={{ fontSize: 11, opacity: 0.5 }}>{isOpen ? "▾" : "▸"}</span>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{g.label}</span>
                {g.isolated ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "1px 6px",
                      borderRadius: 3,
                      background: "var(--mp-rose, #993556)",
                      color: "#fff",
                      letterSpacing: 0.4,
                    }}
                  >
                    ISOLATED
                  </span>
                ) : null}
                <span style={{ fontSize: 11, color: "var(--mp-text-muted)" }}>
                  · {g.items.length} line{g.items.length === 1 ? "" : "s"}
                </span>
              </button>
              {isOpen ? (
                <div style={{ padding: 8 }}>
                  {g.items.map((it) => {
                    const demand = demandByProduct.get(it.productId);
                    return (
                      <button
                        key={it.orderItemId}
                        type="button"
                        onClick={() => {
                          if (g.isolated) onIsolatedClick(g.label);
                          onPickOrderLine({
                            orderItemId: it.orderItemId,
                            productId: it.productId,
                            qty: it.qty,
                            customerName: g.label,
                          });
                        }}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "20px 1fr 70px 80px",
                          gap: 8,
                          width: "100%",
                          padding: "5px 8px",
                          fontSize: 12.5,
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          textAlign: "left",
                          borderRadius: 4,
                          fontFamily: "inherit",
                        }}
                      >
                        <input type="checkbox" readOnly checked={false} aria-hidden />
                        <span>
                          {it.productName}
                          {(demand?.draftCount ?? 0) > 0 ? (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: 10,
                                padding: "1px 5px",
                                borderRadius: 3,
                                background: "rgba(0,0,0,0.06)",
                                color: "var(--mp-text-muted)",
                              }}
                            >
                              in draft × {demand!.draftCount}
                            </span>
                          ) : null}
                        </span>
                        <span className="tabular-nums" style={{ color: "var(--mp-text-muted)", textAlign: "right" }}>
                          {it.qty} pcs
                        </span>
                        <span className="tabular-nums" style={{ color: "var(--mp-text-muted)" }}>
                          {it.dueDate ?? "—"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Combined wrapper that remembers the active view ───────────────

export function useWorkspaceView(): [WorkspaceView, (v: WorkspaceView) => void] {
  const [view, setView] = useState<WorkspaceView>("product");
  useEffect(() => {
    setView(loadWorkspaceView());
  }, []);
  function set(v: WorkspaceView): void {
    setView(v);
    saveWorkspaceView(v);
  }
  return [view, set];
}
