import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ProviderType, Role } from '../enums/role.enum';
import { AuthUser } from '../interfaces/auth-user.interface';

type Id = string | Types.ObjectId | undefined | null;

const same = (a: Id, b: Id) => !!a && !!b && a.toString() === b.toString();

/**
 * Use after loading a user-owned record (booking, itinerary, post, comment ...):
 *   assertOwnerOrAdmin(user, booking.user);
 * Throws 403 unless the current user owns it or is an admin.
 */
export function assertOwnerOrAdmin(user: AuthUser, ownerId: Id): void {
  if (user.role === Role.ADMIN) return;
  if (!same(user.id, ownerId)) {
    throw new ForbiddenException('You can only access your own data');
  }
}

/**
 * Use in airline/hotel moderator routes:
 *   assertManagesProvider(user, ProviderType.HOTEL, hotel._id);
 * Throws 403 unless the user is an admin or the moderator assigned to that exact provider.
 */
export function assertManagesProvider(
  user: AuthUser,
  type: ProviderType,
  providerId: Id,
): void {
  if (user.role === Role.ADMIN) return;
  const expectedRole = type === ProviderType.AIRLINE ? Role.AIRLINE_MODERATOR : Role.HOTEL_MODERATOR;
  if (user.role !== expectedRole || user.providerType !== type || !same(user.providerId, providerId)) {
    throw new ForbiddenException('You can only manage your assigned provider');
  }
}
