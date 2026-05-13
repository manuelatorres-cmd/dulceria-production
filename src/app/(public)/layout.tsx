import Link from "next/link";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ ["--nav-w" as string]: "0px" }}
    >
      <header className="border-b border-[color:var(--ds-border-warm)]">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 text-foreground hover:opacity-80 transition-opacity">
            <img src="/logo.png" alt="" className="w-7 h-7 rounded object-contain" />
            <span className="text-sm font-semibold tracking-tight">Dulceria</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1 text-sm">
            <Link
              href="/getting-started"
              className="px-3 py-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Getting started
            </Link>
            <Link
              href="/app"
              className="btn-primary"
            >
              Open the app
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-[color:var(--ds-border-warm)] mt-16">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <div>Dulceria · Fine vegan chocolates · Lilienbrunngasse 5/1A, 1020 Wien</div>
          <div>Made with ❤️ for you. The world needs more kindness (and more chocolate!)</div>
        </div>
      </footer>
    </div>
  );
}
