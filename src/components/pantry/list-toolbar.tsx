import { IconSearch as Search, IconAdjustmentsHorizontal as SlidersHorizontal, IconPlus as Plus } from "@tabler/icons-react";

/**
 * Standard toolbar for pantry list pages: search input + optional filter toggle + add button.
 *
 * Always rendered at the top of `<div className="px-4 space-y-3 pb-6">` (directly under
 * the <PageHeader>). Keep all three slots — even pages without filters should still render
 * the add button with `title="Add X (n)"` to signal the keyboard shortcut.
 *
 * Props
 * ─────
 * `search` / `onSearchChange`         — controlled search input value
 * `searchPlaceholder`                 — defaults to "Search…"
 * `searchAriaLabel`                   — for screen readers
 * `onAdd`                             — called when the + button is clicked
 * `addAriaLabel`                      — for screen readers  (e.g. "Add ingredient")
 * `addTitle`                          — tooltip shown on hover (e.g. "Add ingredient (n)")
 * `showFilters` / `onToggleFilters`   — set both to enable the filter toggle button
 * `filterPanelOpen`                   — whether the filter panel is currently visible
 * `activeFilterCount`                 — drives the badge on the filter button
 *
 * @example
 * <ListToolbar
 *   search={search}
 *   onSearchChange={setSearch}
 *   searchPlaceholder="Search name or manufacturer…"
 *   searchAriaLabel="Search decoration materials"
 *   onAdd={() => setShowAdd(true)}
 *   addAriaLabel="Add decoration material"
 *   addTitle="Add material (n)"
 *   showFilters
 *   filterPanelOpen={showFilters}
 *   onToggleFilters={() => setShowFilters((v) => !v)}
 *   activeFilterCount={activeFilterCount}
 * />
 */
export function ListToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  searchAriaLabel,
  onAdd,
  addAriaLabel = "Add item",
  addTitle,
  showFilters,
  filterPanelOpen,
  onToggleFilters,
  activeFilterCount = 0,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  searchAriaLabel?: string;
  onAdd: () => void;
  addAriaLabel?: string;
  addTitle?: string;
  /** Show the filter toggle button. Requires `onToggleFilters`. */
  showFilters?: boolean;
  /** Whether the filter panel is currently open — controls the button's active style. */
  filterPanelOpen?: boolean;
  onToggleFilters?: () => void;
  /** Badge count on the filter button. */
  activeFilterCount?: number;
}) {
  return (
    <div className="flex gap-2">
      {/* Search */}
      <div className="flex-1 relative min-w-0">
        <Search aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchAriaLabel}
          className="input !pl-9"
        />
      </div>

      {/* Filter toggle */}
      {showFilters && onToggleFilters && (
        <button
          type="button"
          onClick={onToggleFilters}
          className={`relative border px-3 h-[38px] transition-colors ${
            filterPanelOpen
              ? "bg-foreground text-background border-foreground"
              : "border-[color:var(--ds-border-warm)] bg-[color:var(--ds-card-bg)] hover:border-foreground"
          }`}
          style={{ borderRadius: 4 }}
          aria-label="Filters"
          aria-expanded={filterPanelOpen}
        >
          <SlidersHorizontal className="w-4 h-4" />
          {activeFilterCount > 0 && (
            <span
              className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-[color:var(--accent-terracotta-ink)] text-white text-[9px] font-semibold flex items-center justify-center leading-none"
              style={{ borderRadius: 2 }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>
      )}

      {/* Add */}
      <button
        type="button"
        onClick={onAdd}
        title={addTitle}
        aria-label={addAriaLabel}
        className="bg-foreground text-background px-3 h-[38px] hover:opacity-90 transition-opacity"
        style={{ borderRadius: 4 }}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}
