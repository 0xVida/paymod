import type { Metadata } from "next";
import Faq from "@/components/site/Faq";
import Footer from "@/components/site/Footer";
import Header from "@/components/site/Header";
import Hero from "@/components/site/Hero";
import Ledger from "@/components/site/Ledger";
import PaymodCode from "@/components/site/PaymodCode";
import Policy from "@/components/site/Policy";
import Surfaces from "@/components/site/Surfaces";
import WalletIsolation from "@/components/site/WalletIsolation";
import X402Section from "@/components/site/X402Section";

const title = "Paymod | The pay moderator for autonomous software";
const description =
  "Paymod gives AI agents controlled access to money: fund a treasury, set spending limits and approval rules and every x402 payment or onchain transfer is checked, escalated or blocked, with a full audit trail.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function Page() {
  return (
    <>
      <a className="skip-link mono" href="#main">
        Skip to content
      </a>
      <Header />
      <div className="hero-board-stack">
        <Hero />
        <WalletIsolation />
        <X402Section />
      </div>
      <main id="main">
        <Policy />
        <Surfaces />
        <PaymodCode />
        <Ledger />
        <Faq />
      </main>
      <Footer />
    </>
  );
}
