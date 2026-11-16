/**
 * Hotel and hotel booking rules (Member 4), from the requirements workbook.
 * Change a value here if the workbook says otherwise. Nothing else needs to change.
 */

/** HTL-18: all rooms of a booking are held together for 10 minutes as one Pending Payment reservation */
export const HOTEL_HOLD_MINUTES = 10;

/** How often the background job expires unpaid holds and marks finished stays Completed */
export const HOTEL_JOB_EVERY_MS = 60_000;

/**
 * Safety limits (not business rules): they only stop absurd requests that would create
 * thousands of night documents. Set high enough that no normal request hits them.
 */
export const MAX_ROOMS_PER_BOOKING = 10;
export const MAX_NIGHTS = 90;
export const MAX_DAYS_AHEAD = 730;
export const MAX_RANGE_NIGHTS = 730;

/** GEN-08: up to 5 photos per hotel */
export const MAX_HOTEL_PHOTOS = 5;

/** Used when the admin creates a hotel without these */
export const DEFAULT_CHECK_IN_TIME = '15:00';
export const DEFAULT_CHECK_OUT_TIME = '12:00';

/** HTL-10: refund tiers in days before check-in. Used when the admin gives no policy. */
export const DEFAULT_HOTEL_CANCELLATION = [
  { daysBeforeCheckIn: 7, refundPercent: 100 },
  { daysBeforeCheckIn: 2, refundPercent: 50 },
  { daysBeforeCheckIn: 0, refundPercent: 0 },
];
