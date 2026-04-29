import { Suspense } from "react";
import { SideNav } from "@/components/side-nav";
import { SeedLoader } from "@/components/seed-loader";
import { DemoModeOverlay } from "@/components/demo-mode-overlay";
import { AuthGate } from "@/components/auth-gate";
import { IosInstallBanner } from "@/components/ios-install-banner";
import { SectionAccent } from "@/components/section-accent";
import { UndoAffordance } from "@/components/undo-affordance";
import { NotificationBell } from "@/components/notification-bell";
import { DatePickerAutoOpen } from "@/components/date-picker-auto-open";
import { EnterAdvancesFocus } from "@/components/enter-advances-focus";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Suspense>
        <SectionAccent />
      </Suspense>
      <AuthGate>
        <IosInstallBanner />
        <div className="flex min-h-screen">
          <Suspense>
            <SideNav />
          </Suspense>
          <main
            className="flex-1 min-w-0 min-h-screen transition-[margin-left] duration-200 relative pl-2 sm:pl-4"
            style={{ marginLeft: "var(--nav-w)" }}
          >
            {/* Global top-right utilities — notification bell. Lives in
                the main area so it doesn't collide with the sidebar. */}
            <div className="absolute top-3 right-4 z-30">
              <NotificationBell />
            </div>
            {children}
          </main>
        </div>
        <UndoAffordance />
      </AuthGate>
      <SeedLoader />
      <DemoModeOverlay />
      <DatePickerAutoOpen />
      <EnterAdvancesFocus />
    </>
  );
}
