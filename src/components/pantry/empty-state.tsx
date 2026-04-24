/**
 * Empty-state message for pantry list pages.
 *
 * Shows a different message depending on whether the list is truly empty
 * (no records at all) vs. just filtered down to nothing.
 *
 * @example
 * <EmptyState
 *   hasData={materials.length > 0}
 *   emptyMessage="No decoration materials yet. Tap + to add your first."
 *   filteredMessage="No materials match your filters."
 * />
 */
export function EmptyState({
  hasData,
  emptyMessage,
  filteredMessage,
}: {
  /** True when records exist but none pass the current search/filters. */
  hasData: boolean;
  emptyMessage: string;
  filteredMessage: string;
}) {
  return (
    <p
      className="text-muted-foreground text-[13px] py-12 text-center italic"
      style={{ fontFamily: "var(--font-serif)", letterSpacing: "-0.01em", fontWeight: 400 }}
    >
      {hasData ? filteredMessage : emptyMessage}
    </p>
  );
}
