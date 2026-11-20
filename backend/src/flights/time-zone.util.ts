/**
 * Airport time zone helpers (no extra library needed, uses the built-in Intl API).
 *
 * Moderators enter flight times in each airport's LOCAL time, e.g. "2026-12-01T09:30" in Cairo.
 * We store the exact moment in UTC, so durations and sorting are always correct,
 * and convert back to local time for every response.
 */

const LOCAL_FORMAT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;

/** How far `tz` is ahead of UTC at the given moment, in milliseconds (Cairo in winter = +2h) */
function offsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** "2026-12-01T09:30" in "Africa/Cairo" -> the exact UTC moment. Returns null if that local time does not exist. */
export function localToUtc(local: string, tz: string): Date | null {
  const m = LOCAL_FORMAT.exec(local);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let result = guess - offsetMs(new Date(guess), tz);
  // second pass handles the hours around daylight-saving changes
  result = guess - offsetMs(new Date(result), tz);
  const date = new Date(result);
  // reject impossible times such as "2026-02-30T10:00" or a time skipped by daylight saving
  return utcToLocal(date, tz) === local ? date : null;
}

/** Exact UTC moment -> "2026-12-01T09:30" in the airport's local time */
export function utcToLocal(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** A whole local calendar day ("2026-12-01" in Cairo) as a UTC range [start, end) for searching */
export function localDayToUtcRange(day: string, tz: string): { start: Date; end: Date } | null {
  const m = DATE_FORMAT.exec(day);
  if (!m) return null;
  const start = localToUtc(`${day}T00:00`, tz);
  const next = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  const nextDay = next.toISOString().slice(0, 10);
  const end = localToUtc(`${nextDay}T00:00`, tz);
  if (!start || !end) return null;
  return { start, end };
}

/** e.g. "+02:00", shown next to local times so the traveller sees the time zone offset */
export function utcOffsetLabel(at: Date, tz: string): string {
  const mins = Math.round(offsetMs(at, tz) / 60000);
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}
