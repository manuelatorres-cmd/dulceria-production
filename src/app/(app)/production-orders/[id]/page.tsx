"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import {
  useProductionOrder,
  useProductionOrders,
  useProductionOrderItems,
  saveProductionOrder,
  deleteProductionOrder,
  saveProductionOrderItem,
  deleteProductionOrderItem,
  useProductsList,
  useCampaigns,
  useProductCategories,
  useProductionPlans,
  useAllProductionDayLineItems,
  useProductionDays,
  useAllPlanStepStatuses,
  markProductionOrderDone,
} from "@/lib/hooks";
import {
  PRODUCTION_ORDER_STATUSES,
  type ProductionOrderChannel,
  type ProductionOrderStatus,
} from "@/types";
import { DetailNav } from "@/components/detail-nav";

export default function ProductionOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const id = decodeURIComponent(idStr);
  const router = useRouter();
  const order = useProductionOrder(id);
  const items = useProductionOrderItems(id);
  const allOrders = useProductionOrders();
  const products = useProductsList();
  const campaigns = useCampaigns();
  const productCategoriesForPicker = useProductCategories(false);
  const allPlans = useProductionPlans();
  const allLineItems = useAllProductionDayLineItems();
  const productionDays = useProductionDays(120);
  const allStepStatuses = useAllPlanStepStatuses();

  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<ProductionOrderStatus>("pending");
  const [channel, setChannel] = useState<ProductionOrderChannel>("restock");
  const [campaignId, setCampaignId] = useState<string>("");
  const [targetLocation, setTargetLocation] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!order) return;
    setName(order.name ?? "");
    setDueDate(order.dueDate);
    setStatus(order.status);
    setChannel(order.channel);
    setCampaignId(order.campaignId ?? "");
    setTargetLocation(order.targetLocation ?? "");
    setNotes(order.notes ?? "");
  }, [order]);

  if (!order) {
    return <div className="p-12 text-center text-muted-foreground">Loading…</div>;
  }

  async function save() {
    if (!order) return;
    setSaving(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await saveProductionOrder({
        id: order.id,
        name: name.trim() || "Untitled",
        dueDate: dueDate || today,
        status,
        channel,
        campaignId: channel === "campaign_run" ? (campaignId || null) : null,
        targetLocation: targetLocation || null,
        notes: notes.trim() || null,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function cancelEdit() {
    if (order) {
      setName(order.name ?? "");
      setDueDate(order.dueDate);
      setStatus(order.status as ProductionOrderStatus);
      setChannel((order.channel ?? "restock") as ProductionOrderChannel);
      setCampaignId(order.campaignId ?? "");
      setTargetLocation(order.targetLocation ?? "");
      setNotes(order.notes ?? "");
    }
    setEditing(false);
  }

  async function doDelete() {
    if (!order?.id) return;
    await deleteProductionOrder(order.id);
    router.replace("/production-orders");
  }

  async function addProductLine(productId: string) {
    if (!order?.id) return;
    await saveProductionOrderItem({
      productionOrderId: order.id,
      productId,
      targetUnits: 1,
      sortOrder: items.length,
      notes: null,
    });
  }

  async function updateLine(itemId: string, patch: { targetUnits?: number; productId?: string }) {
    const it = items.find((i) => i.id === itemId);
    if (!it) return;
    await saveProductionOrderItem({
      ...it,
      ...patch,
    });
  }

  return (
    <div className="px-6 sm:px-10 pt-6 pb-12 max-w-[1500px] mx-auto">
      <div className="space-y-2 mb-3">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <DetailNav
          items={[...allOrders].sort((a, b) => a.dueDate.localeCompare(b.dueDate))}
          currentId={id}
          hrefFor={(o) => `/production-orders/${encodeURIComponent(o.id!)}`}
          labelFor={(o) => o.name || o.dueDate}
        />
      </div>

      <div className="flex items-baseline justify-between gap-3 mb-4 flex-wrap">
        <h1
          className="text-[26px] tracking-[-0.025em]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 400 }}
        >
          {name || "Untitled"}
        </h1>
        {order.name && (
          <Link
            href={`/plan?focus=po:${encodeURIComponent(order.name)}`}
            className="text-[11.5px] px-3 py-1 rounded-full bg-[#f6c6cb] text-[#6e2b32] font-medium hover:bg-[#f0b3ba]"
          >
            Plan this in /plan →
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
        {/* Main fields */}
        <section className="space-y-3 rounded-[14px] border border-border bg-card/80 p-4">
          <div className="flex justify-end items-center gap-1.5 -mb-1">
            {editing ? (
              <>
                <button onClick={save} disabled={saving} className="rounded-full bg-foreground text-background px-3 py-1 text-[11.5px] font-medium disabled:opacity-50">
                  {saving ? "Saving…" : "Save"}
                </button>
                <button onClick={cancelEdit} className="rounded-full border border-border px-3 py-1 text-[11.5px]">
                  Cancel
                </button>
              </>
            ) : (
              <>
                {status !== "done" && order.id && (
                  <button
                    onClick={async () => {
                      if (!confirm("Mark this Production Order as done?")) return;
                      try { await markProductionOrderDone(order.id!); }
                      catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
                    }}
                    className="rounded-full bg-[#eff3ec] text-[#5c7050] border border-[#cfe5d9] px-3 py-1 text-[11.5px] font-medium hover:bg-[#e6ede0]"
                  >
                    Mark done
                  </button>
                )}
                <button onClick={() => setEditing(true)} className="rounded-full border border-border px-3 py-1 text-[11.5px] hover:border-foreground">
                  Edit
                </button>
              </>
            )}
          </div>

          <Field label="Name">
            {editing ? (
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            ) : (
              <p className="text-[14px]" style={{ fontFamily: "var(--font-serif)", fontWeight: 500 }}>{name || "—"}</p>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Due date">
              {editing ? (
                <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              ) : (
                <p className="text-[13px] tabular-nums">{dueDate ? new Date(dueDate).toLocaleDateString("de-AT") : "—"}</p>
              )}
            </Field>
            <Field label="Status">
              {editing ? (
                <select
                  className="input"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProductionOrderStatus)}
                >
                  {PRODUCTION_ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>{s.replace("_", " ")}</option>
                  ))}
                </select>
              ) : (
                <p className="text-[13px] capitalize">{status.replace("_", " ")}</p>
              )}
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Channel">
              {editing ? (
                <select
                  className="input"
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as ProductionOrderChannel)}
                >
                  <option value="restock">Restock</option>
                  <option value="campaign_run">Campaign run</option>
                </select>
              ) : (
                <p className="text-[13px] capitalize">{channel.replace("_", " ")}</p>
              )}
            </Field>
            <Field label="Target location (optional)">
              {editing ? (
                <select
                  className="input"
                  value={targetLocation}
                  onChange={(e) => setTargetLocation(e.target.value)}
                >
                  <option value="">— default —</option>
                  <option value="store">Shop store</option>
                  <option value="production">Production</option>
                  <option value="storage">Storage</option>
                </select>
              ) : (
                <p className="text-[13px] capitalize">{targetLocation || "default"}</p>
              )}
            </Field>
          </div>

          {channel === "campaign_run" && (
            <Field label="Campaign">
              {editing ? (
                <select
                  className="input"
                  value={campaignId}
                  onChange={(e) => setCampaignId(e.target.value)}
                >
                  <option value="">— pick a campaign —</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              ) : (
                <p className="text-[13px]">{campaigns.find((c) => c.id === campaignId)?.name ?? "—"}</p>
              )}
            </Field>
          )}

          <Field label="Notes">
            {editing ? (
              <textarea
                className="input resize-none"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            ) : (
              <p className="text-[13px] whitespace-pre-wrap text-muted-foreground">{notes || "—"}</p>
            )}
          </Field>

          <div className="flex justify-between items-center pt-2 border-t border-border">
            <span />
            {confirmDelete ? (
              <span className="flex items-center gap-2 text-[11.5px]">
                <span className="text-muted-foreground">Delete?</span>
                <button
                  onClick={doDelete}
                  className="text-destructive font-medium hover:underline"
                >
                  Yes
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-muted-foreground hover:underline">
                  Cancel
                </button>
              </span>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-[11px] uppercase text-muted-foreground hover:text-destructive"
                style={{ letterSpacing: "0.1em" }}
              >
                Delete
              </button>
            )}
          </div>
        </section>

        {/* Items */}
        <aside className="rounded-[14px] border border-border bg-card/80 p-4">
          <h3
            className="text-[13px] mb-2"
            style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
          >
            Products
            <span className="ml-2 text-[10px] text-muted-foreground uppercase font-normal" style={{ letterSpacing: "0.12em" }}>
              {items.length}
            </span>
          </h3>
          <p className="text-[11px] text-muted-foreground mb-3">
            Add each product the workshop should produce.
          </p>

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground italic mb-3">No products yet.</p>
          ) : !editing ? (
            <ul className="space-y-1 mb-3">
              {items.map((it) => {
                const product = products.find((p) => p.id === it.productId);
                return (
                  <li
                    key={it.id}
                    className="flex items-baseline justify-between gap-2 rounded-[10px] border border-border bg-muted/30 px-3 py-1.5"
                  >
                    <span style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 13.5 }}>
                      {product?.name ?? "—"}
                    </span>
                    <span className="tabular-nums" style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 14 }}>
                      {it.targetUnits} pcs
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="space-y-1.5 mb-3">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="grid items-center gap-2 rounded-[10px] border border-border bg-muted/30 px-3 py-2"
                  style={{ gridTemplateColumns: "1fr 110px 32px" }}
                >
                  <select
                    value={it.productId}
                    onChange={(e) => updateLine(it.id!, { productId: e.target.value })}
                    className="input text-base w-full"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={it.targetUnits}
                    onChange={(e) => updateLine(it.id!, { targetUnits: parseInt(e.target.value) || 0 })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const next = document.getElementById("po-add-product-select") as HTMLSelectElement | null;
                        if (next) next.focus();
                      }
                    }}
                    className="input text-base text-right tabular-nums w-full"
                    placeholder="qty"
                  />
                  <button
                    onClick={() => deleteProductionOrderItem(it.id!)}
                    aria-label="Remove"
                    className="text-muted-foreground hover:text-destructive flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {editing && (
            <ProductPicker
              products={products}
              excludedIds={items.map((i) => i.productId)}
              categories={productCategoriesForPicker}
              onPick={(pid) => addProductLine(pid)}
            />
          )}
        </aside>
      </div>

      {/* Linked batches — productionPlans the brain spawned from this PO.
          Match by name prefix (`PO: <po name> — `) since plans store the
          parent linkage in their name field. */}
      <LinkedBatches
        poName={order.name ?? ""}
        plans={allPlans}
        lineItems={allLineItems}
        productionDays={productionDays}
        stepStatuses={allStepStatuses}
      />
    </div>
  );
}

