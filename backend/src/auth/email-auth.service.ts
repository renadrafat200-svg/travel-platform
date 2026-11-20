import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomBytes } from 'crypto';
import { Model, Types } from 'mongoose';
import { AccountStatus } from '../common/enums/role.enum';
import { MailService } from '../mail/mail.service';
import { AuthToken, AuthTokenType } from '../users/schemas/auth-token.schema';
import { User } from '../users/schemas/user.schema';
import { UsersService } from '../users/users.service';

/** ACC-02: the confirmation link works for 24 hours */
export const VERIFY_EMAIL_HOURS = 24;
/** ACC-07: the reset link works for 30 minutes and only once */
export const RESET_PASSWORD_MINUTES = 30;
/** Do not send the same kind of email to one user more than once per minute */
const RESEND_COOLDOWN_MS = 60_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Optional bonuses:
 *  - ACC-02: email verification (a link sent at registration; can be resent)
 *  - ACC-07: forgotten password recovery by email (one-time link, 30 minutes)
 * The admin-assisted reset (mandatory ACC-07a) is unchanged.
 */
@Injectable()
export class EmailAuthService {
    constructor(
        @InjectModel(AuthToken.name) private readonly tokenModel: Model<AuthToken>,
        @InjectModel(User.name) private readonly userModel: Model<User>,
        private readonly users: UsersService,
        private readonly mail: MailService,
    ) { }

    // ---------------- ACC-02 ----------------

    /** Sends the "confirm your email" link (after registration, or on request) */
    async sendVerification(userId: string | Types.ObjectId) {
        const user = await this.userModel.findById(userId).lean().exec();
        if (!user || user.emailVerified) return;
        const token = await this.newToken(user._id, AuthTokenType.VERIFY_EMAIL, VERIFY_EMAIL_HOURS * 60);
        if (!token) return; // one was sent less than a minute ago
        const link = `${this.mail.baseUrl}/api/auth/verify-email?token=${token}`;
        await this.mail.send({
            to: user.email,
            subject: 'Confirm your email address',
            text:
                `Hello ${user.firstName},\n\n` +
                `Please confirm your email address for your Travel Platform account by opening this link:\n${link}\n\n` +
                `The link works for ${VERIFY_EMAIL_HOURS} hours. If you did not create an account, you can ignore this email.`,
        });
    }

    /** GET /api/auth/verify-email?token=... */
    async verify(token: string | undefined) {
        const record = await this.useToken(token, AuthTokenType.VERIFY_EMAIL);
        if (!record) {
            throw new BadRequestException('This confirmation link is invalid or has expired. Request a new one.');
        }
        await this.userModel
            .updateOne({ _id: record.user }, { $set: { emailVerified: true, emailVerifiedAt: new Date() } })
            .exec();
        return { message: 'Your email address is confirmed. Thank you!' };
    }

    /** POST /api/auth/resend-verification (logged in) */
    async resend(userId: string) {
        const user = await this.userModel.findById(userId).lean().exec();
        if (user?.emailVerified) return { message: 'Your email address is already confirmed' };
        await this.sendVerification(userId);
        return { message: 'A new confirmation link was sent to your email address' };
    }

    // ---------------- ACC-07 ----------------

    /**
     * POST /api/auth/forgot-password: always answers the same, whether the email exists or not,
     * so nobody can find out which emails are registered.
     */
    async forgotPassword(email: string) {
        const user = await this.users.findByEmail(email);
        if (user && user.status === AccountStatus.ACTIVE) {
            const token = await this.newToken(user._id, AuthTokenType.RESET_PASSWORD, RESET_PASSWORD_MINUTES);
            if (token) {
                const link = `${this.mail.baseUrl}/api/docs#/Auth/AuthController_resetPassword`;
                await this.mail.send({
                    to: user.email,
                    subject: 'Reset your password',
                    text:
                        `Hello ${user.firstName},\n\n` +
                        `Someone (hopefully you) asked to reset the password of your Travel Platform account.\n\n` +
                        `Your reset code: ${token}\n\n` +
                        `Use it with POST /api/auth/reset-password (${link}) within ${RESET_PASSWORD_MINUTES} minutes. ` +
                        `It works only once. If you did not ask for this, ignore this email: your password stays the same.`,
                });
            }
        }
        return {
            message: 'If an account exists for this email, a password reset code has been sent to it.',
        };
    }

    /** POST /api/auth/reset-password: sets the new password and logs out every session */
    async resetPassword(token: string, newPassword: string) {
        const record = await this.useToken(token, AuthTokenType.RESET_PASSWORD);
        if (!record) {
            throw new BadRequestException('This reset code is invalid, already used or expired. Ask for a new one.');
        }
        const user = await this.userModel.findById(record.user).lean().exec();
        if (!user || user.status !== AccountStatus.ACTIVE) {
            throw new BadRequestException('This account cannot be reset. Contact an administrator.');
        }
        await this.users.setPassword(record.user.toString(), newPassword, { mustChangePassword: false });
        // Other reset codes of this user stop working too; receiving the email proves the address
        await this.tokenModel
            .updateMany({ user: record.user, type: AuthTokenType.RESET_PASSWORD, usedAt: null }, { $set: { usedAt: new Date() } })
            .exec();
        await this.userModel
            .updateOne({ _id: record.user, emailVerified: { $ne: true } }, { $set: { emailVerified: true, emailVerifiedAt: new Date() } })
            .exec();
        await this.mail.send({
            to: user.email,
            subject: 'Your password was changed',
            text: `Hello ${user.firstName},\n\nThe password of your Travel Platform account was just reset and all sessions were logged out. If this was not you, contact an administrator right away.`,
        });
        return { message: 'Your password was reset. Log in with the new password.' };
    }

    // ---------------- tokens ----------------

    /** Creates a token, or returns null if one of this type was created less than a minute ago */
    private async newToken(user: Types.ObjectId, type: AuthTokenType, minutes: number): Promise<string | null> {
        const recent = await this.tokenModel
            .exists({ user, type, usedAt: null, createdAt: { $gt: new Date(Date.now() - RESEND_COOLDOWN_MS) } })
            .exec();
        if (recent) return null;
        const token = randomBytes(24).toString('hex');
        await this.tokenModel.create({
            user,
            type,
            tokenHash: hash(token),
            expiresAt: new Date(Date.now() + minutes * 60_000),
        });
        return token;
    }

    /** Marks a valid, unused, unexpired token as used (atomically) and returns it */
    private async useToken(token: string | undefined, type: AuthTokenType) {
        if (!token || !/^[a-f0-9]{48}$/.test(token)) return null;
        return this.tokenModel
            .findOneAndUpdate(
                { tokenHash: hash(token), type, usedAt: null, expiresAt: { $gt: new Date() } },
                { $set: { usedAt: new Date() } },
                { returnDocument: 'after' },
            )
            .lean()
            .exec();
    }
}
