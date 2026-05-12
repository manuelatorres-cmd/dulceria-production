"use client";

import { IconSearch as Search } from "@tabler/icons-react";

export type DemandFilter = "all" | "online" | "po" | "urgent" | "lowstock";

const PILLS: Array<{ id: DemandFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "online", label: "Online orders" },
  { id: "po", label: "POs" },
  { id: "urgent", label: "Urgent" },
  { id: "lowstock", label: "Low stock" },
];

export function FilterRow({
  filter,
  onFilterChange,
  search,
  onSearchChange,
}: {
  filter: DemandFilter;
  onFilterChange: (f: DemandFilter) => void;
  search: string;
  onSearchChange: (s: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{
          border: "0.5px solid var(--mp-border-warm)",
          borderRadius: 4,
          background: "var(--mp-card-bg)",
        }}
      >
        <Search className="w-3.5 h-3.5" style={{ color: "var(--mp-text-muted)" }} />
        <input
          type="text"
          placeholder="Search product name…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 bg-transparent border-none outline-none text-[13px]"
          style={{ color: "var(--mp-text-primary)" }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PILLS.map((p) => {
          const active = filter === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onFilterChange(p.id)}
              className="px-2.5 py-1 text-[12px]"
              style={{
                border: `0.5px solid ${active ? "var(--mp-teal)" : "var(--mp-border-warm)"}`,
                background: active ? "var(--mp-teal)" : "var(--mp-card-bg)",
                color: active ? "#ffffff" : "var(--mp-text-muted)",
                borderRadius: 14,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
