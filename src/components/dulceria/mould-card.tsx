"use client";

import Link from "next/link";

export type MouldShape = "bar" | "heart" | "circle" | "default";

/** Built-in placeholder SVGs when no photo uploaded. */
export function MouldSvg({ shape, cavities = 1 }: { shape: MouldShape; cavities?: number }) {
  const stroke = "var(--ds-text-muted)";
  const opacity = 0.45;

  if (shape === "heart") {
    return (
      <svg viewBox="0 0 80 64" width="60%" height="60%" fill="none" stroke={stroke} strokeWidth={1.5} style={{ opacity }}>
        <path d="M40 56 L10 28 a12 12 0 0 1 30 -8 a12 12 0 0 1 30 8 z" />
      </svg>
    );
  }
  if (shape === "circle") {
    const cols = cavities >= 16 ? 5 : cavities >= 9 ? 4 : cavities >= 4 ? 3 : 2;
    const rows = Math.ceil(Math.max(1, Math.min(cavities, 25)) / cols);
    const r = 6;
    const gap = 14;
    const w = cols * gap;
    const h = rows * gap;
    const dots: { cx: number; cy: number }[] = [];
    let n = 0;
    for (let row = 0; row < rows && n < Math.min(cavities, 25); row++) {
      for (let col = 0; col < cols && n < Math.min(cavities, 25); col++) {
        dots.push({ cx: col * gap + gap / 2, cy: row * gap + gap / 2 });
        n++;
      }
    }
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="70%" height="70%" fill="none" stroke={stroke} strokeWidth={1.2} style={{ opacity }}>
        {dots.map((d, i) => (
          <circle key={i} cx={d.cx} cy={d.cy} r={r} />
        ))}
      </svg>
    );
  }
  if (shape === "bar") {
    const cols = Math.min(8, Math.max(2, Math.ceil(Math.sqrt(Math.max(1, cavities)))));
    const rows = Math.ceil(Math.max(1, Math.min(cavities, 32)) / cols);
    const cellW = 10;
    const cellH = 14;
    const cells: { x: number; y: number }[] = [];
    let n = 0;
    for (let r = 0; r < rows && n < Math.min(cavities, 32); r++) {
      for (let c = 0; c < cols && n < Math.min(cavities, 32); c++) {
        cells.push({ x: c * cellW, y: r * cellH });
        n++;
      }
    }
    const W = cols * cellW;
    const H = rows * cellH;
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width="80%" height="70%" fill="none" stroke={stroke} strokeWidth={1.2} style={{ opacity }}>
        {cells.map((c, i) => (
          <rect key={i} x={c.x + 1} y={c.y + 1} width={cellW - 2} height={cellH - 2} rx={1} />
        ))}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 80 56" width="70%" height="60%" fill="none" stroke={stroke} strokeWidth={1.5} style={{ opacity }}>
      <rect x={4} y={4} width={72} height={48} rx={3} />
    </svg>
  );
}

export function inferMouldShape(name: string, tags?: string[]): MouldShape {
  const blob = `${name} ${(tags ?? []).join(" ")}`.toLowerCase();
  if (blob.includes("heart") || blob.includes("herz")) return "heart";
  if (blob.includes("bonbon") || blob.includes("round") || blob.includes("sphere") || blob.includes("circle") || blob.includes("dome")) return "circle";
  if (blob.includes("bar") || blob.includes("tafel") || blob.includes("rectangle")) return "bar";
  return "default";
}

export function MouldCard({
  href,
  name,
  brand,
  weightG,
  cavities,
  photoUrl,
  shape = "default",
  archived,
}: {
  href: string;
  name: string;
  brand?: string;
  weightG?: number;
  cavities?: number;
  photoUrl?: string;
  shape?: MouldShape;
  archived?: boolean;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "block",
        background: "var(--ds-card-bg)",
        border: "0.5px solid var(--ds-border-warm)",
        borderRadius: 6,
        overflow: "hidden",
        color: "var(--ds-text-primary)",
        textDecoration: "none",
        opacity: archived ? 0.5 : 1,
      }}
      className="hover:[border-color:var(--ds-tier-quarter-focus)]"
    >
      <div
        style={{
          aspectRatio: "1.4 / 1",
          background: "var(--ds-card-bg-hover)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <MouldSvg shape={shape} cavities={cavities ?? 1} />
        )}
      </div>
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
        <strong
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ds-text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </strong>
        {brand && (
          <span
            style={{
              fontSize: 11,
              color: "var(--ds-text-muted)",
              fontStyle: "italic",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {brand}
          </span>
        )}
        {(weightG ?? 0) > 0 || (cavities ?? 0) > 0 ? (
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            {(weightG ?? 0) > 0 && (
              <Spec value={`${weightG} g`} label="weight" />
            )}
            {(cavities ?? 0) > 0 && (
              <Spec value={String(cavities)} label="cavities" />
            )}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

function Spec({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 13,
          fontWeight: 500,
          color: "var(--ds-text-primary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </p>
      <p
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--ds-text-muted)",
        }}
      >
        {label}
      </p>
    </div>
  );
}
