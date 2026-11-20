/**
 * Auth rules in one place, taken from the official requirements workbook.
 */
export const AUTH_COOKIE_NAME = 'access_token';
export const REFRESH_COOKIE_NAME = 'refresh_token';
/** The refresh cookie is only ever sent to the auth endpoints */
export const REFRESH_COOKIE_PATH = '/api/auth';

/** ACC-01: at least 8 characters, including at least one letter and one digit */
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,64}$/;
export const PASSWORD_RULE_MESSAGE =
  'Password must be at least 8 characters and include at least one letter and one digit';

/** ACC-05: failed-login lockout */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

/** ACC-06: a session with no authenticated request for this long expires */
export const SESSION_IDLE_MINUTES = 30;
/** Short-lived access token; the refresh token gets a new one while the session is active */
export const ACCESS_TOKEN_MINUTES = 15;
/** Hard limit on one login session, even if it stays active */
export const SESSION_MAX_DAYS = 7;
/** lastActivityAt is written at most this often, to avoid a database write on every request */
export const ACTIVITY_WRITE_INTERVAL_SECONDS = 60;

/** bcrypt cost factor (GEN-13: passwords stored only as salted hashes) */
export const BCRYPT_ROUNDS = 10;
