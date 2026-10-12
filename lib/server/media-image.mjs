import sharp from 'sharp';
import { MediaError } from './media-auth.mjs';

export const MAX_BYTES = 5 * 1024 * 1024;
export const VARIANTS = Object.freeze({ thumbnail: 96, display: 512 });
const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export async function readImageBody(request) {
  const mime = request.headers.get('content-type');
  if (!Object.values(MIME).includes(mime)) throw new MediaError(415, 'Use JPEG, PNG or WebP.');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES))
    throw new MediaError(413, 'Photo must be at most 5 MiB.');
  if (!request.body) throw new MediaError(400, 'Photo is empty.');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 10000);
  let complete = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) { complete = true; break; }
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new MediaError(413, 'Photo must be at most 5 MiB.'); }
      chunks.push(Buffer.from(value));
    }
  } finally { clearTimeout(timeout); reader.releaseLock(); }
  // Content length is only an early check; the actual streamed bytes are bounded.
  if (timedOut || !complete || !size || (length !== null && Number(length) !== size))
    throw new MediaError(400, 'Incomplete photo.');
  return { bytes: Buffer.concat(chunks, size), mime };
}

export async function generateVariants(bytes, mime) {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new MediaError(413, 'Invalid photo size.');
  try {
    const options = { limitInputPixels: 16_000_000, failOn: 'warning', animated: true };
    const meta = await sharp(bytes, options).metadata();
    if (!MIME[meta.format] || MIME[meta.format] !== mime)
      throw new MediaError(415, 'Photo content does not match its MIME type.');
    if ((meta.pages || 1) !== 1 || !meta.width || !meta.height ||
        meta.width < 64 || meta.height < 64 || meta.width > 4096 || meta.height > 4096 ||
        meta.width * meta.height > 16_000_000)
      throw new MediaError(422, 'Use a still photo, 64–4096 pixels per side and at most 16 megapixels.');
    const output = {};
    for (const [name, size] of Object.entries(VARIANTS)) {
      // Full decode/re-encode, auto orientation, fixed output format; EXIF/ICC are stripped.
      output[name] = await sharp(bytes, options).timeout({ seconds: 5 }).rotate()
        .resize(size, size, { fit: 'cover' }).toColourspace('srgb').webp({ quality: 80 }).toBuffer();
    }
    return output;
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError(422, 'Photo could not be decoded safely.');
  }
}

