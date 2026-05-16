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
