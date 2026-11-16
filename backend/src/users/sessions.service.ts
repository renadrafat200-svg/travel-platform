import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import {
  ACTIVITY_WRITE_INTERVAL_SECONDS,
  SESSION_IDLE_MINUTES,
  SESSION_MAX_DAYS,
} from '../config/auth.constants';
import { Session, SessionDocument } from './schemas/session.schema';

const MINUTE = 60_000;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const newRefreshToken = () => randomBytes(48).toString('base64url');

export type SessionCheck =
  | { ok: true; session: SessionDocument }
  | { ok: false; reason: 'missing' | 'revoked' | 'idle' | 'expired' };

/** Server-side login sessions (ACC-06, ACC-19) */
@Injectable()
export class SessionsService {
  constructor(@InjectModel(Session.name) private readonly sessionModel: Model<Session>) {}

  /** Starts a session at login; returns the session id and the plain refresh token (sent only as a cookie) */
  async create(userId: string | Types.ObjectId, userAgent?: string) {
    const refreshToken = newRefreshToken();
    const now = new Date();
    const session = await this.sessionModel.create({
      user: new Types.ObjectId(userId.toString()),
      refreshTokenHash: hash(refreshToken),
      lastActivityAt: now,
      expiresAt: new Date(now.getTime() + SESSION_MAX_DAYS * 24 * 60 * MINUTE),
      userAgent: userAgent?.slice(0, 200),
    });
    return { sessionId: session._id.toString(), refreshToken };
  }

  /** Is this session still usable? Idle sessions are revoked on the spot. */
  async check(session: SessionDocument | null): Promise<SessionCheck> {
    if (!session) return { ok: false, reason: 'missing' };
    if (session.revokedAt) return { ok: false, reason: 'revoked' };
    const now = Date.now();
    if (session.expiresAt.getTime() <= now) return { ok: false, reason: 'expired' };
    if (now - session.lastActivityAt.getTime() > SESSION_IDLE_MINUTES * MINUTE) {
      await this.revoke(session._id);
      return { ok: false, reason: 'idle' };
    }
    return { ok: true, session };
  }

  async checkById(sessionId: string): Promise<SessionCheck> {
    if (!Types.ObjectId.isValid(sessionId)) return { ok: false, reason: 'missing' };
    return this.check(await this.sessionModel.findById(sessionId).exec());
  }

  /** Records an authenticated request (at most once a minute per session) */
  async touch(session: SessionDocument) {
    if (Date.now() - session.lastActivityAt.getTime() < ACTIVITY_WRITE_INTERVAL_SECONDS * 1000) return;
    await this.sessionModel.updateOne({ _id: session._id }, { $set: { lastActivityAt: new Date() } }).exec();
  }

  /**
   * POST /auth/refresh: finds the session by its refresh token and rotates the token,
   * so a stolen old refresh token stops working. Does not count as user activity.
   */
  async rotate(refreshToken: string) {
    const session = await this.sessionModel.findOne({ refreshTokenHash: hash(refreshToken) }).exec();
    const result = await this.check(session);
    if (!result.ok) return result;
    const next = newRefreshToken();
    await this.sessionModel
      .updateOne({ _id: result.session._id }, { $set: { refreshTokenHash: hash(next) } })
      .exec();
    return { ok: true as const, session: result.session, refreshToken: next };
  }

  async findByRefreshToken(refreshToken: string) {
    return this.sessionModel.findOne({ refreshTokenHash: hash(refreshToken) }).exec();
  }

  async revoke(sessionId: string | Types.ObjectId) {
    await this.sessionModel
      .updateOne({ _id: sessionId, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date() } })
      .exec();
  }

  /** Logs a user out everywhere (password change/reset, deactivation), optionally keeping one session */
  async revokeAllForUser(userId: string | Types.ObjectId, exceptSessionId?: string) {
    const filter: Record<string, unknown> = {
      user: new Types.ObjectId(userId.toString()),
      revokedAt: { $exists: false },
    };
    if (exceptSessionId) filter._id = { $ne: new Types.ObjectId(exceptSessionId) };
    await this.sessionModel.updateMany(filter, { $set: { revokedAt: new Date() } }).exec();
  }
}
