import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_PENDING_KEY = 'allowPasswordChangePending';

/**
 * ACC-07a / ACC-13: while a user still has an admin-set temporary password, every route answers
 * 403 except the ones marked with this decorator (who am I, change password, log out, refresh).
 */
export const AllowPasswordChangePending = () => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);
