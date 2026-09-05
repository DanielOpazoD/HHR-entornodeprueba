import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface BundleBudgetConfig {
  precacheMaxBytes: number;
  precacheIgnoredAssetPatterns: string[];
  forbiddenAssetPatterns: string[];
  assetPatternBudgets: Array<{
    pattern: string;
    maxBytes: number;
  }>;
  startupChunkBudgets: Array<{
    label: string;
    maxBytes: number;
  }>;
  chunkPatternBudgets: Array<{
    pattern: string;
    maxBytes: number;
  }>;
}

const readBundleBudgetConfig = (): BundleBudgetConfig =>
  JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'scripts/config/bundle-budget.json'), 'utf8')
  ) as BundleBudgetConfig;

const findBudget = (config: BundleBudgetConfig, pattern: string) =>
  config.chunkPatternBudgets.find(budget => budget.pattern === pattern);

describe('bundle budget config', () => {
  it('keeps explicit ceilings for the heavy Excel runtime asset and PDF async chunk', () => {
    const config = readBundleBudgetConfig();

    expect(
      config.assetPatternBudgets.find(
        budget => budget.pattern === '^vendor/exceljs\\.bare\\.min\\.js$'
      )
    ).toMatchObject({
      maxBytes: 960000,
    });
    expect(findBudget(config, '^exceljs\\.min-.*\\.js$')).toBeUndefined();
    expect(findBudget(config, '^pdf-.*\\.js$')).toMatchObject({
      maxBytes: 560000,
    });
    expect(findBudget(config, '^vendor-pdf-.*\\.js$')).toMatchObject({
      maxBytes: 430000,
    });
    expect(findBudget(config, '^pdf\\.worker-.*\\.mjs$')).toMatchObject({
      maxBytes: 2500000,
    });
    expect(findBudget(config, '^vendor-heic2any-.*\\.js$')).toMatchObject({
      maxBytes: 1450000,
    });
    expect(findBudget(config, '^PatientDocumentManagerDialog-.*\\.js$')).toMatchObject({
      maxBytes: 20000,
    });
    expect(findBudget(config, '^ClinicalPanelDrawer-.*\\.js$')).toMatchObject({
      maxBytes: 50000,
    });
  });

  it('keeps authenticated shell budget above the measured critical-runtime baseline', () => {
    const config = readBundleBudgetConfig();

    expect(
      config.startupChunkBudgets.find(budget => budget.label === 'app-authenticated-shell')
    ).toMatchObject({
      maxBytes: 606000,
      severity: 'error',
    });
  });

  it('keeps the install-time precache budget focused on critical runtime files', () => {
    const config = readBundleBudgetConfig();

    // PR #330: +24000 bytes for the measured +18.6 KiB UPC feature payload.
    // Keep evaluation and partial local history available offline, not excluded.
    expect(config.precacheMaxBytes).toBe(4832000);
    expect(config.precacheIgnoredAssetPatterns.some(pattern => /upc/i.test(pattern))).toBe(false);
    expect(config.precacheIgnoredAssetPatterns).toEqual(
      expect.arrayContaining([
        '^docs/',
        '^templates/',
        '^images/forms/',
        '^vendor/exceljs\\.bare\\.min\\.js$',
        '^assets/exceljs\\.min-.*\\.js$',
        '^assets/pdf\\.worker-.*\\.mjs$',
        '^assets/vendor-pdfjs-.*\\.js$',
        '^assets/pdf-.*\\.js$',
        '^assets/vendor-pdf-.*\\.js$',
        '^assets/LineChart-.*\\.js$',
        '^assets/vendor-excel-.*\\.js$',
        '^assets/vendor-canvas-.*\\.js$',
        '^assets/terminologyService-.*\\.js$',
        '^assets/fonasaDatabase-.*\\.js$',
        '^assets/clinicalDocumentTemplateEditorController-.*\\.js$',
        '^assets/vendor-heic2any-.*\\.js$',
        '^assets/applyClinicalEnrichmentBatch-.*\\.js$',
        '^assets/applyHistoricalCudyr-.*\\.js$',
        '^assets/clinicalFillRunner-.*\\.js$',
        '^assets/clinicalEnrichmentBatchPayload-.*\\.js$',
        '^assets/clinicalEnrichmentPersistenceStrategy-.*\\.js$',
        '^assets/PatientDocumentManagerDialog-.*\\.js$',
        '^assets/ClinicalPanelDrawer-.*\\.js$',
      ])
    );
  });

  it('blocks duplicate bundled ExcelJS runtime assets', () => {
    const config = readBundleBudgetConfig();

    expect(config.forbiddenAssetPatterns).toEqual(
      expect.arrayContaining(['^assets/exceljs\\.min-.*\\.js$'])
    );
  });
});
