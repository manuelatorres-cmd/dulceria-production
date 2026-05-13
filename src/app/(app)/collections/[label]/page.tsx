"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { IconArrowLeft as ArrowLeft, IconChevronRight as ChevronRight } from "@tabler/icons-react";
import { useVariants } from "@/lib/hooks";
import type { Variant } from "@/types";

const UNLABELLED_SLUG = "unlabelled";

type VariantStatus = "active" | "upcoming" | "past" | "permanent";

function getStatus(v: Variant): VariantStatus {
  const today = new Date().toISOString().split("T")[0];
  if (!v.endDate) return v.startDate <= today ? "permanent" : "upcoming";
  if (v.startDate > today) return "upcoming";
  if (v.endDate < today) return "past";
  return "active";
}

const STATUS_LABEL: Record<VariantStatus, string> = {
  permanent: "standard",
  active: "active",
  upcoming: "upcoming",
  past: "past",
};

const STATUS_CLASS: Record<VariantStatus, string> = {
  permanent: "text-primary bg-primary/10",
  active: "text-status-ok bg-status-ok-bg",
  upcoming: "text-status-warn bg-status-warn-bg",
  past: "text-muted-foreground bg-muted",
};

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export default function CollectionDetailPage({
  params,
}: {
  params: Promise<{ label: string }>;
}) {
  const { label: rawSlug } = use(params);
  const slug = decodeURIComponent(rawSlug);
  const isUnlabelled = slug === UNLABELLED_SLUG;

  const variants = useVariants();

  const { matches, displayLabel } = useMemo(() => {
    if (isUnlabelled) {
      return {
        matches: variants.filter((v) => (v.labels ?? []).length === 0),
        displayLabel: "Unlabelled",
      };
    }
    const lower = slug.toLowerCase();
    let firstCasing = slug;
    const matches = variants.filter((v) => {
      for (const l of v.labels ?? []) {
        if (l.toLowerCase() === lower) {
          firstCasing = l; // last-write wins is fine; just need any real casing
          return true;
        }
      }
      return false;
    });
    return { matches, displayLabel: firstCasing };
  }, [variants, slug, isUnlabelled]);

  return (
    <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
      <div className="px-4 pt-6 pb-2">
        <Link
          href="/collections"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft aria-hidden="true" className="w-4 h-4" /> Collections
        </Link>
      </div>

      <div className="px-4 pb-10 space-y-4">
        <div>
          <h1 className="text-xl font-bold">{displayLabel}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {matches.length} variant{matches.length === 1 ? "" : "s"}
          </p>
        </div>

        {matches.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">
            {isUnlabelled
              ? "No unlabelled variants."
              : `No variants use the label "${displayLabel}" anymore.`}
          </p>
        ) : (
          <ul className="space-y-2">
            {matches.map((v) => {
              const status = getStatus(v);
              return (
                <li key={v.id} className="rounded-[6px] border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)]">
                  <Link
                    href={`/variants/${encodeURIComponent(v.id ?? "")}`}
                    className="flex items-center gap-3 p-3 min-w-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium text-sm truncate">{v.name}</h3>
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_CLASS[status]}`}
                        >
                          {STATUS_LABEL[status]}
                        </span>
                      </div>
                      {v.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {v.description}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-muted-foreground">
                          From {formatDate(v.startDate)}
                        </span>
                        {v.endDate && (
                          <>
                            <span className="text-muted-foreground/40 text-xs">→</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(v.endDate)}
                            </span>
                          </>
                        )}
                      </div>
                      {(v.labels ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {(v.labels ?? []).map((l) => (
                            <span
                              key={l}
                              className="text-[10px] rounded-sm bg-muted text-muted-foreground px-1.5 py-0.5"
                            >
                              {l}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
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
