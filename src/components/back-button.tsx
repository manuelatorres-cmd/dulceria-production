"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { resolveBack } from "@/lib/navContext";

/**
 * Standard Back button for detail pages. Reads `?from=` (set by callers via
 * `withFrom`/`fromSuffix`) and links to the source page with a friendly label.
 * Falls back to a `router.back()` button (`onBack`) when no `from=` is present.
 *
 * Pages with `useNavigationGuard` should pass `safeBack` as `onBack` so the
 * dirty-state confirm still fires on the fallback. Anchor clicks are already
 * intercepted by the guard's capture-phase handler, so the `<Link>` path is
 * safe without further wrapping.
 *
 * On hub pages, omit `fallbackHref`/`onBack` so the button only renders when
 * the user actually arrived via a `?from=` link — avoids a meaningless Back on
 * a section root.
 */
export function BackButton({
  fallbackHref,
  fallbackLabel = "Back",
  onBack,
  className,
}: {
  /** Where to go when no `?from=` is set. Usually the resource's list page. */
  fallbackHref?: string;
  fallbackLabel?: string;
  /** Called when there is no `?from=` and no `fallbackHref`. Use `safeBack` from useNavigationGuard. */
  onBack?: () => void;
  className?: string;
}) {
  const sp = useSearchParams();
  const resolved = resolveBack(sp.get("from"), sp.get("fromId"));
  const cls = className ?? "inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors";

  if (resolved) {
    return (
      <Link href={resolved.href} className={cls}>
        <ArrowLeft aria-hidden="true" className="w-4 h-4" /> Back to {resolved.label}
      </Link>
    );
  }
  if (fallbackHref) {
    return (
      <Link href={fallbackHref} className={cls}>
        <ArrowLeft aria-hidden="true" className="w-4 h-4" /> {fallbackLabel}
      </Link>
    );
  }
  if (onBack) {
    return (
      <button type="button" onClick={onBack} className={cls}>
        <ArrowLeft aria-hidden="true" className="w-4 h-4" /> {fallbackLabel}
      </button>
    );
  }
  // Hub-page mode: render nothing unless a ?from= was supplied.
  return null;
}
