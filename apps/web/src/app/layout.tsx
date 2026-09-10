import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";

import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], display: "swap" });

const title = "Paymod | The pay moderator for autonomous software";
const description =
  "Controlled access to money for AI agents: treasury, policy engine, human approvals and a complete audit trail.";

export const metadata: Metadata = {
  title,
  description,
  authors: [{ name: "Paymod" }],
  openGraph: {
    title,
    description,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.className} ${jetbrainsMono.className}`}>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
