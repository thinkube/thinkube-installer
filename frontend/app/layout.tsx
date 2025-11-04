/*
 * Copyright 2025 Alejandro Martínez Corriá and the Thinkube contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Metadata } from "next";
import { Poppins, Noto_Sans_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TkAppHeader } from "thinkube-style/components/utilities";

const poppins = Poppins({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-poppins",
  display: "swap",
});

const notoSansMono = Noto_Sans_Mono({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-noto-sans-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Thinkube Installer",
  description: "AI-focused Kubernetes homelab platform installer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${poppins.variable} ${notoSansMono.variable}`}>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="min-h-screen bg-background flex flex-col">
            <TkAppHeader title="Thinkube Installer" />

            <main className="flex-1">
              {children}
            </main>

            <footer className="py-4 bg-muted text-center">
              <p className="text-sm text-muted-foreground">
                © 2025 Alejandro Martínez Corriá and the Thinkube contributors | Apache-2.0 License
              </p>
            </footer>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
