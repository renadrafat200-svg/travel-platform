import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Restrict a route (or a whole controller) to certain roles:
 *   @Roles(Role.ADMIN)
 *   @Roles(Role.AIRLINE_MODERATOR, Role.ADMIN)
 * Without @Roles, any logged-in user may call the route.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
