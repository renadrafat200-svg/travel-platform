import { CookieOptions, Response } from 'express';
import {
  ACCESS_TOKEN_MINUTES,
  AUTH_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  SESSION_MAX_DAYS,
} from '../config/auth.constants';

/** Converts values like "15m", "12h", "1d", "3600" (seconds) into milliseconds */
export function durationToMs(value: string | undefined, fallbackMs = 24 * 60 * 60 * 1000): number {
  if (!value) return fallbackMs;
  const match = /^(\d+)\s*([smhd]?)$/i.exec(value.trim());
  if (!match) return fallbackMs;
  const n = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 1000;
  return n * factor;
}

/**
 * ACC-19: httpOnly (no JavaScript access), Secure and SameSite.
 * Browsers accept Secure cookies on http://localhost, so this also works in local development.
 * Set COOKIE_SECURE=false in backend/.env only if a tool you test with drops them.
 */
function baseOptions(path = '/'): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE !== 'false',
    sameSite: 'lax',
    path,
  };
}

export function setAuthCookies(res: Response, accessToken: string, refreshToken?: string) {
  res.cookie(AUTH_COOKIE_NAME, accessToken, {
    ...baseOptions(),
    maxAge: ACCESS_TOKEN_MINUTES * 60_000,
  });
  if (!refreshToken) return;
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...baseOptions(REFRESH_COOKIE_PATH),
    maxAge: SESSION_MAX_DAYS * 24 * 3_600_000,
  });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, baseOptions());
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions(REFRESH_COOKIE_PATH));
}
