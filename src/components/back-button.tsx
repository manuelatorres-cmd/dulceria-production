"use client";

import Link from "next/link";
import { IconArrowLeft as ArrowLeft } from "@tabler/icons-react";
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
  const cls = className ?? PILL_CLS;
  const iconCls = "w-3.5 h-3.5 transition-transform duration-200 group-hover:-translate-x-0.5";

  if (resolved) {
    return (
      <Link href={resolved.href} className={cls}>
        <ArrowLeft aria-hidden="true" className={iconCls} /> Back to {resolved.label}
      </Link>
    );
  }
  if (fallbackHref) {
    return (
      <Link href={fallbackHref} className={cls}>
        <ArrowLeft aria-hidden="true" className={iconCls} /> {fallbackLabel}
      </Link>
    );
  }
  if (onBack) {
    return (
      <button type="button" onClick={onBack} className={cls}>
        <ArrowLeft aria-hidden="true" className={iconCls} /> {fallbackLabel}
      </button>
    );
  }
  // Hub-page mode: render nothing unless a ?from= was supplied.
  return null;
}

/** iOS-glass pill chip — soft tint, hairline border, brand-accent focus ring. */
const PILL_CLS = [
  "group inline-flex items-center gap-1.5 rounded-full",
  "bg-[color:var(--ds-card-bg)] ",
  "border border-foreground/10",
  "px-3 py-1.5 min-h-[32px]",
  "text-[12px] font-medium tracking-tight text-foreground/65",
  "shadow-[0_1px_2px_rgba(16,18,24,0.04)]",
  "transition-all duration-200 ease-out",
  "hover:bg-white/85 hover:text-foreground hover:border-foreground/20",
  "hover:shadow-[0_1px_2px_rgba(16,18,24,0.06),0_4px_12px_rgba(16,18,24,0.06)]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4a6b5b]/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  "active:scale-[0.97]",
].join(" ");
