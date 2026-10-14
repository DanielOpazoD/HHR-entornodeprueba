// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import catalogFixture from '../fixtures/moa/catalog.json';
import {
  fetchMoaAtlas,
  fetchMoaCatalog,
  MAX_CATALOG_BYTES,
  MOA_CATALOG_KEY,
  MOA_CATALOG_URL,
  MOA_DATA_BASE,
  parseMoaCatalog,
  readBoundedBody,
  readCachedMoaCatalog,
} from '@/components/layout/moa/moaCatalog';
import { moaKeyframes } from '@/components/layout/moa/MoaCatalogSequence';

const clone = () => structuredClone(catalogFixture);
beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe('Moa remote data contract', () => {
  it('accepts the complete 222-scene publication, including 24-frame HD and unequal holds', () => {
    const value = parseMoaCatalog(clone());
    expect(value.scenes).toHaveLength(222);
    expect(value.scenes.reduce((sum, s) => sum + s.frames, 0)).toBe(2634);
    expect(value.scenes.find(s => s.id === 'E08')?.frameSize).toEqual([576, 336]);
    expect(value.scenes.find(s => s.id === 'thinking')?.durations).not.toEqual(Array(8).fill(500));
  });
  it.each([
    'schema',
    'duplicate',
    'id',
    'size',
    'frames',
    'hash',
    'bytes',
    'timing',
    'cycles',
    'still',
    'mode',
  ])('rejects malformed %s without partially accepting a release', kind => {
    const value = clone();
    const s = value.scenes[0];
    if (kind === 'schema') value.schemaVersion = 2;
    if (kind === 'duplicate') value.scenes.push(s);
    if (kind === 'id') s.id = '../wave';
    if (kind === 'size') s.frameSize = [999999, 1];
    if (kind === 'frames') s.frames = 100000;
    if (kind === 'hash') s.sha256 = 'https://attacker.example/x';
    if (kind === 'bytes') s.bytes = 5 * 1024 * 1024;
    if (kind === 'timing') s.durations[0] = NaN;
    if (kind === 'cycles') s.cycles = 100000;
    if (kind === 'still') s.still = 100;
    if (kind === 'mode') s.renderMode = 'url(javascript:alert(1))';
    expect(() => parseMoaCatalog(value)).toThrow();
  });
  it('discards arbitrary remote URL, code and style fields', () => {
    const value = clone();
    Object.assign(value.scenes[0], {
      src: 'https://attacker.example',
      code: 'alert(1)',
      style: {},
    });
    expect(parseMoaCatalog(value).scenes[0]).not.toHaveProperty('src');
    expect(parseMoaCatalog(value).scenes[0]).not.toHaveProperty('code');
  });
  it('rejects both declared and streaming oversized bodies', async () => {
    await expect(
      readBoundedBody(
        new Response('x', { headers: { 'content-length': String(MAX_CATALOG_BYTES + 1) } }),
        MAX_CATALOG_BYTES
      )
    ).rejects.toThrow();
    await expect(readBoundedBody(new Response('123456'), 5)).rejects.toThrow();
  });
  it('retains the validated cache after a bad release and sends no credentials or referrer', async () => {
    localStorage.setItem(MOA_CATALOG_KEY, JSON.stringify(clone()));
    const mock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"schemaVersion":9}'));
    await expect(fetchMoaCatalog(new AbortController().signal)).rejects.toThrow();
    expect(readCachedMoaCatalog()?.scenes).toHaveLength(222);
    expect(mock).toHaveBeenCalledWith(
      MOA_CATALOG_URL,
      expect.objectContaining({
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        cache: 'no-cache',
      })
    );
  });
  it('tolerates denied or corrupted cache storage', () => {
    localStorage.setItem(MOA_CATALOG_KEY, 'broken');
    expect(readCachedMoaCatalog()).toBeNull();
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    expect(readCachedMoaCatalog()).toBeNull();
  });
  it('verifies actual SHA and size before turning an atlas into an image', async () => {
    const s = parseMoaCatalog(clone()).scenes[0];
    vi.stubGlobal('crypto', webcrypto);
    const bytes = new TextEncoder().encode('bounded PNG test payload');
    const digest = await webcrypto.subtle.digest('SHA-256', bytes);
    s.sha256 = Buffer.from(digest).toString('hex');
    s.bytes = bytes.length;
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(bytes));
    const blob = await fetchMoaAtlas(s, new AbortController().signal);
    expect(blob.size).toBe(bytes.length);
    expect(mock).toHaveBeenCalledWith(
      `${MOA_DATA_BASE}assets/${s.sha256}.png`,
      expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' })
    );
    s.sha256 = '0'.repeat(64);
    await expect(fetchMoaAtlas(s, new AbortController().signal)).rejects.toThrow('integrity');
  });
  it('maps every duration to a discrete illustrated pose, with a finite reduced-motion clock', () => {
    const s = parseMoaCatalog(clone()).scenes.find(x => x.id === 'thinking')!;
    const frames = moaKeyframes(s, false);
    expect(frames).toHaveLength(s.frames + 1);
    expect(frames[1].offset).toBeCloseTo(s.durations[0] / s.durations.reduce((a, b) => a + b));
    expect(frames.at(-1)?.offset).toBe(1);
    expect(new Set(moaKeyframes(s, true).map(f => f.transform)).size).toBe(1);
  });
});
