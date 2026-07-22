// Relative timestamps for the queue. Kept pure — `now` is a parameter, never
// read from the clock — so the boundaries are testable.

/**
 * "3h ago" / "in 5m" / "12 Mar" for anything older than a week.
 *
 * A queue is read at a glance: "2d ago" answers "is this stale?" instantly,
 * where an ISO timestamp makes the reader do arithmetic. Beyond a week the
 * relative form stops helping ("47d ago" means nothing), so it becomes a date.
 */
export function relTime(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";

  const diff = now - then;
  const future = diff < 0;
  const secs = Math.floor(Math.abs(diff) / 1000);
  const say = (v: string) => (future ? `in ${v}` : `${v} ago`);

  if (secs < 45) return future ? "in a moment" : "just now";
  if (secs < 3600) return say(`${Math.max(1, Math.round(secs / 60))}m`);
  if (secs < 86_400) return say(`${Math.round(secs / 3600)}h`);
  if (secs < 7 * 86_400) return say(`${Math.round(secs / 86_400)}d`);

  const d = new Date(then);
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  // The year only earns its space when it isn't the current one.
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear ? `${d.getDate()} ${month}` : `${d.getDate()} ${month} ${d.getFullYear()}`;
}

/** Bytes as something a human reads at a glance. */
export function fileSize(bytes: number): string {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
