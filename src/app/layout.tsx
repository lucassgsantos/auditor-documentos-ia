import type { Metadata } from "next";
import { Fraunces, JetBrains_Mono, Public_Sans } from "next/font/google";

import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: "variable",
  axes: ["opsz"],
  style: ["normal", "italic"],
  display: "swap",
});

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Dossiê — Auditor de Documentos com IA",
  description:
    "Central de revisão documental com triagem de lote, anomalias rastreáveis e exportação auditável.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      data-theme="dark"
      className={`${fraunces.variable} ${publicSans.variable} ${jetbrainsMono.variable} h-full`}
    >
      <body className="min-h-full bg-[var(--canvas)] text-[var(--text)] antialiased">
        {children}
      </body>
    </html>
  );
}
