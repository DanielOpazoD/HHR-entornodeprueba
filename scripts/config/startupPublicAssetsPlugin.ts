import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { transformWithEsbuild, type Plugin } from 'vite';

/** Minify owned public scripts/styles before Workbox computes revisions; keep offline coverage without inflating the download budget. */
export const startupPublicAssetsPlugin = (): Plugin => ({
  name: 'startup-public-assets',
  apply: 'build',
  async writeBundle(options) {
    if (!options.dir) throw new Error('Startup assets require a build output directory.');
    for (const asset of [
      'app-chrome.css',
      'startup-surface.js',
      'document-scanner/jscanify-worker.js',
    ]) {
      const assetPath = path.join(options.dir, asset);
      const source = await readFile(assetPath, 'utf8');
      const { code } = await transformWithEsbuild(source, asset, {
        loader: asset.endsWith('.css') ? 'css' : 'js',
        minify: true,
        target: 'es2020',
        sourcemap: false,
      });
      await writeFile(assetPath, code);
    }
  },
});
