"use client";

export interface TimelineMarker {
  /** ISO yyyy-mm-dd. */
  iso: string;
  label: string;
  /** "deep-teal" | "rose" — visual tone. */
  tone?: "primary" | "today";
}

/**
 * Campaign timeline strip — 4 ordered markers on a horizontal bar.
 * Elapsed shading from start to today; today gets a rose vertical
 * line, other markers get deep-teal verticals with bottom labels.
 */
export function TimelineStrip({
  startIso,
  endIso,
  markers,
  statusText,
  title = "Campaign timeline",
}: {
  startIso: string;
  endIso: string;
  markers: TimelineMarker[];
  statusText?: string;
  title?: string;
}) {
  const startMs = new Date(startIso + "T00:00:00").getTime();
  const endMs = new Date(endIso + "T23:59:59").getTime();
  const totalMs = Math.max(1, endMs - startMs);

  function pctFor(iso: string): number {
    const ms = new Date(iso + "T12:00:00").getTime();
    if (Number.isNaN(ms)) return 0;
    if (ms <= startMs) return 0;
    if (ms >= endMs) return 100;
    return ((ms - startMs) / totalMs) * 100;
  }

  const now = new Date();
  const nowIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const todayPct = pctFor(nowIso);
  const elapsedPct = Math.min(100, Math.max(0, todayPct));

  return (
    <section
      style={{
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderRadius: 8,
        padding: "16px 20px 28px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
            color: "var(--ds-text-muted)",
            fontWeight: 600,
          }}
        >
          {title}
        </h2>
        {statusText && (
          <span style={{ fontSize: 12, color: "var(--ds-text-muted)", fontStyle: "italic" }}>
            {statusText}
          </span>
        )}
      </div>

      <div
        style={{
          position: "relative",
          marginTop: 18,
          height: 8,
          background: "var(--ds-border-warm)",
          borderRadius: 4,
        }}
      >
        {/* Elapsed shading */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${elapsedPct}%`,
            background: "rgba(38, 68, 67, 0.18)",
            borderRadius: 4,
          }}
        />
        {/* Markers */}
        {markers.map((m, i) => {
          const pct = pctFor(m.iso);
          const tone = m.tone === "today" ? "var(--ds-tier-urgent)" : "var(--ds-tier-quarter-focus)";
          return (
            <div
              key={`${m.iso}-${i}`}
              style={{
                position: "absolute",
                left: `${pct}%`,
                top: -4,
                bottom: -4,
                width: 2,
                background: tone,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "calc(100% + 6px)",
                  transform: "translateX(-50%)",
                  whiteSpace: "nowrap",
                  fontSize: 10,
                  textAlign: "center",
                  color: m.tone === "today" ? "var(--ds-tier-urgent)" : "var(--ds-text-primary)",
                  fontWeight: 500,
                }}
              >
                <span style={{ display: "block" }}>{m.label}</span>
                <span
                  style={{
                    display: "block",
                    fontWeight: 400,
                    color: "var(--ds-text-muted)",
                  }}
                >
                  {shortDate(m.iso)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function shortDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso;
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("de-AT", { day: "numeric", month: "short" });
}
