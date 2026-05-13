"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { assertOk } from "@/lib/supabase-query";
import { useCustomers, saveQuote, quoteFromRow } from "@/lib/hooks";
import { QUOTE_STATUSES, QUOTE_STATUS_LABELS, type QuoteStatus } from "@/types";
import {
  PageHeader,
  Section,
  ListRow,
  StatusTag,
  DsButton,
  DsTabNav,
  type ListRowTier,
} from "@/components/dulceria";
import { IconPlus, IconSearch, IconFileText } from "@tabler/icons-react";

type Filter = "all" | QuoteStatus;

const STATUS_TIER: Record<QuoteStatus, ListRowTier> = {
  draft: "default",
  sent: "active",
  won: "positive",
  lost: "parked",
  expired: "parked",
};

export default function QuotesPage() {
  const router = useRouter();
  const customers = useCustomers(true);
  const customerName = useMemo(
    () => new Map(customers.map((c) => [c.id!, c.companyName])),
    [customers],
  );

  const { data: rawQuotes = [] } = useQuery({
    queryKey: ["quotes-all"],
    queryFn: async () =>
      assertOk(
        await supabase.from("quotes").select("*").order("createdAt", { ascending: false }),
      ) as Array<Record<string, unknown>>,
  });
  const quotes = useMemo(() => rawQuotes.map(quoteFromRow), [rawQuotes]);

  const autoExpiredRef = useRef(new Set<string>());
  useEffect(() => {
    const now = Date.now();
    const stale = quotes.filter(
      (q) =>
        q.id &&
        q.status === "sent" &&
        q.expiresAt &&
        new Date(q.expiresAt).getTime() < now &&
        !autoExpiredRef.current.has(q.id),
    );
    if (stale.length === 0) return;
    for (const q of stale) autoExpiredRef.current.add(q.id!);
    void Promise.all(stale.map((q) => saveQuote({ ...q, status: "expired" })));
  }, [quotes]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(() => {
    const c: Record<QuoteStatus, number> = { draft: 0, sent: 0, won: 0, lost: 0, expired: 0 };
    for (const q of quotes) c[q.status]++;
    return c;
  }, [quotes]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return quotes.filter((quote) => {
      if (filter !== "all" && quote.status !== filter) return false;
      if (!q) return true;
      const cName = (quote.customerId && customerName.get(quote.customerId)) ?? "";
      return quote.title.toLowerCase().includes(q) || cName.toLowerCase().includes(q);
    });
  }, [quotes, search, filter, customerName]);

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Quotes"
        meta={`B2B pricing calculator + quote history · ${quotes.length} total${counts.sent > 0 ? ` · ${counts.sent} sent` : ""}${counts.won > 0 ? ` · ${counts.won} won` : ""}`}
        actions={
          <DsButton variant="primary" size="md" onClick={() => router.push("/quotes/new")}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconPlus size={14} stroke={1.5} /> New quote
            </span>
          </DsButton>
        }
      />

      <div style={{ padding: "16px 32px 40px", display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              border: "0.5px solid var(--ds-border-warm)",
              background: "var(--ds-card-bg)",
              borderRadius: 14,
              maxWidth: 360,
            }}
          >
            <IconSearch size={13} stroke={1.5} style={{ color: "var(--ds-text-muted)" }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title or customer…"
              style={{
                fontSize: 12,
                border: "none",
                background: "transparent",
                outline: "none",
                flex: 1,
                color: "var(--ds-text-primary)",
              }}
            />
          </div>
          <DsTabNav
            variant="pills"
            tabs={[
              { id: "all", label: "All", count: quotes.length },
              ...QUOTE_STATUSES.map((s) => ({
                id: s,
                label: QUOTE_STATUS_LABELS[s],
                count: counts[s],
              })),
            ]}
            activeTab={filter}
            onChange={(id) => setFilter(id as Filter)}
          />
        </div>

        {filtered.length === 0 ? (
          <div
            style={{
              borderRadius: 14,
              border: "1px dashed var(--ds-border-warm)",
              background: "var(--ds-card-bg)",
              padding: "48px 24px",
              textAlign: "center",
            }}
          >
            <IconFileText size={28} stroke={1.5} style={{ color: "var(--ds-text-muted)", margin: "0 auto 8px" }} />
            <p style={{ fontSize: 13, color: "var(--ds-text-muted)" }}>
              {quotes.length === 0
                ? "No quotes yet. Click New quote to open the calculator."
                : "No quotes match the current filter."}
            </p>
          </div>
        ) : (
          <Section title="Quotes" action={`${filtered.length} of ${quotes.length}`}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {filtered.map((q) => {
                const cName = q.customerId
                  ? customerName.get(q.customerId) ?? "—"
                  : q.isWhatIf
                  ? "What-If"
                  : "—";
                const expired = q.expiresAt && new Date(q.expiresAt) < new Date();
                const tier: ListRowTier =
                  q.feasible === false ? "urgent" : STATUS_TIER[q.status];

                return (
                  <li key={q.id} style={{ listStyle: "none" }}>
                    <Link
                      href={`/quotes/${encodeURIComponent(q.id!)}`}
                      style={{ textDecoration: "none", color: "inherit", display: "block" }}
                    >
                      <ListRow
                        tier={tier}
                        title={
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "baseline",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <span>{q.title || "Untitled quote"}</span>
                            <StatusTag kind={statusTagKind(q.status)}>
                              {QUOTE_STATUS_LABELS[q.status]}
                            </StatusTag>
                            {q.feasible === false && (
                              <StatusTag kind="pending">Tight capacity</StatusTag>
                            )}
                            {expired && q.status === "sent" && (
                              <StatusTag kind="overdue">Expired</StatusTag>
                            )}
                          </span>
                        }
                        meta={cName}
                        side={
                          <div style={{ textAlign: "right" }}>
                            {q.sellPrice != null && (
                              <div
                                style={{
                                  fontWeight: 500,
                                  fontVariantNumeric: "tabular-nums",
                                  fontSize: 13,
                                }}
                              >
                                €{q.sellPrice.toFixed(2)}
                              </div>
                            )}
                            {q.marginPercent != null ? (
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--ds-text-muted)",
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                {q.marginPercent.toFixed(0)}% margin
                              </div>
                            ) : null}
                          </div>
                        }
                      />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

function statusTagKind(status: QuoteStatus): "pending" | "scheduled" | "ready" | "overdue" | "done" | "neutral" {
  switch (status) {
    case "draft":
      return "neutral";
    case "sent":
      return "scheduled";
    case "won":
      return "ready";
    case "lost":
      return "done";
    case "expired":
      return "overdue";
  }
}
