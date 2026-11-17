/** BLG-01 */
export const POST_TITLE_MAX_LENGTH = 200;
export const POST_BODY_MAX_LENGTH = 20000;

/** BLG-08: up to 5 tags, max 30 characters each */
export const MAX_TAGS = 5;
export const TAG_MAX_LENGTH = 30;

/** BLG-05: comments are non-empty, max 500 characters */
export const COMMENT_MAX_LENGTH = 500;

/** BLG-10 + GEN-08: up to 5 images per post */
export const MAX_POST_IMAGES = 5;

/** BLG-09: length of the excerpt shown in lists and search results */
export const EXCERPT_LENGTH = 200;

export enum PostStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
}
