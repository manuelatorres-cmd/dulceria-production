/**
 * "Collapse all / Expand all" controls shown at the top of a grouped list.
 *
 * Only render these when the list has results — they have no effect on an empty list.
 *
 * @example
 * {grouped.length > 0 && (
 *   <CollapseControls
 *     onCollapseAll={() => setCollapsedGroups(new Set(grouped.map((g) => g.key)))}
 *     onExpandAll={() => setCollapsedGroups(new Set())}
 *   />
 * )}
 */
export function CollapseControls({
  onCollapseAll,
  onExpandAll,
}: {
  onCollapseAll: () => void;
  onExpandAll: () => void;
}) {
  return (
    <div className="flex justify-end gap-4">
      <button
        onClick={onCollapseAll}
        className="text-[10.5px] text-muted-foreground hover:text-foreground transition-colors uppercase"
        style={{ letterSpacing: "0.1em" }}
      >
        Collapse all
      </button>
      <button
        onClick={onExpandAll}
        className="text-[10.5px] text-muted-foreground hover:text-foreground transition-colors uppercase"
        style={{ letterSpacing: "0.1em" }}
      >
        Expand all
      </button>
    </div>
  );
}
