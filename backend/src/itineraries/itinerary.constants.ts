import { BadRequestException } from '@nestjs/common';

/** ITN-01: itinerary title */
export const TITLE_MAX_LENGTH = 100;
/** ITN-01: an itinerary covers one or more countries */
export const MAX_COUNTRIES = 20;
/** ITN-05: at most 60 days per itinerary */
export const MAX_DAYS = 60;
export const DAY_NOTES_MAX_LENGTH = 2000;

/** ITN-10: activities */
export const ACTIVITY_NAME_MAX_LENGTH = 100;
export const ACTIVITY_DESCRIPTION_MAX_LENGTH = 1000;
/** ITN-12 + GEN-08: up to 5 images per activity (JPG/PNG, 5 MB each) */
export const MAX_ACTIVITY_IMAGES = 5;
export const NOTE_MAX_LENGTH = 200;
/** Upper limit for any single amount, so typos like 1e12 are rejected */
export const MAX_AMOUNT = 1_000_000_000;
export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
export const CURRENCY_REGEX = /^[A-Z]{3}$/;

/** ITN-14: budget categories of a day. Activity costs count as "activities". */
export enum BudgetCategory {
  FOOD = 'food',
  ACCOMMODATION = 'accommodation',
  IN_CITY_TRANSPORT = 'in_city_transport',
  ACTIVITIES = 'activities',
}

/** ITN-16: intercity transport entries have their own category in the totals */
export const INTERCITY_TRANSPORT = 'intercity_transport';
export const SUMMARY_CATEGORIES = [
  ...Object.values(BudgetCategory),
  INTERCITY_TRANSPORT,
] as const;
export type SummaryCategory = (typeof SUMMARY_CATEGORIES)[number];

/** ITN-16: how the traveller goes from one city to the next */
export enum TransportMode {
  FLIGHT = 'flight',
  TRAIN = 'train',
  BUS = 'bus',
  CAR = 'car',
  FERRY = 'ferry',
  TAXI = 'taxi',
  OTHER = 'other',
}

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
