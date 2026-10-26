/**
 * Extract a dominant edge color from an image URL.
 *
 * Strategy (refined): sample pixels at ORIGINAL resolution along the four edges
 * (avoiding downsample blur), inset a few pixels in to skip JPEG ringing at the
 * very rim, then bucket samples into 16-step bins and pick the dominant bin —
 * returning the exact average within that bin. Robust to compression noise
 * AND precise for solid-color edges.
 *
 * Safe: returns null on any failure (CORS, decode error, no canvas, etc).
 */

/** Load an image for canvas reads. crossOrigin is required for pixel reads;
 *  a host without CORS headers makes decode() reject. */
async function loadCors(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
}

/** The map overlay loads the same URL as a plain <img> (no Origin sent), and a
 *  host like R2 then answers without Access-Control-Allow-Origin. The browser
 *  can serve that cached, header-less copy to this CORS read, which fails even
 *  though the host allows CORS (Boss, media.onlyworlds.com). So a failed
 *  http(s) read retries once under a query that keeps it out of that cache
 *  entry. The first attempt is unchanged, so no host fares worse than before. */
async function loadForPixels(url: string): Promise<HTMLImageElement> {
  try {
    return await loadCors(url);
  } catch (err) {
    if (!/^https?:/i.test(url)) throw err;
    return loadCors(url + (url.includes('?') ? '&' : '?') + 'atlas-pixels=1');
  }
}

export async function extractEdgeColor(url: string): Promise<string | null> {
  try {
    const img = await loadForPixels(url);

    const w = img.naturalWidth, h = img.naturalHeight;
    if (w < 8 || h < 8) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);

    // Inset a few pixels from the rim. JPEG and PNG-with-alpha both tend to
    // have slight artifacts in the outermost 1-2 px row that throw off the
    // average. Inset scales with image size but caps at 4px.
    const inset = Math.min(4, Math.max(1, Math.floor(Math.min(w, h) / 80)));

    // Pull four 1-pixel-thick strips along each edge using bulk getImageData.
    // Avoids the cost of per-pixel getImageData calls AND avoids loading the
    // full image buffer (which could be 50MB+ on a 4K map).
    const top    = ctx.getImageData(0, inset,        w, 1).data;
    const bottom = ctx.getImageData(0, h - 1 - inset, w, 1).data;
    const left   = ctx.getImageData(inset,        0, 1, h).data;
    const right  = ctx.getImageData(w - 1 - inset, 0, 1, h).data;

    // Mode-bucketing: 16-step bins per channel. For a solid-color edge all
    // samples land in the same bin and the average within is the exact color.
    // For varied edges (gradients, mixed content) we still get the dominant
    // color rather than a muddy average.
    interface Bin { r: number; g: number; b: number; n: number; }
    const bins = new Map<string, Bin>();

    const ingest = (buf: Uint8ClampedArray) => {
      // strip data is RGBA, length 4 * N
      for (let i = 0; i < buf.length; i += 4) {
        const a = buf[i + 3];
        if (a < 16) continue;  // skip transparent
        const r = buf[i], g = buf[i + 1], b = buf[i + 2];
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        const cur = bins.get(key);
        if (cur) {
          cur.r += r; cur.g += g; cur.b += b; cur.n++;
        } else {
          bins.set(key, { r, g, b, n: 1 });
        }
      }
    };
    ingest(top); ingest(bottom); ingest(left); ingest(right);

    if (bins.size === 0) return null;

    let best: Bin | null = null;
    for (const v of bins.values()) {
      if (!best || v.n > best.n) best = v;
    }
    if (!best) return null;

    const R = Math.round(best.r / best.n);
    const G = Math.round(best.g / best.n);
    const B = Math.round(best.b / best.n);
    return `rgb(${R},${G},${B})`;
  } catch (err) {
    console.warn('[edge-color] extraction failed:', err);
    return null;
  }
}
