"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useVariants } from "@/lib/hooks";
import { PageHeader, CollectionCard, DsButton } from "@/components/dulceria";
import { IconAdjustments } from "@tabler/icons-react";

const UNLABELLED_SLUG = "unlabelled";

export default function CollectionsPage() {
  const router = useRouter();
  const variants = useVariants();

  const rows = useMemo(() => {
    const firstCase = new Map<string, string>();
    const counts = new Map<string, number>();
    let unlabelled = 0;

    for (const v of variants) {
      const labels = v.labels ?? [];
      if (labels.length === 0) {
        unlabelled++;
        continue;
      }
      for (const l of labels) {
        const key = l.toLowerCase();
        if (!firstCase.has(key)) firstCase.set(key, l);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    const labelled = Array.from(counts.entries())
      .map(([key, count]) => ({ key, display: firstCase.get(key) ?? key, count }))
      .sort((a, b) => a.display.toLowerCase().localeCompare(b.display.toLowerCase()));

    return { labelled, unlabelled };
  }, [variants]);

  const totalCollections = rows.labelled.length;

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <PageHeader
        title="Collections"
        meta={`Variant labels grouped — every label is a collection · derived from Variants · ${totalCollections} label${totalCollections === 1 ? "" : "s"}${rows.unlabelled > 0 ? ` · ${rows.unlabelled} unlabelled variant${rows.unlabelled === 1 ? "" : "s"}` : ""}`}
        actions={
          <DsButton variant="default" size="md" onClick={() => router.push("/variants")}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <IconAdjustments size={14} stroke={1.5} /> Manage labels →
            </span>
          </DsButton>
        }
      />

      <div style={{ padding: "16px 32px 40px" }}>
        {variants.length === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            No variants yet.
          </p>
        ) : totalCollections === 0 && rows.unlabelled === 0 ? (
          <p
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontFamily: "var(--font-serif)",
              fontSize: 14,
              color: "var(--ds-text-muted)",
            }}
          >
            No labels yet. Add a label on a variant to start grouping.
          </p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
            }}
          >
            {rows.labelled.map((row) => (
              <CollectionCard
                key={row.key}
                href={`/variants?filter=label:${encodeURIComponent(row.display)}`}
                name={row.display}
                count={row.count}
              />
            ))}
            {rows.unlabelled > 0 && (
              <CollectionCard
                href={`/collections/${UNLABELLED_SLUG}`}
                name="Unlabelled"
                count={rows.unlabelled}
                unlabelled
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
