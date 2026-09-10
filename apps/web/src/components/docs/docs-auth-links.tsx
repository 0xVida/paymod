"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import styles from "@/app/(docs)/docs.module.css";

/**
 * starts signed-out so the docs page never blocks its first paint on the
 * API - upgrades in place once the client-side check resolves, instead of
 * the layout awaiting `/v1/auth/me` before rendering anything.
 */
export function DocsAuthLinks() {
  const [isSignedIn, setIsSignedIn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get("/v1/auth/me")
      .then(() => {
        if (!cancelled) setIsSignedIn(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (isSignedIn) {
    return (
      <Link href="/dashboard" className={styles["headerLink"]}>
        Dashboard
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Link href="/login" className={styles["headerLink"]}>
        Sign in
      </Link>
      <Link href="/signup" className={styles["headerLink"]}>
        Sign up
      </Link>
    </div>
  );
}
