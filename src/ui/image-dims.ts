/**
 * Image dimension helpers — read natural width/height of an image source via
 * the browser DOM. Used by map flows that want to auto-fill `width`/`height`
 * on the map element when an image source becomes available.
 *
 * Both helpers return null on load failure (CORS, 404, malformed file) so
 * callers can fall back gracefully. Promises always resolve — never reject —
 * to keep call sites trivial.
 */

export interface ImageDims {
  w: number;
  h: number;
}

/**
 * Canvas size (square) stamped on maps created WITHOUT an image — the flat
 * canvas contract (DESIGN_MAPS.md §4.2). Persisted on the element so the
 * coordinate space is identical on every device; changing this constant
 * never moves existing pins because existing maps carry their own dims.
 */
export const IMAGELESS_MAP_SIZE = 2000;

/**
 * Below this shorter-side pixel count a map image gets a soft "coarse
 * placement" hint at attach time (Freek's ask, S300). Never a block.
 */
export const SMALL_MAP_IMAGE_MIN_SIDE = 600;

/** Hint line for small map images, or null when the image is big enough. */
export function smallMapImageHint(dims: ImageDims): string | null {
  if (Math.min(dims.w, dims.h) >= SMALL_MAP_IMAGE_MIN_SIDE) return null;
  return `Small image (${dims.w}×${dims.h}): pin placement will be coarse. A larger image gives finer positioning.`;
}

/** Decode a File (local upload) → natural dimensions, or null on failure. */
export async function readImageDimsFromFile(file: File): Promise<ImageDims | null> {
  try {
    const bmp = await createImageBitmap(file);
    const dims: ImageDims = { w: bmp.width, h: bmp.height };
    bmp.close?.();
    return dims;
  } catch {
    return new Promise<ImageDims | null>((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
      img.src = url;
    });
  }
}

/** Fetch a URL into a hidden Image → natural dimensions, or null on failure. */
export async function readImageDimsFromUrl(url: string): Promise<ImageDims | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
