// @vitest-environment node
import { ONLINE_ONLY_ASSET_GLOBS, ONLINE_ONLY_PRECACHE_PATTERNS } from '../../../scripts/config/onlineOnlyAssets.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { expect, it } from 'vitest';

it('generates the same precache membership that the budget accounts for', async () => {
  // vite.config.ts spreads this same list into Workbox's globIgnores.
  const globIgnores = [...ONLINE_ONLY_ASSET_GLOBS];
  expect(globIgnores.length).toBeGreaterThan(0);
  expect(fs.readFileSync('vite.config.ts', 'utf8')).toContain('globIgnores: [...ONLINE_ONLY_ASSET_GLOBS]');
  const patterns = ONLINE_ONLY_PRECACHE_PATTERNS.map(pattern => new RegExp(pattern));
  const assets = Array.from(
    new Set([
      ...globIgnores.map(glob =>
        glob
          .replace(/^\*\*\//, '')
          .replace(/\*\*/g, 'fixture.js')
          .replace(/\*/g, 'fixture')
          .replace(/^fixture\.wasm$/, 'assets/fixture.wasm')
      ),
      'assets/clinicalFormDocx-fixture.js',
      'assets/ClinicalFormTool-fixture.js',
      'assets/clinicalCarryoverVerification-fixture.js',
      'assets/CudyrReportExplorer-fixture.js',
      'assets/cudyrReportWorkbook-fixture.js',
      'assets/cudyrReportLoader-fixture.js',
      'downloads/optional.js',
      'assets/app-authenticated-shell-fixture.js',
      'assets/dexieDailyRecordOutbox-fixture.js',
      'assets/clinicalDerivedConstants-fixture.js',
      'assets/ClinicalLibraryDrawer-fixture.js',
      'assets/TransferCoverTool-fixture.js',
      'assets/ScoresTool-fixture.js',
    ])
  );
  const cache = path.join(process.cwd(), 'node_modules/.cache');
  fs.mkdirSync(cache, { recursive: true });
  const directory = fs.mkdtempSync(path.join(cache, 'pwa-manifest-'));
  try {
    const output = path.join(directory, 'dist');
    for (const asset of assets) {
      const file = path.join(output, asset);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, '/* synthetic asset */');
    }
    const input = path.join(directory, 'entry.js');
    fs.writeFileSync(input, 'export const synthetic = true;');
    let urls: string[] = [];
    // Build only this synthetic entry, using the declared PWA plugin's Workbox integration.
    await build({
      configFile: false,
      root: directory,
      publicDir: false,
      logLevel: 'silent',
      build: {
        outDir: output,
        emptyOutDir: false,
        rollupOptions: {
          input,
          output: { entryFileNames: 'assets/app-authenticated-shell-fixture.js' },
        },
      },
      plugins: [
        VitePWA({
          manifest: false,
          injectRegister: false,
          workbox: {
            globPatterns: ['**/*'],
            globIgnores,
            inlineWorkboxRuntime: true,
            manifestTransforms: [
              async entries => {
                urls = entries.map(entry => entry.url).sort();
                return { manifest: entries, warnings: [] };
              },
            ],
          },
        }),
      ],
    });
    expect(urls).toEqual(assets.filter(asset => !patterns.some(p => p.test(asset))).sort());
    expect(urls).not.toContain('assets/clinicalFormDocx-fixture.js');
    expect(urls).toContain('assets/dexieDailyRecordOutbox-fixture.js');
    expect(urls).toContain('assets/TransferCoverTool-fixture.js');
    expect(urls).toContain('assets/ScoresTool-fixture.js');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
