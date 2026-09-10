"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * `NEXT_PUBLIC_SITE_URL` takes priority when set - a Vercel preview's own
 * `window.location.origin` is a throwaway per-deployment URL, not the
 * stable domain agents should be told to fetch. falls back to
 * `window.location.origin` otherwise.
 */
export function CopyUrlRow({ label, path }: { label: string; path: string }) {
  const [copied, setCopied] = useState(false);
  const origin =
    process.env["NEXT_PUBLIC_SITE_URL"] ||
    (typeof window !== "undefined" ? window.location.origin : "");
  const url = `${origin}${path}`;

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex items-center gap-2">
      <div className="w-32 shrink-0 text-sm text-muted-foreground">{label}</div>
      <Input
        readOnly
        value={url}
        className="font-mono text-xs"
        onFocus={(e) => e.currentTarget.select()}
      />
      <Button type="button" variant="outline" size="sm" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
