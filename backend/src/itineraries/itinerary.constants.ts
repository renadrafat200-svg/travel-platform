import { BadRequestException } from '@nestjs/common';

/** ITN-01: itinerary title */
export const TITLE_MAX_LENGTH = 100;
/** ITN-01: an itinerary covers one or more countries */
export const MAX_COUNTRIES = 20;
/** ITN-05: at most 60 days per itinerary */
export const MAX_DAYS = 60;
export const DAY_NOTES_MAX_LENGTH = 2000;

export enum Visibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

// ---------------------------------------------------------------------------------------
// Calendar dates. An itinerary only stores its start date; every day's date is
// startDate + (position - 1), so deleting or moving a day only renumbers.
// Dates travel as "YYYY-MM-DD" and are stored as UTC midnight.
// ---------------------------------------------------------------------------------------

export const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** "2026-12-01" -> Date at UTC midnight. Rejects impossible dates like 2026-02-30. */
export function parseDate(value: string, field = 'date'): Date {
  if (!DATE_REGEX.test(value)) {
    throw new BadRequestException(`${field} must look like 2026-12-01`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || toDateString(date) !== value) {
    throw new BadRequestException(`${field} ${value} is not a real date`);
  }
  return date;
}

export function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Date of the day at this 0-based position */
export function dayDate(startDate: Date, index: number): string {
  return toDateString(new Date(startDate.getTime() + index * DAY_MS));
}
