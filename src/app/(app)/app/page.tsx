"use client";

/**
 * Post-login landing — redirects to /dashboard.
 *
 * The old mode-selector lived here; it's been replaced by the dashboard
 * as the default landing per the §7 production planning brief.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AppRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);
  return null;
}