function LinkedBatches({
  poName, plans, lineItems, productionDays, stepStatuses,
}: {
  poName: string;
  plans: import("@/types").ProductionPlan[];
  lineItems: import("@/types").ProductionDayLineItem[];
  productionDays: import("@/types").ProductionDay[];
  stepStatuses: import("@/types").PlanStepStatus[];
}) {
  if (!poName) return null;
  const prefix = `PO: ${poName} — `;
  const linked = plans.filter((p) =>
    (p.name ?? "").startsWith(prefix)
    && p.status !== "cancelled"
    && p.status !== "orphaned",
  );
  if (linked.length === 0) {
    return (
      <section className="mt-4 rounded-[14px] border border-border bg-card/80 p-4">
        <h3
          className="text-[13px] mb-1.5"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
        >
          Linked batches
          <span className="ml-2 text-[10px] text-muted-foreground uppercase font-normal" style={{ letterSpacing: "0.12em" }}>
            0
          </span>
        </h3>
        <p className="text-[11.5px] text-muted-foreground italic">
          No batches yet. Run <strong className="text-foreground">Regenerate plan</strong> on /plan to spawn them from this PO.
        </p>
      </section>
    );
  }

  // Lookup the day each plan's lineItem currently sits on.
  const dayById = new Map(productionDays.map((d) => [d.id!, d]));
  const dayByPlan = new Map<string, string>();
  for (const li of lineItems) {
    const day = dayById.get(li.productionDayId);
    if (!day) continue;
    const cur = dayByPlan.get(li.planId);
    // Earliest day wins if a plan spans multiple.
    if (!cur || day.date < cur) dayByPlan.set(li.planId, day.date);
  }
  const doneStepCount = new Map<string, number>();
  for (const s of stepStatuses) {
    if (!s.done) continue;
    doneStepCount.set(s.planId, (doneStepCount.get(s.planId) ?? 0) + 1);
  }

  return (
    <section className="mt-4 rounded-[14px] border border-border bg-card/80 p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h3
          className="text-[13px]"
          style={{ fontFamily: "var(--font-serif)", fontWeight: 500, letterSpacing: "-0.012em" }}
        >
          Linked batches
          <span className="ml-2 text-[10px] text-muted-foreground uppercase font-normal" style={{ letterSpacing: "0.12em" }}>
            {linked.length}
          </span>
        </h3>
        <span className="text-[10.5px] text-muted-foreground">
          {linked.filter((p) => p.status === "active").length} active · {linked.filter((p) => p.status === "done").length} done
        </span>
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {linked
          .slice()
          .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
          .map((p) => {
            const product = (p.name ?? "").slice(prefix.length);
            const day = dayByPlan.get(p.id!);
            const tint = p.status === "done"
              ? { bg: "linear-gradient(180deg,#f1faf4,#fdf8e2)", ink: "#4a7a5e" }
              : p.status === "active"
                ? { bg: "linear-gradient(180deg,#fdf8e2,#fdf1e2)", ink: "#8a7030" }
                : p.status === "cancelled" || p.status === "orphaned"
                  ? { bg: "rgba(0,0,0,0.04)", ink: "#8a8780" }
                  : { bg: "linear-gradient(180deg,rgba(255,255,255,0.7),rgba(245,243,239,0.55))", ink: "#1c1d1f" };
            return (
              <li key={p.id} className="rounded-[10px] border border-white/60 px-2.5 py-1.5" style={{ background: tint.bg, color: tint.ink }}>
                <Link href={`/production/${encodeURIComponent(p.id!)}`} className="block hover:underline">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate" style={{ fontFamily: "var(--font-serif)", fontWeight: 500, fontSize: 13 }}>
                      {product}
                    </span>
                    <span className="text-[9.5px] uppercase shrink-0" style={{ letterSpacing: "0.1em" }}>
                      {p.status}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-[10.5px] opacity-80 tabular-nums mt-0.5">
                    <span>
                      {p.batchNumber ?? "—"}
                      {p.pinnedDate && <span className="ml-1">🔒</span>}
                    </span>
                    <span>
                      {day ? new Date(day).toLocaleDateString("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" }) : "unscheduled"}
                    </span>
                  </div>
                  {(doneStepCount.get(p.id!) ?? 0) > 0 && (
                    <div className="text-[10px] opacity-70 mt-0.5">
                      {doneStepCount.get(p.id!)} step{doneStepCount.get(p.id!) === 1 ? "" : "s"} done
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
      </ul>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/** Product picker with search + type-chip + tag-chip filters. Replaces
 *  the dumb "+ Add product…" dropdown. Click a product → adds to the
 *  PO; product hides from list (excludedIds). */
function ProductPicker({
  products, excludedIds, categories, onPick,
}: {
  products: ReturnType<typeof useProductsList>;
  excludedIds: string[];
  categories: ReturnType<typeof useProductCategories>;
  onPick: (productId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filterCatIds, setFilterCatIds] = useState<Set<string>>(new Set());
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());

  const allTags = new Set<string>();
  for (const p of products) for (const t of p.tags ?? []) allTags.add(t);
  const tagList = [...allTags].sort();

  const excluded = new Set(excludedIds);
  const visible = products.filter((p) => {
    if (!p.id || excluded.has(p.id)) return false;
    if (p.archived) return false;
    if (search.trim() && !p.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (filterCatIds.size > 0) {
      if (!p.productCategoryId || !filterCatIds.has(p.productCategoryId)) return false;
    }
    if (filterTags.size > 0) {
      const ptags = new Set(p.tags ?? []);
      let ok = false;
      for (const t of filterTags) if (ptags.has(t)) { ok = true; break; }
      if (!ok) return false;
    }
    return true;
  });

  function toggleCat(id: string) {
    setFilterCatIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleTag(t: string) {
    setFilterTags((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next;
    });
  }

  return (
    <div className="rounded-[10px] border border-border bg-card/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="input text-base flex-1"
        />
      </div>
      {categories.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-medium mr-1">
            Type
          </span>
          {categories.map((c) => {
            const active = filterCatIds.has(c.id!);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleCat(c.id!)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize transition-colors ${
                  active
                    ? "bg-accent text-accent-foreground"
                    : "bg-card text-muted-foreground border border-border hover:bg-muted"
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}
      {tagList.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground font-medium mr-1">
            Tag
          </span>
          {tagList.map((t) => {
            const active = filterTags.has(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleTag(t)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-[var(--accent-lilac-bg)] text-[var(--accent-lilac-ink)]"
                    : "bg-card text-muted-foreground border border-border hover:bg-muted"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      )}
      <ul className="max-h-[40vh] overflow-y-auto rounded-[8px] border border-border bg-card divide-y divide-border">
        {visible.length === 0 ? (
          <li className="px-3 py-2 text-sm text-muted-foreground italic">No products match.</li>
        ) : (
          visible.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p.id!)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex items-center gap-2"
              >
                <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate">{p.name}</span>
                {(p.tags ?? []).length > 0 && (
                  <span className="text-[10px] text-muted-foreground truncate max-w-[40%]">
                    {(p.tags ?? []).join(", ")}
                  </span>
                )}
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
