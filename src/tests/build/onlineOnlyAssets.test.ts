// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  ONLINE_ONLY_ASSETS,
  ONLINE_ONLY_ASSET_GLOBS,
  ONLINE_ONLY_PRECACHE_PATTERNS,
  globToPrecachePattern,
} from '../../../scripts/config/onlineOnlyAssets.mjs';

describe('online-only assets, the single list behind globIgnores and the budget check', () => {
  it('turns each Workbox glob into the manifest pattern the budget check uses', () => {
    expect(globToPrecachePattern('**/assets/MoaCompanion-*.js')).toBe('^assets/MoaCompanion-.*\\.js$');
    expect(globToPrecachePattern('**/images/moa/**')).toBe('^images/moa/');
    expect(globToPrecachePattern('**/vendor/exceljs.bare.min.js')).toBe('^vendor/exceljs\\.bare\\.min\\.js$');
    expect(globToPrecachePattern('**/assets/Dicom*-*')).toBe('^assets/Dicom.*-.*$');
    expect(globToPrecachePattern('**/assets/pdf.worker-*.mjs')).toBe('^assets/pdf\\.worker-.*\\.mjs$');
  });

  it('keeps the wasm codecs matched inside assets only, as the budget always did', () => {
    const wasm = ONLINE_ONLY_ASSETS.find(asset => asset.glob === '**/*.wasm');
    expect(wasm?.pattern).toBe('^assets/.*\\.wasm$');
    expect(new RegExp(wasm!.pattern!).test('assets/openjpegwasm_decode-abc.wasm')).toBe(true);
  });

  it('explains every entry, lists each glob once and derives one pattern per glob', () => {
    expect(ONLINE_ONLY_ASSETS.length).toBeGreaterThan(70);
    for (const asset of ONLINE_ONLY_ASSETS) {
      expect(asset.glob.startsWith('**/')).toBe(true);
      expect(asset.reason.trim().length).toBeGreaterThan(10);
    }
    expect(new Set(ONLINE_ONLY_ASSET_GLOBS).size).toBe(ONLINE_ONLY_ASSET_GLOBS.length);
    expect(ONLINE_ONLY_PRECACHE_PATTERNS).toHaveLength(ONLINE_ONLY_ASSET_GLOBS.length);
    for (const pattern of ONLINE_ONLY_PRECACHE_PATTERNS) expect(() => new RegExp(pattern)).not.toThrow();
  });

  it('never excludes the offline census runtime', () => {
    const regexes = ONLINE_ONLY_PRECACHE_PATTERNS.map(pattern => new RegExp(pattern));
    for (const core of [
      'assets/app-authenticated-shell-fixture.js',
      'assets/census-view-fixture.js',
      'assets/dexieDailyRecordOutbox-fixture.js',
      'assets/syncQueueEngine-fixture.js',
      'assets/ClinicalLibraryDrawer-fixture.js',
    ]) {
      expect(regexes.some(regex => regex.test(core))).toBe(false);
    }
  });
});
