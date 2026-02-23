import type { Metadata } from "next";
import "./globals.css";
import Script from "next/script";

import { AppShell } from "@/components/layout/app-shell";
import { themeBootstrapScript } from "@/components/theme/theme-script";
import { ThemeProvider } from "@/components/theme/theme-provider";

export const metadata: Metadata = {
  title: "Seer Experience Platform",
  description: "Operational process intelligence and read-only ontology exploration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script id="seer-theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrapScript}
        </Script>
      </head>
      <body>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
