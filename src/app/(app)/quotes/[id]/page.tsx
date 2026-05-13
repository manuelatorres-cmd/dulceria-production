"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/dulceria";
import {
  useQuote, useCustomer, useProductsList, usePackagingList, saveQuote,
  convertQuoteToOrder, deleteQuote,
} from "@/lib/hooks";
import { QUOTE_STATUS_LABELS, type QuoteStatus } from "@/types";
import {
  IconPrinter as Printer,
  IconCheck as Check,
  IconTrash as Trash2,
  IconPackage as Package,
} from "@tabler/icons-react";
import { IconArrowLeft as ArrowLeft } from "@tabler/icons-react";
import { BackButton } from "@/components/back-button";

export default function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idStr } = use(params);
  const id = decodeURIComponent(idStr);
  const router = useRouter();
  const quote = useQuote(id);
  const customer = useCustomer(quote?.customerId);
  const products = useProductsList(true);
  const packaging = usePackagingList(true);
  const productById = new Map(products.map((p) => [p.id!, p]));
  const packagingById = new Map(packaging.map((p) => [p.id!, p]));
  const [converting, setConverting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deadlinePrompt, setDeadlinePrompt] = useState<string | null>(null);
  const [convertError, setConvertError] = useState("");

  if (quote === undefined) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (quote === null) {
    return (
      <div className="p-6">
        <Link href="/quotes" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="w-3.5 h-3.5" /> All quotes
        </Link>
        <p className="mt-6 text-sm text-muted-foreground">Quote not found.</p>
      </div>
    );
  }

  async function setStatus(next: QuoteStatus) {
    if (!quote) return;
    await saveQuote({ ...quote, status: next });
  }

  function startConvert() {
    if (!quote?.id) return;
    setConvertError("");
    // Spec: prompt for a delivery date if the quote has none.
    if (!quote.deadline) {
      setDeadlinePrompt(toLocalDatetimeInput(new Date()));
      return;
    }
    finishConvert();
  }

  async function finishConvert(deadlineOverride?: string) {
    if (!quote?.id) return;
    setConverting(true);
    setConvertError("");
    try {
      const newOrderId = await convertQuoteToOrder(quote.id, {
        deadline: deadlineOverride ? new Date(deadlineOverride) : undefined,
      });
      router.push(`/orders/${encodeURIComponent(newOrderId)}`);
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : "Conversion failed");
      setConverting(false);
    }
  }

  function toLocalDatetimeInput(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function handleDelete() {
    if (!quote?.id) return;
    await deleteQuote(quote.id);
    router.push("/quotes");
  }

  const expired = !!quote.expiresAt && new Date(quote.expiresAt) < new Date();

  return (
    <div>
      <PageHeader title={quote.title || "Quote"} meta={customer?.companyName ?? (quote.isWhatIf ? "What-If scenario" : "No customer")} />
      <div className="px-4 pb-10 space-y-4 print:pb-0">
        {/* Toolbar — hidden in print view */}
        <div className="flex items-center justify-between print:hidden">
          <BackButton fallbackHref="/quotes" fallbackLabel="All quotes" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs hover:border-primary hover:text-primary"
            >
              <Printer className="w-3.5 h-3.5" /> Print / PDF
            </button>
            {!quote.convertedToOrderId && !quote.isWhatIf && (
              <button
                onClick={startConvert}
                disabled={converting}
                className="inline-flex items-center gap-1 rounded-sm bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" /> {converting ? "Converting…" : "Convert to order"}
              </button>
            )}
            {quote.convertedToOrderId && (
              <Link
                href={`/orders/${encodeURIComponent(quote.convertedToOrderId)}?from=quotes&fromId=${encodeURIComponent(id)}`}
                className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs text-primary hover:border-primary"
              >
                View order →
              </Link>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-muted-foreground hover:text-destructive"
              aria-label="Delete quote"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {deadlinePrompt !== null && (
          <div className="rounded-sm border border-primary/40 bg-primary/5 p-3 print:hidden space-y-2">
            <p className="text-xs">
              This quote has no delivery date. Set one before creating the order:
            </p>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={deadlinePrompt}
                onChange={(e) => setDeadlinePrompt(e.target.value)}
                className="input text-sm w-auto"
              />
              <button
                onClick={() => { const d = deadlinePrompt; setDeadlinePrompt(null); finishConvert(d!); }}
                disabled={!deadlinePrompt || converting}
                className="rounded-sm bg-primary text-primary-foreground px-3 py-1 text-xs font-medium disabled:opacity-50"
              >
                {converting ? "Converting…" : "Convert with this date"}
              </button>
              <button onClick={() => setDeadlinePrompt(null)} className="text-xs text-muted-foreground hover:underline">
                Cancel
              </button>
            </div>
          </div>
        )}

        {convertError && (
          <div className="rounded-sm border border-status-alert/30 bg-status-alert/5 p-2 text-xs text-status-alert print:hidden">
            {convertError}
          </div>
        )}

        {confirmDelete && (
          <div className="rounded-sm border border-destructive/30 bg-destructive/5 p-3 flex items-center justify-between">
            <p className="text-xs text-destructive">Delete this quote permanently?</p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted-foreground">Cancel</button>
              <button onClick={handleDelete} className="rounded-sm bg-destructive text-white px-3 py-1 text-xs font-medium">
                Delete
              </button>
            </div>
          </div>
        )}

        {/* Status selector */}
        <section className="flex items-center gap-2 print:hidden">
          {(["draft", "sent", "won", "lost", "expired"] as QuoteStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                quote.status === s
                  ? "bg-primary text-primary-foreground"
                  : "border border-border text-muted-foreground"
              }`}
            >
              {QUOTE_STATUS_LABELS[s]}
            </button>
          ))}
        </section>

        {/* Printable sheet — everything below prints */}
        <div id="quote-sheet" className="rounded-sm border border-border bg-card p-6 space-y-5 print:border-0 print:shadow-none print:p-0">
          {/* Letterhead */}
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Quote</p>
              <h1 className="text-2xl font-bold">{quote.title}</h1>
              {quote.expiresAt && (
                <p className={`text-xs mt-1 ${expired ? "text-status-alert" : "text-muted-foreground"}`}>
                  {expired ? "Expired" : "Valid until"}{" "}
                  {new Date(quote.expiresAt).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" })}
                </p>
              )}
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">Dulceria GmbH</p>
              <p>Lilienbrunngasse 5/1A</p>
              <p>1020 Wien, Austria</p>
            </div>
          </div>

          {/* Recipient */}
          {customer && (
            <div className="rounded-md bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">For</p>
              <p className="text-sm font-semibold">{customer.companyName}</p>
              {customer.contactName && <p className="text-xs">{customer.contactName}</p>}
              {customer.email && <p className="text-xs">{customer.email}</p>}
              {customer.address && <p className="text-xs">{customer.address}</p>}
              {customer.vatNumber && <p className="text-[11px] text-muted-foreground mt-1">VAT: {customer.vatNumber}</p>}
            </div>
          )}

          {/* Line items */}
          <div>
            <h2 className="text-sm font-semibold text-primary mb-2">Line items</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5">Item</th>
                  <th className="py-1.5 text-right w-20">Qty</th>
                  <th className="py-1.5 text-right w-28">Unit cost</th>
                  <th className="py-1.5 text-right w-28">Line cost</th>
                </tr>
              </thead>
              <tbody>
                {(quote.costBreakdown?.perLine ?? []).map((row, i) => (
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1.5">
                      {row.productId
                        ? (productById.get(row.productId)?.name ?? row.label)
                        : row.label}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{row.quantity}</td>
                    <td className="py-1.5 text-right tabular-nums">€{row.unitCost.toFixed(2)}</td>
                    <td className="py-1.5 text-right tabular-nums">€{row.lineCost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Boxes breakdown for human reading */}
          {quote.items.some((it) => it.boxContents && it.boxContents.length > 0) && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1">
                <Package className="w-3 h-3" /> Box contents
              </h3>
              <ul className="text-xs space-y-1.5">
                {quote.items.filter((it) => it.boxContents && it.boxContents.length > 0).map((it, i) => (
                  <li key={i}>
                    <span className="font-medium">{it.packagingId ? (packagingById.get(it.packagingId)?.name ?? "Box") : "Box"} × {it.quantity}</span>
                    {" — each contains: "}
                    {it.boxContents!.map((c, j) => (
                      <span key={j}>
                        {j > 0 && ", "}
                        {productById.get(c.productId)?.name ?? "Product"} × {c.pieces}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Totals */}
          {quote.costBreakdown && (
            <div className="ml-auto w-full sm:w-80 space-y-1.5 text-sm">
              <TotalRow label="Subtotal (cost)" value={`€${quote.costBreakdown.totalCost.toFixed(2)}`} />
              {quote.marginPercent != null && (
                <TotalRow label={`Margin (${quote.marginPercent.toFixed(0)}%)`} value={`€${((quote.sellPrice ?? 0) - quote.costBreakdown.totalCost).toFixed(2)}`} />
              )}
              <div className="border-t border-border pt-1.5">
                <TotalRow label="Total" value={`€${(quote.sellPrice ?? 0).toFixed(2)}`} strong />
              </div>
            </div>
          )}

          {/* Feasibility */}
          {quote.feasibilityNote && (
            <div className={`rounded-md p-3 text-xs ${quote.feasible ? "bg-status-ok-bg text-status-ok" : "bg-status-warn-bg text-status-warn"}`}>
              <p className="font-semibold">{quote.feasible ? "Feasibility: OK" : "Capacity warning"}</p>
              <p className="mt-0.5">{quote.feasibilityNote}</p>
            </div>
          )}

          {/* Notes */}
          {quote.notes && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Notes</p>
              <p className="text-sm whitespace-pre-line">{quote.notes}</p>
            </div>
          )}

          {/* Footer */}
          <div className="pt-3 border-t border-border text-[11px] text-muted-foreground">
            <p>Prices exclude VAT unless stated otherwise. Production capacity reserved only on acceptance.</p>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body { background: white !important; }
          nav, aside, header, .print\\:hidden { display: none !important; }
          main { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}

function TotalRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={strong ? "text-sm font-semibold" : "text-xs text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${strong ? "text-base font-semibold" : "text-sm"}`}>{value}</span>
    </div>
  );
}
