/**
 * Flight booking rules (Member 3).
 * These are our defaults. Check each one against the Excel requirements sheet and change it here
 * if the sheet says otherwise. Nothing else needs to change.
 */

/** How long seats stay held while the user pays. After this the hold expires and seats return. */
export const HOLD_MINUTES = 15;

/** How often the background job looks for expired holds */
export const EXPIRY_JOB_EVERY_MS = 60_000;

/** Online booking closes this many minutes before departure */
export const BOOKING_CUTOFF_MINUTES = 120;

/** Most passengers (including infants) in one booking */
export const MAX_PASSENGERS = 9;

/** Most extra checked bags one passenger can add per flight */
export const MAX_EXTRA_BAGS = 3;

/** Most unpaid holds one user can have at the same time, so nobody can block a whole flight */
export const MAX_ACTIVE_HOLDS_PER_USER = 3;

/** Age limits, measured on the day of the outbound flight */
export const INFANT_MAX_AGE = 2; // under 2 = infant: sits on an adult's lap, no seat
export const CHILD_MAX_AGE = 12; // 2 to 11 = child; 12 and over = adult