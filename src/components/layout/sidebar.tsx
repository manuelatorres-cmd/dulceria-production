"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { usePendingShoppingCount } from "@/lib/hooks";
import { SIDEBAR_CONFIG, UTILITY_ITEMS, isItemActive } from "@/lib/layout/sidebar-config";
import { SidebarIcon } from "@/lib/layout/sidebar-icons";
import { useSidebarBadges } from "@/lib/layout/sidebar-badges";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import { SidebarSpace } from "./sidebar-space";
import { SidebarUtility } from "./sidebar-utility";

/**
 * Unified sidebar.
 *
 * Replaces the legacy `SideNav` per-space drawer pattern. Every space
 * stays visible at all times; click a chevron to expand/collapse the
 * sub-nav inline. The active route auto-expands its parent space.
 *
 * Spec: docs/SIDEBAR_REDESIGN_SPEC.md
 */
export function Sidebar() {
  const pathname = usePathname();
  const { expandedSpaces, toggleSpace } = useSidebarState();
  const badges = useSidebarBadges();
  const pendingShopping = usePendingShoppingCount();

  return (
    <nav className="sidebar" aria-label="Primary">
      <Link href="/dashboard" className="sb-logo" aria-label="Dulceria — go home">
        <img
          src="/logo.png"
          alt=""
          aria-hidden
          style={{ width: 28, height: 28, objectFit: "contain" }}
        />
        <img
          src="/dulceria-wordmark.png"
          alt="Dulceria"
          style={{
            height: 18,
            width: "auto",
            objectFit: "contain",
            filter: "brightness(0) invert(1)",
          }}
        />
      </Link>

      <Link
        href="/dashboard"
        className={"sb-home" + (isItemActive(pathname, "/dashboard") ? " sb-home-active" : "")}
      >
        <SidebarIcon name="home" size={16} />
        <span>Dashboard</span>
      </Link>

      <div className="sb-spaces-label">Spaces</div>

      <div className="sb-spaces">
        {SIDEBAR_CONFIG.map((space) => (
          <SidebarSpace
            key={space.id}
            space={space}
            expanded={expandedSpaces.has(space.id)}
            pathname={pathname}
            badges={badges}
            onToggle={() => toggleSpace(space.id)}
          />
        ))}
      </div>

      <div className="sb-bottom">
        {UTILITY_ITEMS.map((item) => (
          <SidebarUtility
            key={item.href}
            item={item}
            pathname={pathname}
            badge={item.href === "/shopping" ? pendingShopping : undefined}
          />
        ))}
      </div>

      <UserFooter />
    </nav>
  );
}

function UserFooter() {
  const [email, setEmail] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!email) return null;

  return (
    <button
      type="button"
      onClick={() => supabase.auth.signOut()}
      className="sb-user"
      title={`Signed in as ${email} — click to sign out`}
    >
      <span aria-hidden style={{ fontSize: 11, opacity: 0.5 }}>
        ↩
      </span>
      <span className="sb-user-email">{email}</span>
    </button>
  );
}
