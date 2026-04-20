"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { useCustomers } from "@/lib/hooks";
import { quoteFromRow } from "@/lib/hooks";
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS, type QuoteStatus } from "@/types";
import { Plus, Search, FileText } from "lucide-react";

export default function QuotesPage() {
  const customers = useCustomers(true);
  const customerName = useMemo(() => new Map(customers.map((c) => [c.id!, c.companyName])), [customers]);

  // Load all quotes directly (we want the raw row so we can rehydrate JSON columns).
  const { data: rawQuotes = [] } = useQuery({
    queryKey: ["quotes-all"],
    queryFn: async () => assertOk(await supabase.from("quotes").select("*").order("createdAt", { ascending: false })) as Array<Record<string, unknown>>,
  });
  const quotes = useMemo(() => rawQuotes.map(quoteFromRow), [rawQuotes]);

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<QuoteStatus | "all">("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((quote) => {
      if (filterStatus !== "all" && quote.status !== filterStatus) return false;
      if (!q) return true;
      const cName = (quote.customerId && customerName.get(quote.customerId)) ?? "";
      return (
        quote.title.toLowerCase().includes(q) ||
        cName.toLowerCase().includes(q)
      );
    });
  }, [quotes, search, filterStatus, customerName]);

  return (
    <div>
      <PageHeader title="Quotes" description="B2B pricing calculator + quote history" />
      <div className="px-4 pb-8 space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or customer"
              className="input !pl-9"
            />
          </div>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as QuoteStatus | "all")}
            className="input !w-auto text-sm"
          >
            <option value="all">All statuses</option>
            {QUOTE_STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABELS[s]}</option>)}
          </select>
          <Link
            href="/quotes/new"
            className="inline-flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium"
          >
            <Plus className="w-4 h-4" /> New quote
          </Link>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center">
            <FileText className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              {quotes.length === 0
                ? "No quotes yet. Click New quote to open the calculator."
                : "No quotes match the current filters."}
            </p>
          </div>
        ) : (
          <ul className="rounded-lg border border-border bg-card divide-y divide-border">
            {filtered.map((q) => {
              const cName = q.customerId ? (customerName.get(q.customerId) ?? "—") : (q.isWhatIf ? "What-If" : "—");
              const expired = q.expiresAt && new Date(q.expiresAt) < new Date();
              return (
                <li key={q.id}>
                  <Link href={`/quotes/${encodeURIComponent(q.id!)}`} className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/30">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{q.title || "Untitled quote"}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {cName}
                        {" · "}
                        {QUOTE_STATUS_LABELS[q.status]}
                        {q.feasible === false && " · tight capacity"}
                        {expired && q.status === "sent" && " · expired"}
                      </p>
                    </div>
                    <div className="text-right shrink-0 text-xs">
                      {q.sellPrice != null && (
                        <p className="font-medium tabular-nums">€{q.sellPrice.toFixed(2)}</p>
                      )}
                      {q.marginPercent != null && (
                        <p className="text-muted-foreground tabular-nums">{q.marginPercent.toFixed(0)}% margin</p>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
