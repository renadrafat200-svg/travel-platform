import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AccountStatus, ProviderType, Role } from '../../common/enums/role.enum';

export type UserDocument = HydratedDocument<User>;

@Schema({ _id: false })
export class UserPreferences {
  /** ISO 4217 code used for itinerary budget totals, e.g. EGP, USD, EUR */
  @Prop({ default: 'USD', uppercase: true, trim: true })
  currency: string;
}
const UserPreferencesSchema = SchemaFactory.createForClass(UserPreferences);

@Schema({ timestamps: true })
export class User {
  _id: Types.ObjectId;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  /** bcrypt hash. select:false means it is never returned unless explicitly asked for */
  @Prop({ required: true, select: false })
  passwordHash: string;

  @Prop({ required: true, trim: true })
  firstName: string;

  @Prop({ required: true, trim: true })
  lastName: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ trim: true })
  nationality?: string;

  @Prop()
  dateOfBirth?: Date;

  @Prop({ type: UserPreferencesSchema, default: () => ({}) })
  preferences: UserPreferences;

  @Prop({ type: String, enum: Role, default: Role.USER, index: true })
  role: Role;

  @Prop({ type: String, enum: AccountStatus, default: AccountStatus.ACTIVE, index: true })
  status: AccountStatus;

  /** Moderators only: the one airline or hotel they manage (set by the admin module) */
  @Prop({ type: String, enum: ProviderType })
  providerType?: ProviderType;

  @Prop({ type: Types.ObjectId })
  providerId?: Types.ObjectId;

  /** Failed-login lockout */
  @Prop({ default: 0 })
  failedLoginAttempts: number;

  @Prop()
  lockUntil?: Date;

  /** Tokens issued before this moment are rejected */
  @Prop()
  passwordChangedAt?: Date;

  @Prop()
  lastLoginAt?: Date;

  @Prop()
  deactivatedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
