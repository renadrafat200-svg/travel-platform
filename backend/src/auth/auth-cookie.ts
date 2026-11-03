import { CookieOptions, Response } from 'express';
import { AUTH_COOKIE_NAME } from '../config/auth.constants';

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

function baseOptions(): CookieOptions {
  return {
    httpOnly: true, // JavaScript in the browser can never read it (no localStorage)
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'lax',
    path: '/',
  };
}

export function setAuthCookie(res: Response, token: string, maxAgeMs: number) {
  res.cookie(AUTH_COOKIE_NAME, token, { ...baseOptions(), maxAge: maxAgeMs });
}

export function clearAuthCookie(res: Response) {
  res.clearCookie(AUTH_COOKIE_NAME, baseOptions());
}
