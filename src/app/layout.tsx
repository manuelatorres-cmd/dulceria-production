import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { ErrorBoundary } from "@/components/error-boundary";
import { GlobalErrorHandler } from "@/components/global-error-handler";
import { QueryProvider } from "@/components/query-provider";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const appTitle = "Dulceria";

export const metadata: Metadata = {
  title: appTitle,
  description: "Dulceria — fine vegan chocolates production planning.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: appTitle,
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("nav-collapsed")==="1")document.documentElement.setAttribute("data-nav-collapsed","1")}catch(e){}`,
          }}
        />
      </head>
      <body className="bg-background text-foreground font-sans antialiased">
        <QueryProvider>
          <ErrorBoundary>
            {/* Suspense boundary is required for static export: any client component
                using `useSearchParams()` otherwise triggers a CSR bailout and the
                build fails. Fallback is null — the real render happens client-side. */}
            <Suspense fallback={null}>{children}</Suspense>
          </ErrorBoundary>
          <GlobalErrorHandler />
          <ServiceWorkerRegister />
        </QueryProvider>
      </body>
    </html>
  );
}
