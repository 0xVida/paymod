import type { Viewport } from "next";
import type { ReactNode } from "react";
import {
  Archivo,
  Bricolage_Grotesque,
  IBM_Plex_Mono,
  IBM_Plex_Serif,
  Instrument_Sans,
  Special_Elite,
} from "next/font/google";
import "./marketing.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});

const specialElite = Special_Elite({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-special-elite",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

const plexSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-plex-serif",
  display: "swap",
});

const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-bricolage",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-instrument-sans",
  display: "swap",
});

export const viewport: Viewport = { themeColor: "oklch(96% 0.012 75)", colorScheme: "light" };

const FONT_VARIABLES = [
  archivo.variable,
  specialElite.variable,
  plexMono.variable,
  plexSerif.variable,
  bricolageGrotesque.variable,
  instrumentSans.variable,
].join(" ");

/**
 * scoped to the marketing route group so its editorial typography stays out
 * of the dashboard
 */
export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className={FONT_VARIABLES}>
      {children}
    </div>
  );
}
