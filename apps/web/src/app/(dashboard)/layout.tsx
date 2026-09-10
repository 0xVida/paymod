import type { ReactNode } from "react";
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "../(marketing)/marketing.css";
import "./product.css";

const appDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-bricolage",
  display: "swap",
});
const appSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-instrument-sans",
  display: "swap",
});
const appMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export default function ProductLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`light paymod-app ${appDisplay.variable} ${appSans.variable} ${appMono.variable}`}
    >
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.documentElement.classList.add('light');document.documentElement.style.colorScheme='light';",
        }}
      />
      {children}
    </div>
  );
}
