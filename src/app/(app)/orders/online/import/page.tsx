"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import {
  useProductsList, useOrders, importOnlineOrders,
} from "@/lib/hooks";
import { parseShopifyCsv, type ShopifyParseResult, type ShopifyParsedOrder } from "@/lib/shopifyImport";
import { ArrowLeft, Upload, FileWarning, CheckCircle } from "lucide-react";

const DEFAULT_LEAD_DAYS = 3;

export default function ShopifyImportPage() {
  const router = useRouter();
  const products = useProductsList(true);
  const orders = useOrders();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ShopifyParseResult | null>(null);
  const [manualAssignments, setManualAssignments] = useState<Map<string, string>>(new Map());
  const [leadDays, setLeadDays] = useState<number>(DEFAULT_LEAD_DAYS);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [error, setError] = useState("");

  const existingRefs = useMemo(
    () => new Set(orders.map((o) => o.sourceRef).filter((x): x is string => !!x)),
    [orders],
  );

  function lineKey(orderName: string, idx: number): string {
    return `${orderName}#${idx}`;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const p = parseShopifyCsv(text, { products, existingOrderNames: existingRefs });
      setParsed(p);
      setManualAssignments(new Map());
      setResult(null);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Failed to read file");
    }
  }

  function getResolvedProductId(orderName: string, idx: number, line: ShopifyParsedOrder["lineItems"][number]): string | undefined {
    return manualAssignments.get(lineKey(orderName, idx)) ?? line.resolvedProductId;
  }

  function setAssignment(orderName: string, idx: number, productId: string) {
    setManualAssignments((prev) => {
      const next = new Map(prev);
      if (!productId) next.delete(lineKey(orderName, idx));
      else next.set(lineKey(orderName, idx), productId);
      return next;
    });
  }

  const importable = useMemo(() => {
    if (!parsed) return { orders: [] as ShopifyParsedOrder[], unresolvedCount: 0, skippedCount: 0 };
    const duplicates = new Set(parsed.duplicateNames);
    let unresolved = 0;
    const readyOrders: ShopifyParsedOrder[] = [];
    for (const o of parsed.orders) {
      if (duplicates.has(o.name)) continue;
      const allResolved = o.lineItems.every((li, i) => !!getResolvedProductId(o.name, i, li));
      if (!allResolved) {
        unresolved++;
        continue;
      }
      readyOrders.push(o);
    }
    return { orders: readyOrders, unresolvedCount: unresolved, skippedCount: duplicates.size };
  }, [parsed, manualAssignments]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    setError("");
    try {
      const payload = importable.orders.map((o) => {
        const placed = o.placedAt ? new Date(o.placedAt) : new Date();
        const deadline = new Date(placed.getTime() + leadDays * 86_400_000);
        return {
          sourceRef: o.name,
          customerName: o.shippingName,
          email: o.email,
          placedAt: o.placedAt,
          shippingAddress: o.shippingAddress,
          phone: o.phone,
          deadline: deadline.toISOString(),
          items: o.lineItems.map((li, i) => ({
            productId: getResolvedProductId(o.name, i, li)!,
            quantity: li.quantity,
            unitPrice: li.unitPrice,
            notes: li.sku ? `SKU ${li.sku}` : undefined,
          })),
        };
      });
      const imported = await importOnlineOrders(payload);
      setResult({ imported, skipped: (parsed.orders.length - importable.orders.length) });
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Import Shopify orders" description="Upload a Shopify orders CSV export" />
      <div className="px-4 pb-10 space-y-5">
        <Link href="/orders/online" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-3.5 h-3.5" /> Online orders
        </Link>

        {!parsed && !result && (
          <section className="rounded-sm border border-dashed border-border bg-card p-8 text-center space-y-3">
            <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
            <div>
              <p className="text-sm">Drop your Shopify orders CSV here or</p>
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-2 rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
              >
                Choose file
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Expected columns: <code>Name</code>, <code>Lineitem name</code>, <code>Lineitem quantity</code>,
              plus the usual Shopify fields (<code>Email</code>, <code>Shipping Name</code>, <code>Lineitem sku</code>…).
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleFile}
            />
          </section>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {parsed && parsed.missingRequiredColumns.length > 0 && (
          <div className="rounded-md bg-status-warn-bg border border-status-warn-edge px-3 py-2 text-xs text-status-warn">
            <FileWarning className="w-4 h-4 inline mr-1" />
            Missing required columns: <code>{parsed.missingRequiredColumns.join(", ")}</code>. This doesn&apos;t look like a Shopify orders export.
          </div>
        )}

        {result && (
          <div className="rounded-sm border border-status-ok-edge bg-status-ok-bg p-4 flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-status-ok mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-status-ok">
                Imported {result.imported} order{result.imported === 1 ? "" : "s"}
              </p>
              {result.skipped > 0 && (
                <p className="text-xs text-muted-foreground">
                  {result.skipped} skipped — {parsed?.duplicateNames.length ? "already imported" : "unresolved line items"}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => router.push("/orders/online")}
                  className="text-xs text-primary hover:underline"
                >
                  View online orders →
                </button>
                <button
                  onClick={() => { setParsed(null); setResult(null); setManualAssignments(new Map()); }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Import another file
                </button>
              </div>
            </div>
          </div>
        )}

        {parsed && parsed.missingRequiredColumns.length === 0 && !result && (
          <>
            <section className="rounded-sm border border-border bg-card p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-primary">Preview</h2>
                  <p className="text-xs text-muted-foreground">
                    {parsed.orders.length} order{parsed.orders.length === 1 ? "" : "s"} found
                    {parsed.duplicateNames.length > 0 && ` · ${parsed.duplicateNames.length} already imported`}
                    {importable.unresolvedCount > 0 && ` · ${importable.unresolvedCount} need product mapping`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-xs text-muted-foreground">
                    Default lead:
                    <input
                      type="number"
                      min="0"
                      value={leadDays}
                      onChange={(e) => setLeadDays(Math.max(0, parseInt(e.target.value, 10) || 0))}
                      className="input text-xs w-16 inline-block ml-1.5"
                    />
                    {" "}days
                  </label>
                  <button
                    onClick={handleImport}
                    disabled={importable.orders.length === 0 || importing}
                    className="rounded-full bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {importing
                      ? "Importing…"
                      : `Import ${importable.orders.length} order${importable.orders.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              </div>
              {parsed.unknownColumns.length > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Ignored columns: {parsed.unknownColumns.join(", ")}
                </p>
              )}
            </section>

            <ul className="space-y-2">
              {parsed.orders.map((o) => {
                const isDup = parsed.duplicateNames.includes(o.name);
                return (
                  <li
                    key={o.name}
                    className={`rounded-sm border bg-card p-3 space-y-2 ${isDup ? "border-border/60 opacity-60" : "border-border"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {o.name}
                          {isDup && <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">already imported</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[o.shippingName, o.email, o.placedAt ? new Date(o.placedAt).toLocaleDateString("en-GB") : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {o.lineItems.length} item{o.lineItems.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <ul className="divide-y divide-border rounded-md border border-border">
                      {o.lineItems.map((li, i) => {
                        const resolved = getResolvedProductId(o.name, i, li);
                        const issue = !resolved;
                        return (
                          <li key={i} className={`px-3 py-2 text-sm ${issue ? "bg-status-warn-bg/40" : ""}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="truncate">
                                  {li.name}
                                  {li.sku && <span className="ml-2 text-[10px] font-mono text-muted-foreground">SKU {li.sku}</span>}
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  × {li.quantity}
                                  {li.unitPrice != null && ` · €${li.unitPrice.toFixed(2)} each`}
                                </p>
                              </div>
                              <select
                                value={resolved ?? ""}
                                onChange={(e) => setAssignment(o.name, i, e.target.value)}
                                className="input text-xs !py-1 !w-56"
                                disabled={isDup}
                              >
                                <option value="">— pick product —</option>
                                {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                              </select>
                            </div>
                            {issue && li.resolutionNote && (
                              <p className="mt-1 text-[11px] text-status-warn">{li.resolutionNote}</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {o.warnings.length > 0 && (
                      <ul className="text-[11px] text-status-warn space-y-0.5">
                        {o.warnings.map((w, i) => (<li key={i}>{w}</li>))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
