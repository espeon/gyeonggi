import type { BridgethingClient } from '@bridgething/client';

export type Cover = {
  url: string;
  plate: string;
};

const cache = new Map<string, Cover>();

export function cachedCover(id: string): Cover | undefined {
  return cache.get(id);
}

export async function fetchCover(client: BridgethingClient, id: string): Promise<Cover | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  const res = await client.webapp.icon({ id });
  if (!res.ok) return null;
  // Uint8Array.from gives ArrayBuffer-backed bytes, which Blob accepts
  const bytes = Uint8Array.from(res.response.bytes as unknown as number[]);
  const mime = res.response.mime ?? 'image/png';
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const tint = await averageTint(bytes, mime).catch(() => null);
  const cover: Cover = { url, plate: tint ?? '#171c21' };
  cache.set(id, cover);
  return cover;
}

// average the icon down to a few pixels; the card plate derives from it so each
// app reads as one object rather than a glyph floating on a shared background
async function averageTint(bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<string | null> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, 8, 8);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, 8, 8);
  let r = 0;
  let g = 0;
  let b = 0;
  let w = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    r += data[i] * a;
    g += data[i + 1] * a;
    b += data[i + 2] * a;
    w += a;
  }
  if (w === 0) return null;
  // pull well toward black so light icons keep their contrast on the plate
  const shade = (v: number) => Math.round((v / w) * 0.3 + 8);
  return `rgb(${shade(r)}, ${shade(g)}, ${shade(b)})`;
}
