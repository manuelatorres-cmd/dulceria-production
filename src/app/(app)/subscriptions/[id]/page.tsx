"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { PageHeader } from "@/components/dulceria";
import {
  useSubscriptionTemplate,
  saveSubscriptionTemplate,
  deleteSubscriptionTemplate,
  useSubscriptionRuns,
  saveSubscriptionRun,
  deleteSubscriptionRun,
  usePackagingList,
  useProductsList,
} from "@/lib/hooks";
import {
  SUBSCRIPTION_FREQUENCIES,
  SUBSCRIPTION_RUN_STATUSES,
  type SubscriptionFrequency,
  type SubscriptionRunStatus,
} from "@/types";
import { newId } from "@/lib/supabase";

export default function SubscriptionTemplateDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const templateId = decodeURIComponent(idStr);
  const template = useSubscriptionTemplate(templateId);
  const runs = useSubscriptionRuns(templateId);
  const packaging = usePackagingList();
  const products = useProductsList();
  const router = useRouter();

  const [name, setName] = useState("");
  const [pieceCount, setPieceCount] = useState<number>(8);
  const [packagingId, setPackagingId] = useState<string>("");
  const [frequency, setFrequency] = useState<SubscriptionFrequency>("monthly");
  const [active, setActive] = useState(true);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!template) return;
    setName(template.name);
    setPieceCount(template.pieceCount);
    setPackagingId(template.packagingId ?? "");
    setFrequency(template.frequency);
    setActive(template.active);
    setNotes(template.notes ?? "");
  }, [template]);

  const productsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.id) m.set(p.id, p.name);
    return m;
  }, [products]);

  async function save() {
    if (!template) return;
    setSaving(true);
    try {
      await saveSubscriptionTemplate({
        id: template.id,
        name: name.trim() || "Untitled",
        pieceCount,
        packagingId: packagingId || undefined,
        frequency,
        active,
        notes: notes.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!template?.id) return;
    await deleteSubscriptionTemplate(template.id);
    router.replace("/subscriptions");
  }

  if (!template) {
    return (
      <div className="py-12 text-center text-muted-foreground">Loading…</div>
    );
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <div className="mb-3">
        <BackButton
          fallbackHref="/subscriptions"
          fallbackLabel="Subscriptions"
          className="inline-flex items-center gap-1 text-[11px] uppercase text-muted-foreground hover:text-foreground tracking-[0.1em]"
        />
      </div>

      <PageHeader
        title={name || "Untitled subscription"}
        meta={`${frequency} · ${pieceCount} pieces per box · ${active ? "active" : "inactive"}`}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
        {/* Template form */}
        <section className="space-y-4">
          <Field label="Name">
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Piece count">
              <input
                type="number"
                min={1}
                className="input"
                value={pieceCount}
                onChange={(e) => setPieceCount(Math.max(1, Number(e.target.value) || 1))}
              />
            </Field>
            <Field label="Frequency">
              <select
                className="input"
                value={frequency}
                onChange={(e) =>
                  setFrequency(e.target.value as SubscriptionFrequency)
                }
              >
                {SUBSCRIPTION_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Packaging">
              <select
                className="input"
                value={packagingId}
                onChange={(e) => setPackagingId(e.target.value)}
              >
                <option value="">—</option>
                {packaging
                  .filter((p) => !p.archived)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              className="input"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
          <label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            Active — brain tracks upcoming cycles
          </label>
          <div className="flex justify-between items-center pt-3 border-t border-[color:var(--ds-border-warm)]">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="btn-primary"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {confirmDelete ? (
              <span className="flex items-center gap-2 text-[11.5px]">
                <span className="text-muted-foreground">Delete?</span>
                <button
                  onClick={doDelete}
                  className="text-[color:var(--color-status-alert)] font-medium hover:underline"
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
                Delete
              </button>
            )}
          </div>
        </section>

        {/* Runs panel */}
        <aside
          className="border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4"
          style={{ borderRadius: 4 }}
        >
          <RunsPanel
            templateId={templateId}
            pieceCount={pieceCount}
            runs={runs}
            productsById={productsById}
            products={products}
          />
        </aside>
      </div>
    </div>
  );
}

function RunsPanel({
  templateId,
  pieceCount,
  runs,
  productsById,
  products,
}: {
  templateId: string;
  pieceCount: number;
  runs: ReturnType<typeof useSubscriptionRuns>;
  productsById: Map<string, string>;
  products: ReturnType<typeof useProductsList>;
}) {
  const [shipDate, setShipDate] = useState("");
  const [count, setCount] = useState<number | "">("");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  async function addRun() {
    if (!shipDate) return;
    setSaving(true);
    try {
      await saveSubscriptionRun({
        id: newId(),
        templateId,
        scheduledShipDate: shipDate,
        subscriberCount: count === "" ? 0 : Number(count),
        selectedProductIds: productIds,
        status: "planned",
        productionPlanIds: [],
      });
      setShipDate("");
      setCount("");
      setProductIds([]);
    } finally {
      setSaving(false);
    }
  }

  function toggleProduct(id: string) {
    setProductIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function setRunStatus(runId: string, status: SubscriptionRunStatus) {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;
    await saveSubscriptionRun({ ...run, status });
  }

  return (
    <>
      <h3
        className="text-[13px] mb-3"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 500,
          letterSpacing: "-0.012em",
        }}
      >
        Cycles
        <span
          className="ml-2 text-[10px] uppercase text-muted-foreground font-normal"
          style={{ letterSpacing: "0.12em" }}
        >
          {runs.length}
        </span>
      </h3>

      {/* Add form */}
      <div
        className="mb-4 p-3 border border-[color:var(--ds-border-warm)] bg-muted/40 space-y-2"
        style={{ borderRadius: 3 }}
      >
        <Field label="Ship date">
          <input
            type="date"
            className="input"
            value={shipDate}
            onChange={(e) => setShipDate(e.target.value)}
          />
        </Field>
        <Field label="Subscriber count">
          <input
            type="number"
            min={0}
            className="input"
            value={count}
            onChange={(e) =>
              setCount(e.target.value === "" ? "" : Number(e.target.value))
            }
          />
        </Field>
        <div>
          <label className="label">Contents ({pieceCount} total)</label>
          <div className="max-h-48 overflow-y-auto border border-[color:var(--ds-border-warm)]" style={{ borderRadius: 3 }}>
            {products
              .filter((p) => !p.archived)
              .map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 px-2 py-1 text-[12px] hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
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
              ))}
          </div>
        </div>
        <button
          type="button"
          onClick={addRun}
          disabled={saving || !shipDate}
          className="btn-primary"
        >
          {saving ? "Adding…" : "+ Add cycle"}
        </button>
      </div>

      {runs.length === 0 ? (
        <p
          className="text-muted-foreground italic text-[12px]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          No cycles yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {runs.map((r) => (
            <li
              key={r.id}
              className="border border-[color:var(--ds-border-warm)] bg-muted px-3 py-2 text-[12px]"
              style={{ borderRadius: 3 }}
            >
              <div className="flex items-baseline justify-between">
                <strong
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontWeight: 500,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {r.scheduledShipDate}
                </strong>
                <span
                  className="text-[10px] uppercase"
                  style={{ letterSpacing: "0.12em" }}
                >
                  {r.subscriberCount} subs
                </span>
              </div>
              {r.selectedProductIds.length > 0 ? (
                <div className="text-[10.5px] text-muted-foreground mt-1 truncate">
                  {r.selectedProductIds
                    .map((id) => productsById.get(id) ?? "?")
                    .join(" · ")}
                </div>
              ) : null}
              <div className="flex items-center gap-2 mt-2">
                <select
                  value={r.status}
                  onChange={(e) =>
                    r.id &&
                    setRunStatus(r.id, e.target.value as SubscriptionRunStatus)
                  }
                  className="text-[10.5px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] px-1 py-0.5"
                  style={{ borderRadius: 2 }}
                >
                  {SUBSCRIPTION_RUN_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => r.id && deleteSubscriptionRun(r.id)}
                  className="ml-auto text-[10px] uppercase text-muted-foreground hover:text-[color:var(--color-status-alert)]"
                  style={{ letterSpacing: "0.08em" }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
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
