import type { ReactNode } from "react";
import Link from "next/link";
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { DocsAuthLinks } from "@/components/docs/docs-auth-links";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import Logo from "@/components/site/Logo";
import styles from "./docs.module.css";
import "../(marketing)/marketing.css";

const docsDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-bricolage",
  display: "swap",
});
const docsSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-instrument-sans",
  display: "swap",
});
const docsMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div
      className={`light ${styles["shell"]} ${docsDisplay.variable} ${docsSans.variable} ${docsMono.variable}`}
    >
      <header className={styles["header"]}>
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="hero-masthead-brand p-0" aria-label="Paymod home">
            <Logo size={28} />
            <span className={styles["wordmark"]}>Paymod</span>
            <span className={styles["docsLabel"]}>Docs</span>
          </Link>
          <DocsAuthLinks />
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-10 px-6 py-10">
        <aside className={`${styles["sidebar"]} hidden w-52 shrink-0 lg:block`}>
          <div className="sticky top-6">
            <DocsSidebar />
          </div>
        </aside>
        <main className={`${styles["content"]} min-w-0 flex-1`}>{children}</main>
      </div>
    </div>
  );
}
