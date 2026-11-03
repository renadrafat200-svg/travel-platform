export enum Role {
  USER = 'user',
  ADMIN = 'admin',
  AIRLINE_MODERATOR = 'airline_moderator',
  HOTEL_MODERATOR = 'hotel_moderator',
}

export enum AccountStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
  DEACTIVATED = 'deactivated',
}

/** Which provider a moderator manages (used by the admin module and ownership checks) */
export enum ProviderType {
  AIRLINE = 'airline',
  HOTEL = 'hotel',
}
