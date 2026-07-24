/**
 * Date formatting for the cycle views (handoff §6/§7): week markers and
 * cycle ranges render in the short "Jul 14" form, always UTC — cycle
 * boundaries come from milestone dueOn timestamps and must not shift with
 * the viewer's timezone (a cycle ending "Jul 28" must read Jul 28 in every
 * office).
 */
const monthDayFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Jul 14" for an ISO string, epoch ms, or Date. */
export function monthDay(date: string | number | Date): string {
    return monthDayFmt.format(new Date(date));
}

/** "Jul 14 – Jul 28" — a cycle's window (en dash, the handoff's form). */
export function dateRange(startIso: string, endIso: string): string {
    return `${monthDay(startIso)} – ${monthDay(endIso)}`;
}
