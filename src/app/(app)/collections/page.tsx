"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useVariants } from "@/lib/hooks";

/**
 * Collections = derived view over variant labels. Every unique label
 * across all variants becomes a row; variants with empty `labels`
 * bucket into a synthetic "Unlabelled" row (hidden when its count = 0).
 *
 * Dedup + sort is case-insensitive. First-seen casing wins for display
 * (so "B2B" beats "b2b" if it appeared first on any variant).
 */

const UNLABELLED_SLUG = "unlabelled";

export default function CollectionsPage() {
  const variants = useVariants();

  const rows = useMemo(() => {
    const firstCasingByLower = new Map<string, string>();
    const countsByLower = new Map<string, number>();
    let unlabelled = 0;

    for (const v of variants) {
      const vLabels = v.labels ?? [];
      if (vLabels.length === 0) {
        unlabelled += 1;
        continue;
      }
      for (const label of vLabels) {
        const key = label.toLowerCase();
        if (!firstCasingByLower.has(key)) firstCasingByLower.set(key, label);
        countsByLower.set(key, (countsByLower.get(key) ?? 0) + 1);
      }
    }

    const labelled = Array.from(countsByLower.entries())
      .map(([key, count]) => ({
        key,
        display: firstCasingByLower.get(key) ?? key,
        count,
        slug: key, // URL-encoded at link time
      }))
      .sort((a, b) => a.display.toLowerCase().localeCompare(b.display.toLowerCase()));

    return { labelled, unlabelled };
  }, [variants]);

  const totalRows = rows.labelled.length + (rows.unlabelled > 0 ? 1 : 0);

  return (
    <div>
      <PageHeader
        title="Collections"
        description="Variants grouped by label — every label is a collection"
      />

      <div className="px-4 space-y-2 pb-6">
        {variants.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No variants yet.
          </p>
        ) : totalRows === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            No labels yet. Add a label on a variant to start grouping.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.labelled.map((row) => (
              <li key={row.key} className="rounded-sm border border-border bg-card">
                <Link
                  href={`/collections/${encodeURIComponent(row.slug)}`}
                  className="flex items-center gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm truncate">{row.display}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {row.count} variant{row.count === 1 ? "" : "s"}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Link>
              </li>
            ))}
            {rows.unlabelled > 0 && (
              <li className="rounded-sm border border-border border-dashed bg-card">
                <Link
                  href={`/collections/${UNLABELLED_SLUG}`}
                  className="flex items-center gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="font-medium text-sm text-muted-foreground italic">
                      Unlabelled
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {rows.unlabelled} variant{rows.unlabelled === 1 ? "" : "s"} with no labels
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </Link>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
