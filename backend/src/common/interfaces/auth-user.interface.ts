import { ProviderType, Role } from '../enums/role.enum';

/** What @CurrentUser() returns on every authenticated request */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  /** Only for moderators: which airline or hotel they manage */
  providerType?: ProviderType;
  providerId?: string;
  /** The login session this request belongs to (ACC-06) */
  sessionId?: string;
  /** ACC-07a / ACC-13: true until the user replaces an admin-set temporary password */
  mustChangePassword?: boolean;
}

/** Contents of the signed access token stored in the httpOnly access_token cookie */
export interface JwtPayload {
  sub: string;
  role: Role;
  /** Session id, so the server can check and revoke the session (ACC-06) */
  sid: string;
  iat?: number;
  exp?: number;
}
