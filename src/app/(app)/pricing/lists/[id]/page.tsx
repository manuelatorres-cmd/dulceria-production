"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import {
  usePriceList,
  savePriceList,
  deletePriceList,
  usePriceListItems,
  savePriceListItem,
  deletePriceListItem,
  useProductsList,
  useVariants,
  useCustomers,
} from "@/lib/hooks";
import type { PriceListItem } from "@/types";
import { newId } from "@/lib/supabase";

/**
 * Price list detail — edit header metadata + manage rules.
 *
 * Rule scopes (one must be set):
 *   - product   → specific SKU override
 *   - collection → applies to every product in a collection
 *   - tag       → applies to every product carrying the tag
 *
 * Pricing effect (one must be set):
 *   - discountPercent → % off retail
 *   - fixedPrice      → absolute net price
 */
export default function PriceListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: idStr } = use(params);
  const listId = decodeURIComponent(idStr);
  const list = usePriceList(listId);
  const items = usePriceListItems(listId);
  const products = useProductsList();
  const variants = useVariants();
  const customers = useCustomers();
  const router = useRouter();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [defaultDiscountPercent, setDefaultDiscountPercent] = useState<number | "">("");
  const [archived, setArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!list) return;
    setName(list.name);
    setDescription(list.description ?? "");
    setValidFrom(list.validFrom ?? "");
    setValidTo(list.validTo ?? "");
    setDefaultDiscountPercent(list.defaultDiscountPercent ?? "");
    setArchived(list.archived);
  }, [list]);

  const productsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products) if (p.id) m.set(p.id, p.name);
    return m;
  }, [products]);
  const collectionsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of variants) if (v.id) m.set(v.id, v.name ?? v.id);
    return m;
  }, [variants]);

  const customerCount = customers.filter(
    (c) => c.defaultPriceListId === listId,
  ).length;

  async function saveHeader() {
    if (!list) return;
    setSaving(true);
    try {
      await savePriceList({
        id: list.id,
        name: name.trim() || "Untitled",
        description: description.trim() || undefined,
        validFrom: validFrom || undefined,
        validTo: validTo || undefined,
        defaultDiscountPercent:
          defaultDiscountPercent === ""
            ? undefined
            : Number(defaultDiscountPercent),
        archived,
      });
    } finally {
      setSaving(false);
    }
  }

  async function doDelete() {
    if (!list?.id) return;
    await deletePriceList(list.id);
    router.replace("/pricing/lists");
  }

  if (!list) {
    return (
      <div className="py-12 text-center text-muted-foreground">Loading…</div>
    );
  }

  return (
    <div>
      <div className="mb-3">
        <Link
          href="/pricing/lists"
          className="inline-flex items-center gap-1 text-[11px] uppercase text-muted-foreground hover:text-foreground"
          style={{ letterSpacing: "0.1em" }}
        >
          <ArrowLeft className="w-3 h-3" /> Price lists
        </Link>
      </div>

      <PageHeader
        title={name || "Untitled price list"}
        accent={customerCount > 0 ? `${customerCount} customer${customerCount === 1 ? "" : "s"}` : "Unassigned"}
        description={
          list.defaultDiscountPercent !== undefined
            ? `Blanket −${list.defaultDiscountPercent}% off retail`
            : undefined
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Header form + items */}
        <section>
          <div className="space-y-4 mb-6">
            <Field label="Name">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Description">
              <textarea
                className="input"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Valid from">
                <input
                  type="date"
                  className="input"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                />
              </Field>
              <Field label="Valid to">
                <input
                  type="date"
                  className="input"
                  value={validTo}
                  onChange={(e) => setValidTo(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Blanket discount % (optional)">
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                className="input"
                value={defaultDiscountPercent}
                onChange={(e) =>
                  setDefaultDiscountPercent(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                style={{ maxWidth: 160 }}
              />
            </Field>
            <label className="inline-flex items-center gap-2 text-[12px] text-muted-foreground">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
                className="w-3.5 h-3.5"
              />
              Archived — hide from customer dropdowns
            </label>
            <div className="flex justify-between items-center pt-3 border-t border-border">
              <button
                type="button"
                onClick={saveHeader}
                disabled={saving}
                className="btn-primary"
              >
                {saving ? "Saving…" : "Save header"}
              </button>
              {confirmDelete ? (
                <span className="flex items-center gap-2 text-[11.5px]">
                  <span className="text-muted-foreground">Delete list?</span>
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
                  Delete list
                </button>
              )}
            </div>
          </div>

          {/* Rules */}
          <RulesPanel
            listId={listId}
            items={items}
            productsById={productsById}
            collectionsById={collectionsById}
          />
        </section>

        {/* Side rail */}
        <aside className="space-y-4">
          <div
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
              Assigned customers
            </h3>
            {customerCount === 0 ? (
              <p
                className="text-muted-foreground italic text-[12px]"
                style={{ fontFamily: "var(--font-serif)" }}
              >
                None yet. Open a customer profile → set default price list.
              </p>
            ) : (
              <ul className="space-y-1">
                {customers
                  .filter((c) => c.defaultPriceListId === listId)
                  .map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/customers/${encodeURIComponent(c.id ?? "")}`}
                        className="text-[12.5px] hover:underline"
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontWeight: 500,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        {c.companyName}
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div
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
              Price resolution ladder
            </h3>
            <ol className="text-[11.5px] text-muted-foreground list-decimal pl-5 space-y-1">
              <li>Per-customer product override</li>
              <li>This list's product rule</li>
              <li>This list's collection rule</li>
              <li>This list's tag rule</li>
              <li>Blanket % from header</li>
              <li>Retail price on product</li>
            </ol>
            <p className="text-[10.5px] text-muted-foreground italic mt-2">
              Most specific wins.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function RulesPanel({
  listId,
  items,
  productsById,
  collectionsById,
}: {
  listId: string;
  items: PriceListItem[];
  productsById: Map<string, string>;
  collectionsById: Map<string, string>;
}) {
  const [scope, setScope] = useState<"product" | "collection" | "tag">("product");
  const [scopeId, setScopeId] = useState("");
  const [tag, setTag] = useState("");
  const [mode, setMode] = useState<"discount" | "fixed">("discount");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function addRule() {
    const value = Number(amount);
    if (Number.isNaN(value)) return;
    if (scope === "product" && !scopeId) return;
    if (scope === "collection" && !scopeId) return;
    if (scope === "tag" && !tag.trim()) return;
    setBusy(true);
    try {
      await savePriceListItem({
        id: newId(),
        priceListId: listId,
        productId: scope === "product" ? scopeId : undefined,
        collectionId: scope === "collection" ? scopeId : undefined,
        tag: scope === "tag" ? tag.trim() : undefined,
        discountPercent: mode === "discount" ? value : undefined,
        fixedPrice: mode === "fixed" ? value : undefined,
      });
      setScopeId("");
      setTag("");
      setAmount("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="border border-border bg-card p-4"
      style={{ borderRadius: 4 }}
    >
      <h3
        className="text-[13px] mb-3"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 500,
          letterSpacing: "-0.012em",
        }}
      >
        Rules
        <span
          className="ml-2 text-[10px] uppercase text-muted-foreground font-normal"
          style={{ letterSpacing: "0.12em" }}
        >
          {items.length}
        </span>
      </h3>

      {/* Add form */}
      <div
        className="mb-4 p-3 border border-border bg-muted/40"
        style={{ borderRadius: 3 }}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
          <div>
            <label className="label">Scope</label>
            <select
              className="input"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as "product" | "collection" | "tag");
                setScopeId("");
              }}
            >
              <option value="product">Product</option>
              <option value="collection">Collection</option>
              <option value="tag">Tag</option>
            </select>
          </div>
          {scope === "tag" ? (
            <div>
              <label className="label">Tag</label>
              <input
                className="input"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="e.g. spring-2026"
              />
            </div>
          ) : (
            <div>
              <label className="label">
                {scope === "product" ? "Product" : "Collection"}
              </label>
              <select
                className="input"
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
              >
                <option value="">—</option>
                {(scope === "product"
                  ? Array.from(productsById.entries())
                  : Array.from(collectionsById.entries())
                ).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
          <div>
            <label className="label">Effect</label>
            <select
              className="input"
              value={mode}
              onChange={(e) => setMode(e.target.value as "discount" | "fixed")}
            >
              <option value="discount">Discount %</option>
              <option value="fixed">Fixed price €</option>
            </select>
          </div>
          <div>
            <label className="label">
              {mode === "discount" ? "Percent (0–100)" : "Price (net €)"}
            </label>
            <input
              type="number"
              step={mode === "discount" ? 0.5 : 0.01}
              min={0}
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={addRule}
          disabled={busy}
          className="btn-primary"
        >
          {busy ? "Adding…" : "+ Add rule"}
        </button>
      </div>

      {/* Existing rules */}
      {items.length === 0 ? (
        <p
          className="text-muted-foreground italic text-[12.5px]"
          style={{ fontFamily: "var(--font-serif)" }}
        >
          No rules yet. Add one above or rely on the blanket discount.
        </p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center gap-3 px-3 py-1.5 border border-border bg-muted text-[12px]"
              style={{ borderRadius: 3 }}
            >
              <span
                className="flex-1 min-w-0 truncate"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                }}
              >
                {it.productId
                  ? productsById.get(it.productId) ?? it.productId.slice(0, 8)
                  : it.collectionId
                    ? `Collection: ${collectionsById.get(it.collectionId) ?? it.collectionId.slice(0, 8)}`
                    : `Tag: ${it.tag}`}
              </span>
              <span className="tabular-nums text-muted-foreground">
                {it.discountPercent !== undefined
                  ? `−${it.discountPercent}%`
                  : it.fixedPrice !== undefined
                    ? `€${it.fixedPrice.toFixed(2)}`
                    : "?"}
              </span>
              <button
                type="button"
                onClick={() => it.id && deletePriceListItem(it.id)}
                className="text-[10px] uppercase text-muted-foreground hover:text-[color:var(--color-status-alert)]"
                style={{ letterSpacing: "0.08em" }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
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
