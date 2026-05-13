import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { ErrorBoundary } from "@/components/error-boundary";
import { GlobalErrorHandler } from "@/components/global-error-handler";
import { QueryProvider } from "@/components/query-provider";
import { ToastProvider } from "@/components/dulceria/toast-provider";

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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
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
          <ToastProvider>
            <ErrorBoundary>
              {/* Suspense boundary is required for static export: any client component
                  using `useSearchParams()` otherwise triggers a CSR bailout and the
                  build fails. Fallback is null — the real render happens client-side. */}
              <Suspense fallback={null}>{children}</Suspense>
            </ErrorBoundary>
            <GlobalErrorHandler />
            <ServiceWorkerRegister />
          </ToastProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
