"use client";

import { PageHeader } from "@/components/dulceria";
import { SettingsProvider } from "@/components/settings/settings-provider";
import { MarketSection } from "@/components/settings/market-section";

export default function SettingsMarketPage() {
  return (
    <SettingsProvider>
      <div className="ds" style={{ minHeight: "100vh", background: "var(--ds-page-bg)" }}>
        <PageHeader title="Target market" meta="Region, currency, may-contain allergens, default fill mode" />
        <div className="px-4 pb-8 pt-4 max-w-3xl">
          <MarketSection />
        </div>
      </div>
    </SettingsProvider>
  );
}
