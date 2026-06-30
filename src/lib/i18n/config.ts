import { createNavigation } from "next-intl/navigation";

/**
 * Supported locales for the application.
 * Currently only English is supported; extend this array when adding
 * translations for additional languages.
 */
export const locales = ["en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/**
 * Routing configuration for next-intl.
 *
 * With a single locale this is a no-op — no locale prefix is added to
 * URLs. When additional locales are added, the `localePrefix` setting
 * controls whether the locale appears in the path (e.g. `/es/inbox`).
 */
export const routing = {
  locales,
  defaultLocale,
  localePrefix: "never" as const,
};

/**
 * Shared navigation primitives based on the routing config.
 *
 * These mirror Next.js's `useRouter` / `usePathname` / `Link` but are
 * locale-aware. In a single-locale setup they behave identically to
 * the standard Next.js hooks; when adding locales they automatically
 * handle the prefix without changing call sites.
 */
export const { Link, redirect, usePathname, useRouter } =
  createNavigation(routing);
