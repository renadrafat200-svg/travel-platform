import { ProviderType, Role } from '../enums/role.enum';

/** What @CurrentUser() returns on every authenticated request */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  /** Only for moderators: which airline or hotel they manage */
  providerType?: ProviderType;
  providerId?: string;
}

/** Contents of the signed JWT stored in the httpOnly cookie */
export interface JwtPayload {
  sub: string;
  role: Role;
  iat?: number;
  exp?: number;
}
