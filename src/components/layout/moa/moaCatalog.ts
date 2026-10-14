/** Versioned, inert decoration data. This module never reads clinical state or auth. */
export const MOA_DATA_BASE = 'https://raw.githubusercontent.com/DanielOpazoD/Moa-HHR/moa-catalog/';
export const MOA_CATALOG_URL = `${MOA_DATA_BASE}catalog.json`;
export const MOA_CATALOG_KEY = 'hhr_moa_catalog_v1';
export const MAX_CATALOG_BYTES = 512 * 1024;
export const MAX_ATLAS_BYTES = 4 * 1024 * 1024;

export interface MoaCatalogScene {
  id: string;
  title: string;
  category: string;
  frames: number;
  durations: number[];
  cycles: number;
  still: number;
  frameSize: [number, number];
  renderMode: 'smooth' | 'pixelated';
  sha256: string;
  bytes: number;
}
export interface MoaCatalog {
  schemaVersion: 1;
  version: string;
  scenes: MoaCatalogScene[];
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const sha = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

export function parseMoaCatalog(value: unknown): MoaCatalog {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !sha(value.version) ||
    !Array.isArray(value.scenes) ||
    !value.scenes.length ||
    value.scenes.length > 1000
  )
    throw new Error('Invalid Moa catalog');
  const ids = new Set<string>();
  const scenes = value.scenes.map((s: unknown): MoaCatalogScene => {
    if (
      !record(s) ||
      typeof s.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,64}$/.test(s.id) ||
      ids.has(s.id) ||
      typeof s.title !== 'string' ||
      !s.title.length ||
      s.title.length > 160 ||
      typeof s.category !== 'string' ||
      s.category.length > 80 ||
      !integer(s.frames, 1, 64) ||
      !integer(s.cycles, 1, 8) ||
      !integer(s.still, 0, s.frames - 1) ||
      !sha(s.sha256) ||
      !integer(s.bytes, 1, MAX_ATLAS_BYTES)
    )
      throw new Error('Invalid Moa scene');
    if (
      !Array.isArray(s.durations) ||
      s.durations.length !== s.frames ||
      !s.durations.every(
        (d: unknown) => typeof d === 'number' && Number.isFinite(d) && d >= 20 && d <= 6000
      )
    )
      throw new Error('Invalid Moa timing');
    const frameSize = s.frameSize;
    const duration = s.durations.reduce((a: number, b: number) => a + b, 0) * s.cycles;
    if (
      duration < 2999.9 ||
      duration > 6000.1 ||
      !Array.isArray(frameSize) ||
      ![
        [288, 168],
        [576, 336],
      ].some(
        size => size.length === frameSize.length && size.every((v, i) => v === frameSize[i])
      ) ||
      !['pixelated', 'smooth'].includes(String(s.renderMode))
    )
      throw new Error('Unsupported Moa scene');
    ids.add(s.id);
    // Select known fields, never propagate URLs, HTML, code or arbitrary style from publication.
    return {
      id: s.id,
      title: s.title,
      category: s.category,
      frames: s.frames,
      durations: s.durations,
      cycles: s.cycles,
      still: s.still,
      frameSize: s.frameSize as [number, number],
      renderMode: s.renderMode as MoaCatalogScene['renderMode'],
      sha256: s.sha256,
      bytes: s.bytes,
    };
  });
  return { schemaVersion: 1, version: value.version, scenes };
}

export async function readBoundedBody(response: Response, limit: number): Promise<Uint8Array> {
  if (!response.ok || Number(response.headers.get('content-length')) > limit || !response.body)
    throw new Error('Moa response rejected');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > limit) {
        await reader.cancel();
        throw new Error('Moa payload too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

export function readCachedMoaCatalog(): MoaCatalog | null {
  try {
    const text = localStorage.getItem(MOA_CATALOG_KEY);
    return text && text.length <= MAX_CATALOG_BYTES ? parseMoaCatalog(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export async function fetchMoaCatalog(signal: AbortSignal): Promise<MoaCatalog> {
  const response = await fetch(MOA_CATALOG_URL, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-cache',
    redirect: 'error',
  });
  const bytes = await readBoundedBody(response, MAX_CATALOG_BYTES);
  const catalog = parseMoaCatalog(JSON.parse(new TextDecoder().decode(bytes)));
  try {
    localStorage.setItem(MOA_CATALOG_KEY, JSON.stringify(catalog));
  } catch {
    /* Optional cache. */
  }
  return catalog;
}

export async function fetchMoaAtlas(scene: MoaCatalogScene, signal: AbortSignal): Promise<Blob> {
  const response = await fetch(`${MOA_DATA_BASE}assets/${scene.sha256}.png`, {
    signal,
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'force-cache',
    redirect: 'error',
  });
  const bytes = await readBoundedBody(response, MAX_ATLAS_BYTES);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  const actual = Array.from(digest, v => v.toString(16).padStart(2, '0')).join('');
  if (signal.aborted || bytes.length !== scene.bytes || actual !== scene.sha256)
    throw new Error('Moa atlas integrity mismatch');
  return new Blob([bytes], { type: 'image/png' });
}
