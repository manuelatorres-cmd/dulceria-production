import { IconX as X } from "@tabler/icons-react";

/**
 * Container for a pantry page's filter section.
 *
 * Renders a card with `children` (your <FilterChipGroup> rows) and a
 * "Clear all filters" button at the bottom when `activeFilterCount > 0`.
 *
 * @example
 * {showFilters && (
 *   <FilterPanel activeFilterCount={activeFilterCount} onClearAll={clearFilters}>
 *     <FilterChipGroup label="Stock status" ... />
 *     <FilterChipGroup label="Type" multi ... />
 *   </FilterPanel>
 * )}
 */
export function FilterPanel({
  children,
  activeFilterCount,
  onClearAll,
}: {
  children: React.ReactNode;
  activeFilterCount: number;
  onClearAll: () => void;
}) {
  return (
    <div
      className="border-[0.5px] border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] p-4 space-y-3.5"
      style={{ borderRadius: 4 }}
    >
      {children}
      {activeFilterCount > 0 && (
        <button
          type="button"
          onClick={onClearAll}
          className="text-[11px] text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors uppercase"
          style={{ letterSpacing: "0.08em" }}
        >
          <X className="w-3 h-3" />
          Clear all filters
        </button>
      )}
    </div>
  );
}
