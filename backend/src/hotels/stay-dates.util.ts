import { BadRequestException } from '@nestjs/common';
import { localToUtc, utcToLocal } from '../flights/time-zone.util';

/**
 * Date helpers for hotel stays. A stay is described with the hotel's LOCAL calendar dates:
 *   checkIn  "2026-12-01" = the first night
 *   checkOut "2026-12-04" = the morning you leave (not a night)
 * so this stay is 3 nights: 12-01, 12-02 and 12-03.
 * Dates are kept as "YYYY-MM-DD" strings, which sort correctly as text.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** "2026-12-01" -> UTC midnight of that calendar date (only used for day arithmetic) */
function toDay(date: string): number {
  const m = DATE.exec(date);
  if (!m)
    throw new BadRequestException(`${date} is not a date like 2026-12-01`);
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  // rejects impossible dates such as 2026-02-30
  if (new Date(t).toISOString().slice(0, 10) !== date) {
    throw new BadRequestException(`${date} is not a real date`);
  }
  return t;
}

const fromDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return fromDay(toDay(date) + days * DAY_MS);
}

/** Number of nights between two dates (checkOut - checkIn) */
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((toDay(checkOut) - toDay(checkIn)) / DAY_MS);
}

/** Every night of a stay: ["2026-12-01", "2026-12-02", "2026-12-03"] for 12-01 -> 12-04 */
export function nightsOf(checkIn: string, checkOut: string): string[] {
  const n = nightsBetween(checkIn, checkOut);
  return Array.from({ length: n }, (_, i) => addDays(checkIn, i));
}

/** Today's date in the hotel's time zone, e.g. "2026-11-16" in Africa/Cairo */
export function todayIn(timeZone: string): string {
  return utcToLocal(new Date(), timeZone).slice(0, 10);
}

/** The exact UTC moment of a local date + "HH:mm" time in the hotel's time zone */
export function localMoment(
  date: string,
  time: string,
  timeZone: string,
): Date {
  // A time skipped by a daylight-saving change does not exist: use the next hour that does
  const [h, m] = time.split(':').map(Number);
  for (let extra = 0; extra < 3; extra++) {
    const hh = String(Math.min(h + extra, 23)).padStart(2, '0');
    const at = localToUtc(
      `${date}T${hh}:${String(m).padStart(2, '0')}`,
      timeZone,
    );
    if (at) return at;
  }
  return new Date(`${date}T${time}:00Z`);
}

/**
 * Checks a stay or date range and returns its nights.
 * `maxNights` and `maxDaysAhead` stop huge ranges that would create thousands of documents.
 */
export function validateRange(
  from: string,
  to: string,
  opts: {
    today: string;
    maxNights: number;
    maxDaysAhead: number;
    label?: string;
  },
): string[] {
  const label = opts.label ?? 'stay';
  const nights = nightsBetween(from, to);
  if (nights < 1) {
    throw new BadRequestException(
      `The ${label} must end at least one day after it starts`,
    );
  }
  if (from < opts.today) {
    throw new BadRequestException(
      `The ${label} cannot start in the past (today is ${opts.today})`,
    );
  }
  if (nights > opts.maxNights) {
    throw new BadRequestException(
      `The ${label} can be at most ${opts.maxNights} nights`,
    );
  }
  if (nightsBetween(opts.today, from) > opts.maxDaysAhead) {
    throw new BadRequestException(
      `The ${label} can start at most ${opts.maxDaysAhead} days from today`,
    );
  }
  return nightsOf(from, to);
}
