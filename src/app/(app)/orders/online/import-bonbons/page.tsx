"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/dulceria";
import {
  useProductsList,
  useOrders,
  attachBoxContents,
  appendProductAliases,
} from "@/lib/hooks";
import {
  parseBoxContentsCsv,
  type BoxContentParseResult,
  type BoxContentOrder,
} from "@/lib/boxContentsImport";
import { IconArrowLeft as ArrowLeft, IconUpload as Upload, IconFileAlert as FileWarning, IconCircleCheck as CheckCircle } from "@tabler/icons-react";

/**
 * Box-builder CSV import — runs AFTER the Shopify orders import. Pairs
 * each row to an existing order via Order Number → sourceRef. Spawns
 * the picked chocolates as derived orderItems on the order's free-pick
 * variant line so the brain picks them up as production demand.
 */
export default function BoxContentsImportPage() {
  const router = useRouter();
  const products = useProductsList(true);
  const orders = useOrders();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<BoxContentParseResult | null>(null);
  const [manualAssignments, setManualAssignments] = useState<Map<string, string>>(new Map());
  const [skippedLines, setSkippedLines] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ orders: number; items: number } | null>(null);
  const [error, setError] = useState("");

  const ordersByRef = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) {
      if (o.sourceRef && o.id) m.set(o.sourceRef, o.id);
    }
    return m;
  }, [orders]);

  function lineKey(orderRef: string, idx: number): string {
    return `${orderRef}#${idx}`;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const text = await file.text();
      const p = parseBoxContentsCsv(text, { products, ordersByRef });
      setParsed(p);
      setManualAssignments(new Map());
      setResult(null);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Failed to read file");
    }
  }

  function getResolved(orderRef: string, idx: number, autoId: string | undefined): string | undefined {
    return manualAssignments.get(lineKey(orderRef, idx)) ?? autoId;
  }

  function setAssignment(orderRef: string, idx: number, productId: string) {
    setManualAssignments((prev) => {
      const next = new Map(prev);
      if (!productId) next.delete(lineKey(orderRef, idx));
      else next.set(lineKey(orderRef, idx), productId);
      return next;
    });
  }

  function toggleSkip(orderRef: string, idx: number) {
    const key = lineKey(orderRef, idx);
    setSkippedLines((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function isSkipped(orderRef: string, idx: number) {
    return skippedLines.has(lineKey(orderRef, idx));
  }

  const importable = useMemo(() => {
    if (!parsed) return { orders: [] as BoxContentOrder[], unmatched: 0, unresolved: 0 };
    let unmatched = 0;
    let unresolved = 0;
    const ready: BoxContentOrder[] = [];
    for (const o of parsed.orders) {
      if (!o.orderId) { unmatched++; continue; }
      const allOk = o.lines.every((li, i) =>
        isSkipped(o.orderRef, i)
        || (!!getResolved(o.orderRef, i, li.resolvedProductId) && li.quantity > 0),
      );
      if (!allOk) { unresolved++; continue; }
      ready.push(o);
    }
    return { orders: ready, unmatched, unresolved };
  }, [parsed, manualAssignments, skippedLines]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleImport() {
    if (!parsed) return;
    setImporting(true);
    setError("");
    try {
      // Persist any manual mapping (chocolate name → product) as
      // aliases so future box-builder imports auto-resolve.
      const aliasAdds = new Map<string, Set<string>>();
      for (const o of importable.orders) {
        for (let i = 0; i < o.lines.length; i++) {
          const li = o.lines[i];
          const manualPick = manualAssignments.get(lineKey(o.orderRef, i));
          if (manualPick && manualPick !== li.resolvedProductId) {
            const set = aliasAdds.get(manualPick) ?? new Set();
            set.add(li.name);
            aliasAdds.set(manualPick, set);
          }
        }
      }
      for (const [productId, names] of aliasAdds) {
        try { await appendProductAliases(productId, [...names]); }
        catch (e) { console.warn("alias save failed", e); }
      }

      let totalItems = 0;
      let touchedOrders = 0;
      for (const o of importable.orders) {
        const picks = o.lines
          .map((li, i) => ({ li, i }))
          .filter(({ i }) => !isSkipped(o.orderRef, i))
          .map(({ li, i }) => ({
            productId: getResolved(o.orderRef, i, li.resolvedProductId)!,
            quantity: li.quantity,
          }));
        const inserted = await attachBoxContents(o.orderId!, picks);
        if (inserted > 0) touchedOrders++;
        totalItems += inserted;
      }
      setResult({ orders: touchedOrders, items: totalItems });
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <div className="px-4 pt-4 pb-2">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back
        </button>
      </div>

      <PageHeader title="Import box contents" meta="After the Shopify orders import — upload the box-builder CSV with each order's chocolate picks. Pairs by Order Number." />

      <div className="px-4 pb-10 space-y-5">
        {!parsed && !result && (
          <section className="rounded-sm border border-dashed border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-8 text-center space-y-3">
            <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
            <div>
              <p className="text-sm">Drop your box-builder CSV here or</p>
              <button
                onClick={() => fileRef.current?.click()}
                className="mt-2 rounded-sm bg-primary text-primary-foreground px-4 py-2 text-sm font-medium"
              >
                Choose file
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Required columns: <code>Order Number</code>, <code>Lineitem name</code>, <code>Lineitem quantity</code>.
              Order Number must match the Shopify <code>Name</code> from the orders import.
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
            Missing required columns: <code>{parsed.missingRequiredColumns.join(", ")}</code>
          </div>
        )}

        {result && (
          <div className="rounded-sm border border-status-ok-edge bg-status-ok-bg p-4 flex items-start gap-2">
            <CheckCircle className="w-4 h-4 text-status-ok mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-status-ok">
                Attached {result.items} chocolate line{result.items === 1 ? "" : "s"} across {result.orders} order{result.orders === 1 ? "" : "s"}
              </p>
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
            <section className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-primary">Preview</h2>
                  <p className="text-xs text-muted-foreground">
                    {parsed.orders.length} order{parsed.orders.length === 1 ? "" : "s"} found
                    {importable.unmatched > 0 && ` · ${importable.unmatched} unmatched`}
                    {importable.unresolved > 0 && ` · ${importable.unresolved} need product mapping`}
                  </p>
                </div>
                <button
                  onClick={handleImport}
                  disabled={importable.orders.length === 0 || importing}
                  className="rounded-sm bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
                >
                  {importing
                    ? "Attaching…"
                    : `Attach ${importable.orders.length} order${importable.orders.length === 1 ? "" : "s"}`}
                </button>
              </div>
              {parsed.unknownColumns.length > 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Ignored columns: {parsed.unknownColumns.join(", ")}
                </p>
              )}
            </section>

            <ul className="space-y-2">
              {parsed.orders.map((o) => {
                const matched = !!o.orderId;
                return (
                  <li
                    key={o.orderRef}
                    className={`rounded-sm border bg-[color:var(--ds-card-bg)] p-3 space-y-2 ${matched ? "border-[color:var(--ds-border-warm)]" : "border-status-warn-edge bg-status-warn-bg/30"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold">
                          {o.orderRef}
                          {!matched && <span className="ml-2 text-[10px] uppercase tracking-wide text-status-warn">unmatched</span>}
                        </p>
                        {!matched && o.matchNote && (
                          <p className="text-[11px] text-status-warn">{o.matchNote}</p>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {o.lines.length} chocolate{o.lines.length === 1 ? "" : "s"} · {o.lines.reduce((s, l) => s + l.quantity, 0)} pcs
                      </span>
                    </div>
                    <ul className="divide-y divide-border rounded-md border border-[color:var(--ds-border-warm)]">
                      {o.lines.map((li, i) => {
                        const skipped = isSkipped(o.orderRef, i);
                        const resolved = getResolved(o.orderRef, i, li.resolvedProductId);
                        const issue = !skipped && !resolved;
                        return (
                          <li
                            key={i}
                            className={`px-3 py-2 text-sm ${
                              skipped ? "opacity-50" : issue ? "bg-status-warn-bg/40" : ""
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div className="flex-1 min-w-0">
                                <p className={`truncate ${skipped ? "line-through" : ""}`}>
                                  {li.name}
                                  {li.rawName !== li.name && (
                                    <span className="ml-2 text-[10px] text-muted-foreground italic">raw: {li.rawName}</span>
                                  )}
                                </p>
                                <p className="text-[11px] text-muted-foreground">× {li.quantity}</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  value={resolved ?? ""}
                                  onChange={(e) => setAssignment(o.orderRef, i, e.target.value)}
                                  className="input text-xs !py-1 !w-56"
                                  disabled={!matched || skipped}
                                >
                                  <option value="">— pick product —</option>
                                  {products
                                    .filter((p) => !p.archived)
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => toggleSkip(o.orderRef, i)}
                                  className={`text-[11px] px-2 py-1 rounded-sm border transition ${
                                    skipped
                                      ? "bg-foreground text-background border-foreground"
                                      : "bg-[color:var(--ds-card-bg)] border-[color:var(--ds-border-warm)] text-muted-foreground hover:border-foreground"
                                  }`}
                                >
                                  {skipped ? "Skipped" : "Skip"}
                                </button>
                              </div>
                            </div>
                            {issue && li.resolutionNote && (
                              <p className="mt-1 text-[11px] text-status-warn">{li.resolutionNote}</p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
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
