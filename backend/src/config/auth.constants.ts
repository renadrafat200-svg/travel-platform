/**
 * Auth rules in one place.
 * TODO(sheet): confirm every value below against the official Excel requirements sheet (ACC-01, ACC-05).
 */
export const AUTH_COOKIE_NAME = 'access_token';

/** At least 8 characters, with an uppercase letter, a lowercase letter and a number */
export const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,64}$/;
export const PASSWORD_RULE_MESSAGE =
  'Password must be 8-64 characters and contain an uppercase letter, a lowercase letter and a number';

/** Failed-login lockout */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/** bcrypt cost factor */
export const BCRYPT_ROUNDS = 10;
