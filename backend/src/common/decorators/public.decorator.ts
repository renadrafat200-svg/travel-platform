import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Every route requires login by default.
 * Put @Public() on routes guests may use, e.g. flight search, hotel search, published posts.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
