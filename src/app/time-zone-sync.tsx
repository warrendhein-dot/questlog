"use client";

import { useEffect, useTransition } from "react";
import { saveTimeZone } from "@/app/profile/actions";

/**
 * Shows nothing. Compares the time zone the browser reports with the one saved in the profile and,
 * when they differ (first visit, or after travelling), saves the browser's. The server then redraws
 * the page, so "today" and "this week" switch to the user's own days.
 *
 * The browser's name is only ever a suggestion: the server checks it is a real time zone before
 * saving it.
 */
export function TimeZoneSync({ savedZone }: { savedZone: string }) {
  const [, startTransition] = useTransition();

  useEffect(() => {
    let browserZone: string | undefined;
    try {
      browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return; // A browser that cannot say: keep what is saved.
    }
    if (!browserZone || browserZone === savedZone) return;
    startTransition(async () => {
      try {
        await saveTimeZone(browserZone);
      } catch {
        // Not worth interrupting anyone for: the page keeps using the saved zone.
      }
    });
  }, [savedZone]);

  return null;
}
