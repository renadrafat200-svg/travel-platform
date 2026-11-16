import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type SessionDocument = HydratedDocument<Session>;

/**
 * One login session (ACC-06). The access token carries this session's id, and the refresh
 * token is stored only as a SHA-256 hash. Logging out revokes the session on the server.
 */
@Schema({ timestamps: true })
export class Session {
  _id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user: Types.ObjectId;

  @Prop({ required: true, unique: true })
  refreshTokenHash: string;

  /** Last authenticated request; 30 minutes without one ends the session */
  @Prop({ required: true })
  lastActivityAt: Date;

  /** Absolute end of the session; MongoDB deletes the document after this (TTL index) */
  @Prop({ required: true })
  expiresAt: Date;

  @Prop()
  revokedAt?: Date;

  @Prop()
  userAgent?: string;

  createdAt: Date;
  updatedAt: Date;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
