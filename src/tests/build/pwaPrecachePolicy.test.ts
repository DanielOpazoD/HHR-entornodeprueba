// @vitest-environment node
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
  it('loads MEDIF on demand with its PDF template while retaining the offline clinical library', () => {
    const viteConfig = readViteConfig();
    const patterns = readBundleBudgetConfig().precacheIgnoredAssetPatterns.map(
      pattern => new RegExp(pattern)
    );
    const isExcluded = (asset: string): boolean => patterns.some(pattern => pattern.test(asset));

    expect(viteConfig).toContain('**/assets/MedifTool-*.js');
    expect(isExcluded('assets/MedifTool-fixture.js')).toBe(true);
    expect(isExcluded('docs/biblioteca/medif-latam-rellenable.pdf')).toBe(true);
    expect(isExcluded('images/forms/medif/page-1.png')).toBe(true);
    expect(isExcluded('assets/ClinicalLibraryDrawer-fixture.js')).toBe(false);
    expect(viteConfig).not.toContain('**/assets/ClinicalLibraryDrawer-*.js');
    for (const tool of ['TransferCoverTool', 'CriticalMedicationsTool', 'ScoresTool']) {
      expect(isExcluded(`assets/${tool}-fixture.js`)).toBe(false);
      expect(viteConfig).not.toContain(`**/assets/${tool}-*.js`);
    }

    const registry = fs.readFileSync(
      'src/features/clinical-library/components/toolRegistry.tsx',
      'utf8'
    );
    expect(registry).toContain('const MedifTool = React.lazy(');
    expect(registry).toContain("import('./tools/MedifTool')");
    expect(registry).not.toMatch(/import\s+\{\s*MedifTool\s*\}\s+from/);

    // The exit guard travels with the editor, so an already open MEDIF can ask
    // to discard changes without fetching a new chunk after losing connection.
    const drawer = fs.readFileSync(
      'src/features/clinical-library/components/ClinicalLibraryDrawer.tsx',
      'utf8'
    );
    const medif = fs.readFileSync(
      'src/features/clinical-library/components/tools/MedifTool.tsx',
      'utf8'
    );
    expect(drawer).toContain("import('./tools/MedifTool')");
    expect(drawer).not.toContain("from './LibraryExitConfirmation'");
    expect(drawer).not.toContain("import('./LibraryExitConfirmation')");
    expect(medif).toContain("export { LibraryExitConfirmation } from '../LibraryExitConfirmation'");
  });

  it('keeps the opt-in decorative companion out of install-time precache accounting', () => {
    for (const extension of ['js', 'css']) {
      expect(readViteConfig()).toContain(`**/assets/MoaCompanion-*.${extension}`);
      expect(readBundleBudgetConfig().precacheIgnoredAssetPatterns).toContain(
        `^assets/MoaCompanion-.*\\.${extension}$`
      );
    }
  });
  it('keeps server-verified archive recovery and shared online report facts on demand', () => {
    for (const chunk of [
      'publicCudyrPolicyRecovery',
      'cudyrReportFacts',
      'cudyrEssentialWorkbook',
      'cudyrSourceWorkbook',
    ]) {
      expect(readViteConfig()).toContain(`**/assets/${chunk}-*.js`);
      expect(readBundleBudgetConfig().precacheIgnoredAssetPatterns).toContain(
        `^assets/${chunk}-.*\\.js$`
      );
    }
    const source = fs.readFileSync(
      'src/features/rayen-import/hooks/recoverCudyrArchivesAfterClinicalSync.ts',
      'utf8'
    );
    expect(source).toContain("import('@/services/storage/sync/publicCudyrPolicyRecovery')");
  });
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
    expect(viteConfig).toContain('**/assets/LineChart-*.js');
    expect(viteConfig).toContain('**/assets/vendor-excel-*.js');
    expect(viteConfig).toContain('**/assets/vendor-canvas-*.js');
    expect(viteConfig).toContain('**/assets/terminologyService-*.js');
    expect(viteConfig).toContain('**/assets/fonasaDatabase-*.js');
    expect(viteConfig).toContain('**/assets/clinicalDocumentTemplateEditorController-*.js');
    expect(viteConfig).toContain('**/assets/vendor-heic2any-*.js');
    expect(viteConfig).toContain('**/assets/vendor-firebase-functions-*.js');
    expect(viteConfig).toContain('**/assets/applyClinicalEnrichmentBatch-*.js');
    expect(viteConfig).toContain('**/assets/applyHistoricalCudyr-*.js');
    expect(viteConfig).toContain('**/assets/clinicalFillRunner-*.js');
    expect(viteConfig).toContain('**/assets/clinicalEnrichmentBatchPayload-*.js');
    expect(viteConfig).toContain('**/assets/clinicalEnrichmentPersistenceStrategy-*.js');
    expect(viteConfig).toContain('**/assets/PatientDocumentManagerDialog-*.js');
    expect(viteConfig).toContain('**/assets/ClinicalPanelDrawer-*.js');
  });

  it('loads the optional census monthly indicator on demand, like its historical reader', () => {
    expect(readViteConfig()).toContain('**/assets/CudyrMonthlyIndicator-*.js');
    expect(readViteConfig()).toContain('**/assets/useCudyrReport-*.js');
    expect(readBundleBudgetConfig().precacheIgnoredAssetPatterns).toContain(
      '^assets/CudyrMonthlyIndicator-.*\\.js$'
    );
    expect(readBundleBudgetConfig().precacheIgnoredAssetPatterns).toContain(
      '^assets/useCudyrReport-.*\\.js$'
    );
    const publicApi = fs.readFileSync('src/features/cudyr/public.ts', 'utf8');
    expect(publicApi).toContain("import('./components/CudyrMonthlyIndicator')");
    expect(publicApi).toContain("import('./components/CudyrView')");
  });

  it('keeps callable Functions on demand because every invocation requires network access', () => {
    const viteConfig = readViteConfig();
    const bundleBudgetConfig = readBundleBudgetConfig();

    expect(viteConfig).toContain('**/assets/vendor-firebase-functions-*.js');
    expect(bundleBudgetConfig.precacheIgnoredAssetPatterns).toContain(
      '^assets/vendor-firebase-functions-.*\\.js$'
    );
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

  it('keeps online-only Rayen enrichment out of the PWA install payload', () => {
    const viteConfig = readViteConfig();
    const bundleBudgetConfig = readBundleBudgetConfig();

    expect(viteConfig).toContain('**/assets/applyClinicalEnrichmentBatch-*.js');
    expect(bundleBudgetConfig.precacheIgnoredAssetPatterns).toContain(
      '^assets/applyClinicalEnrichmentBatch-.*\\.js$'
    );
    expect(bundleBudgetConfig.precacheIgnoredAssetPatterns).toContain(
      '^assets/applyHistoricalCudyr-.*\\.js$'
    );
    expect(bundleBudgetConfig.precacheIgnoredAssetPatterns).toContain(
      '^assets/clinicalFillRunner-.*\\.js$'
    );
    expect(bundleBudgetConfig.precacheIgnoredAssetPatterns).toContain(
      '^assets/clinicalEnrichmentBatchPayload-.*\\.js$'
    );
    expect(bundleBudgetConfig.precacheIgnoredAssetPatterns).toContain(
      '^assets/clinicalEnrichmentPersistenceStrategy-.*\\.js$'
    );
    expect(bundleBudgetConfig.precacheIgnoredAssetPatterns).toContain(
      '^assets/PatientDocumentManagerDialog-.*\\.js$'
    );
    expect(bundleBudgetConfig.precacheIgnoredAssetPatterns).toContain(
      '^assets/ClinicalPanelDrawer-.*\\.js$'
    );
  });
});
