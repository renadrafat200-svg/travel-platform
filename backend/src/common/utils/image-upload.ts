import { BadRequestException } from '@nestjs/common';

/**
 * GEN-08 shared image rules: JPG or PNG, at most 5 MB each.
 * The max count depends on the owner (5 per post / activity / hotel, 1 logo per airline).
 * Used by the blog (Member 5); Member 7 can reuse it for activity images.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** What an uploaded file looks like with multer's default memory storage */
export interface UploadedImage {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Detects the real file type from the first bytes, so a renamed .txt cannot pass as a .jpg */
export function detectImageType(
  buf: Buffer,
): 'image/jpeg' | 'image/png' | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && png.every((b, i) => buf[i] === b)) return 'image/png';
  return null;
}

/**
 * Checks a batch of uploads against GEN-08 and returns each file with its real type.
 * Throws 400 with a clear message for: no files, too many in total, too big, not JPG/PNG.
 */
export function validateImages(
  files: UploadedImage[] | undefined,
  alreadyStored: number,
  maxTotal: number,
  fieldName = 'images',
) {
  if (!files?.length) {
    throw new BadRequestException(
      `Attach at least one image in the "${fieldName}" field`,
    );
  }
  if (alreadyStored + files.length > maxTotal) {
    throw new BadRequestException(
      `At most ${maxTotal} images are allowed (there are already ${alreadyStored})`,
    );
  }
  return files.map((file) => {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException(`${file.originalname} is larger than 5 MB`);
    }
    const type = detectImageType(file.buffer);
    if (!type)
      throw new BadRequestException(
        `${file.originalname} is not a JPG or PNG image`,
      );
    return { file, type, extension: type === 'image/png' ? 'png' : 'jpg' };
  });
}
