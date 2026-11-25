// @vitest-environment node
import {
  classifyBuildAssetBudget,
  resolveBuildAssetBudget,
} from '../../../scripts/bundleBudgetSupport.mjs';
import { ONLINE_ONLY_PRECACHE_PATTERNS } from '../../../scripts/config/onlineOnlyAssets.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

interface BundleBudgetConfig {
  precacheMaxBytes: number;
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
  it('bounds the core monthly export and optional Eloisa source separately', () => {
    const config = readBundleBudgetConfig();
    expect(findBudget(config, '^cudyrEssentialWorkbook-.*\\.js$')).toMatchObject({
      maxBytes: 12000,
    });
    expect(findBudget(config, '^cudyrSourceWorkbook-.*\\.js$')).toMatchObject({
      maxBytes: 20000,
    });
  });

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
    expect(findBudget(config, '^RayenSyncHistoryModal-.*\\.js$')).toMatchObject({
      maxBytes: 28148,
    });
    expect(findBudget(config, '^RayenSyncTechnicalMetricsPanel-.*\\.js$')).toMatchObject({
      maxBytes: 4737,
    });
    expect(findBudget(config, '^perfAuditReport-.*\\.js$')).toMatchObject({ maxBytes: 4000 });
    expect(findBudget(config, '^RayenImportButton-.*\\.js$')).toMatchObject({ maxBytes: 250430 });
    expect(findBudget(config, '^ClinicalLibraryDrawer-.*\\.js$')).toMatchObject({
      maxBytes: 120000,
    });
  });

  it('keeps authenticated shell budget above the measured critical-runtime baseline', () => {
    const config = readBundleBudgetConfig();

    expect(
      config.startupChunkBudgets.find(budget => budget.label === 'app-authenticated-shell')
    ).toMatchObject({
      // Measured shell plus ~5% once startup modules left it (2026-11-19; BUNDLE_RISK_LEDGER.md).
      maxBytes: 349000,
      severity: 'error',
    });
  });

  it('keeps the install-time precache budget focused on critical runtime files', () => {
    const config = readBundleBudgetConfig();

    // Preserve offline clinical validation with the measured security-upgrade allowance,
    // plus note replay, the bounded 2 KiB shared crash-cart checklist allowance and the census
    // program's measured uses.
    expect(config.precacheMaxBytes).toBe(
      4840192 +
        2048 +
        67840 +
        31744 +
        2048 +
        8192 +
        40960 +
        38912 +
        8192 +
        4096 +
        2048 +
        512 +
        1536 +
        3072 +
        5120
    );
    expect(findBudget(config, '^vendor-zod-.*\\.js$')).toMatchObject({ maxBytes: 96000 });
    expect(
      ONLINE_ONLY_PRECACHE_PATTERNS.some(pattern => /sessionActivity|auth/i.test(pattern))
    ).toBe(false);
    expect(ONLINE_ONLY_PRECACHE_PATTERNS.some(pattern => /upc/i.test(pattern))).toBe(false);
    expect(ONLINE_ONLY_PRECACHE_PATTERNS).toEqual(
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
        '^assets/vendor-heic2any-.*\\.js$',
        '^assets/applyClinicalEnrichmentBatch-.*\\.js$',
        '^assets/applyHistoricalCudyr-.*\\.js$',
        '^assets/clinicalFillRunner-.*\\.js$',
        '^assets/RayenImportButton-.*\\.js$',
        '^assets/clinicalEnrichmentBatchPayload-.*\\.js$',
        '^assets/PatientDocumentManagerDialog-.*\\.js$',
        '^assets/ClinicalPanelDrawer-.*\\.js$',
        '^assets/RayenSyncHistoryModal-.*\\.js$',
        '^assets/perfAuditReport-.*\\.js$',
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

describe('bundleBudgetSupport', () => {
  const budgetConfig = {
    chunkMaxBytes: 1_250_000,
    startupChunkBudgets: [
      {
        label: 'app-authenticated-shell',
        pattern: '^app-authenticated-shell-.*\\.js$',
        maxBytes: 600_000,
        severity: 'error',
      },
    ],
    chunkPatternBudgets: [
      {
        label: 'vendor-heic2any',
        pattern: '^vendor-heic2any-.*\\.js$',
        maxBytes: 1_450_000,
      },
      {
        label: 'vendor-pdfjs',
        pattern: '^vendor-pdfjs-.*\\.js$',
        maxBytes: 520_000,
      },
      {
        label: 'vendor-pdf-lib',
        pattern: '^vendor-pdf-.*\\.js$',
        maxBytes: 430_000,
      },
    ],
  };

  it('uses dedicated chunk pattern budgets before the generic chunk ceiling', () => {
    expect(
      resolveBuildAssetBudget({
        file: 'dist/assets/vendor-heic2any-ClJ2fQYX.js',
        budgetConfig,
      })
    ).toMatchObject({
      maxBytes: 1_450_000,
      budgetLabel: 'vendor-heic2any',
      budgetSource: 'chunkPatternBudget',
    });
  });

  it('keeps unregistered chunks on the generic ceiling', () => {
    expect(
      classifyBuildAssetBudget({
        file: 'dist/assets/vendor-untracked-large.js',
        sizeBytes: 1_350_000,
        budgetConfig,
      })
    ).toMatchObject({
      maxBytes: 1_250_000,
      budgetLabel: 'chunkMaxBytes',
      budgetSource: 'chunkMaxBytes',
      status: 'blocking',
    });
  });

  it('surfaces HEIC as near-limit, not blocking, while it is inside its dedicated ledger budget', () => {
    expect(
      classifyBuildAssetBudget({
        file: 'dist/assets/vendor-heic2any-ClJ2fQYX.js',
        sizeBytes: 1_350_000,
        budgetConfig,
      })
    ).toMatchObject({
      maxBytes: 1_450_000,
      budgetLabel: 'vendor-heic2any',
      budgetSource: 'chunkPatternBudget',
      budgetUtilizationPct: 93.1,
      status: 'near-limit',
    });
  });

  it('classifies PDF and app shell surfaces against their dedicated budgets', () => {
    expect(
      classifyBuildAssetBudget({
        file: 'dist/assets/vendor-pdfjs-C4G2Lk1-.js',
        sizeBytes: 400_000,
        budgetConfig,
      })
    ).toMatchObject({
      maxBytes: 520_000,
      budgetLabel: 'vendor-pdfjs',
      budgetSource: 'chunkPatternBudget',
      status: 'ok',
    });

    expect(
      classifyBuildAssetBudget({
        file: 'dist/assets/vendor-pdf-lib-BrVFzLGn.js',
        sizeBytes: 440_000,
        budgetConfig,
      })
    ).toMatchObject({
      maxBytes: 430_000,
      budgetLabel: 'vendor-pdf-lib',
      budgetSource: 'chunkPatternBudget',
      status: 'blocking',
    });

    expect(
      classifyBuildAssetBudget({
        file: 'dist/assets/app-authenticated-shell-B_IbeW9R.js',
        sizeBytes: 550_000,
        budgetConfig,
      })
    ).toMatchObject({
      maxBytes: 600_000,
      budgetLabel: 'app-authenticated-shell',
      budgetSource: 'startupChunkBudget',
      status: 'near-limit',
    });
  });
});
