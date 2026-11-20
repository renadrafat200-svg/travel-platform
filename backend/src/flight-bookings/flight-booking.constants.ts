/**
 * Flight booking rules (Member 3).
 * These are our defaults. Check each one against the Excel requirements sheet and change it here
 * if the sheet says otherwise. Nothing else needs to change.
 */

/** FLT-22: seats stay held for 10 minutes while the user pays. After this the hold expires and seats return. */
export const HOLD_MINUTES = 10;

/** How often the background job looks for expired holds and completed trips */
export const EXPIRY_JOB_EVERY_MS = 60_000;

/** Most passengers (including infants) in one booking */
export const MAX_PASSENGERS = 9;

/** Absolute upper limit per passenger; the real limit is each airline's maxExtraBags (FLT-08, FLT-19) */
export const MAX_EXTRA_BAGS = 10;

/** Most unpaid holds one user can have at the same time, so nobody can block a whole flight */
export const MAX_ACTIVE_HOLDS_PER_USER = 3;

/** Age limits, measured on the day of the outbound flight */
export const INFANT_MAX_AGE = 2; // under 2 = infant: sits on an adult's lap, no seat
export const CHILD_MAX_AGE = 12; // 2 to 11 = child; 12 and over = adult