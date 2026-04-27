/**
 * The locale to use for all date/time formatting. We pass `undefined`
 * to `toLocaleString` / `toLocaleDateString` / `toLocaleTimeString`,
 * which tells the runtime to use the browser/OS default locale — so a
 * user with `en-US` sees `04/27/2026, 10:20:16 AM`, a user with `de-DE`
 * sees `27.04.2026, 10:20:16`, and so on.
 *
 * Tests and headless environments can override this by setting
 * `window.__BORGMATIC_UI_LOCALE__` to a locale string before the page
 * renders.
 */
const getLocale = (): string | undefined => {
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __BORGMATIC_UI_LOCALE__?: string })
      .__BORGMATIC_UI_LOCALE__;
    if (typeof override === 'string' && override.length > 0) return override;
  }
  return undefined;
};

/**
 * Format date/time for display using the user's locale, in the user's
 * local timezone. The backend emits all ISO strings with an explicit
 * offset (`Z` or `+HH:MM`), so `new Date()` parses them unambiguously
 * and `toLocaleString` converts to the browser's zone.
 *
 * @param dateString - ISO date string or Date object
 * @returns Formatted date string in the user's locale (local time)
 */
export const formatDateTime = (dateString: string | Date): string => {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;

  return date.toLocaleString(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

/**
 * Build a verbose tooltip string for a timestamp, useful next to compact
 * formatted-date displays. Shows the user's local time *and* the original
 * UTC value, so users running in a non-UTC zone can see at a glance that
 * the displayed time has been converted (and is not the same as the
 * UTC-anchored archive name).
 *
 * Falls back to the raw input if parsing fails so we never surface "Invalid
 * Date" in a tooltip.
 */
export const formatDateTimeTooltip = (dateString: string | Date): string => {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return typeof dateString === 'string' ? dateString : String(dateString);
  }
  const tzName =
    Intl.DateTimeFormat().resolvedOptions().timeZone || 'local';
  const local = date.toLocaleString(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const utc = date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return `${local} (${tzName})\n${utc}`;
};

/**
 * Format date only (no time) using the user's locale.
 * @param dateString - ISO date string or Date object
 * @returns Formatted date string in the user's locale
 */
export const formatDate = (dateString: string | Date): string => {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;

  return date.toLocaleDateString(getLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

/**
 * Format time only (no date) using the user's locale.
 * @param dateString - ISO date string or Date object
 * @returns Formatted time string in the user's locale
 */
export const formatTime = (dateString: string | Date): string => {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;

  return date.toLocaleTimeString(getLocale(), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

