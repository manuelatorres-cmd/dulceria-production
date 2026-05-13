export function PageHeader({
  title,
  description,
  accent,
}: {
  title: string;
  description?: string;
  /** Optional small uppercase label sitting above the title (section / eyebrow). */
  accent?: string;
}) {
  return (
    <header className="px-1 sm:px-2 pt-10 pb-6 border-b border-[color:var(--ds-border-warm)] mb-6">
      {accent ? (
        <div
          className="text-[10px] text-muted-foreground font-medium mb-2"
          style={{ letterSpacing: "0.14em", textTransform: "uppercase" }}
        >
          {accent}
        </div>
      ) : null}
      <h1
        className="text-[28px] sm:text-[32px]"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 400,
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
        }}
      >
        {title}
      </h1>
      {description ? (
        <p className="text-[13.5px] text-muted-foreground mt-2.5 max-w-2xl leading-relaxed">
          {description}
        </p>
      ) : null}
    </header>
  );
}
