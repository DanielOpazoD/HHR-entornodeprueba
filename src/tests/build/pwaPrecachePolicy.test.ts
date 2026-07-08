import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface BundleBudgetConfig {
  precacheIgnoredAssetPatterns: string[];
}

const readViteConfig = (): string =>
  fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8');

const readBundleBudgetConfig = (): BundleBudgetConfig =>
  JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'scripts/config/bundle-budget.json'), 'utf8')
  ) as BundleBudgetConfig;

describe('PWA precache policy', () => {
  it('keeps heavyweight optional references and runtimes out of the install-time precache', () => {
    const viteConfig = readViteConfig();

    expect(viteConfig).toContain('globIgnores');
    expect(viteConfig).toContain('**/docs/**');
    expect(viteConfig).toContain('**/templates/**');
    expect(viteConfig).toContain('**/images/forms/**');
    expect(viteConfig).toContain('**/vendor/exceljs.bare.min.js');
    expect(viteConfig).toContain('**/assets/exceljs.min-*.js');
    expect(viteConfig).toContain('**/assets/pdf.worker-*.mjs');
    expect(viteConfig).toContain('**/assets/vendor-pdfjs-*.js');
    expect(viteConfig).toContain('**/assets/pdf-*.js');
    expect(viteConfig).toContain('**/assets/vendor-pdf-*.js');
    expect(viteConfig).toContain('**/assets/docxtemplater-*.js');
    expect(viteConfig).toContain('**/assets/LineChart-*.js');
    expect(viteConfig).toContain('**/assets/documentFallbacks-*.js');
    expect(viteConfig).toContain('**/assets/vendor-excel-*.js');
    expect(viteConfig).toContain('**/assets/vendor-canvas-*.js');
    expect(viteConfig).toContain('**/assets/terminologyService-*.js');
    expect(viteConfig).toContain('**/assets/fonasaDatabase-*.js');
    expect(viteConfig).toContain('**/assets/clinicalDocumentTemplateEditorController-*.js');
    expect(viteConfig).toContain('**/assets/vendor-heic2any-*.js');
  });

  it('keeps HEIC and PDF.js runtimes excluded from both PWA config and bundle budget precache accounting', () => {
    const viteConfig = readViteConfig();
    const bundleBudgetConfig = readBundleBudgetConfig();

    expect(viteConfig).toContain('**/assets/vendor-pdfjs-*.js');
    expect(viteConfig).toContain('**/assets/vendor-heic2any-*.js');
    expect(bundleBudgetConfig.precacheIgnoredAssetPatterns).toEqual(
      expect.arrayContaining(['^assets/vendor-pdfjs-.*\\.js$', '^assets/vendor-heic2any-.*\\.js$'])
    );
  });
});
