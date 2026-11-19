import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuthTokenDocument = HydratedDocument<AuthToken>;

export enum AuthTokenType {
    /** ACC-02 (optional): the link in the "confirm your email" message */
    VERIFY_EMAIL = 'verify_email',
    /** ACC-07 (optional): the link in the "reset your password" message */
    RESET_PASSWORD = 'reset_password',
}

/**
 * One-time tokens sent by email. Only a SHA-256 hash is stored, so a database leak
 * does not reveal usable links. Expired tokens are deleted by MongoDB (TTL index).
 */
@Schema({ collection: 'authtokens', timestamps: { createdAt: true, updatedAt: false } })
export class AuthToken {
    _id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
    user: Types.ObjectId;

    @Prop({ type: String, enum: AuthTokenType, required: true })
    type: AuthTokenType;

    @Prop({ required: true, unique: true })
    tokenHash: string;

    @Prop({ required: true })
    expiresAt: Date;

    @Prop()
    usedAt?: Date;

    createdAt: Date;
}

export const AuthTokenSchema = SchemaFactory.createForClass(AuthToken);
AuthTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
