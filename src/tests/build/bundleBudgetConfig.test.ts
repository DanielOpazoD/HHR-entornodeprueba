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
  entryMaxBytes: number;
  chunkMaxBytes: number;
  precacheMaxBytes: number;
  forbiddenAssetPatterns: string[];
  assetPatternBudgets: Array<{
    pattern: string;
    maxBytes: number;
  }>;
  startupChunkBudgets: Array<{
    label: string;
    pattern?: string;
    source?: string;
    maxBytes: number;
    severity?: string;
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

const expectPositiveByteCeiling = (value: number | undefined, label: string) => {
  expect(Number.isInteger(value) && (value ?? 0) > 0, label).toBe(true);
};

describe('bundle budget config', () => {
  it('declares valid, deduplicated regex patterns and positive ceilings across all budget groups', () => {
    const config = readBundleBudgetConfig();

    expectPositiveByteCeiling(config.entryMaxBytes, 'entryMaxBytes');
    expectPositiveByteCeiling(config.chunkMaxBytes, 'chunkMaxBytes');
    expectPositiveByteCeiling(config.precacheMaxBytes, 'precacheMaxBytes');

    const chunkPatterns = config.chunkPatternBudgets.map(budget => budget.pattern);
    expect(new Set(chunkPatterns).size).toBe(chunkPatterns.length);

    for (const budget of [
      ...config.assetPatternBudgets,
      ...config.chunkPatternBudgets,
      ...config.startupChunkBudgets,
    ]) {
      expectPositiveByteCeiling(budget.maxBytes, budget.pattern ?? 'startup');
      const { pattern } = budget;
      if (pattern) {
        expect(() => new RegExp(pattern)).not.toThrow();
      }
    }

    for (const pattern of config.forbiddenAssetPatterns) {
      expect(() => new RegExp(pattern)).not.toThrow();
    }
  });

  it('keeps explicit ceilings for heavy runtime assets and vendor chunks without micro-budgeting lazy feature chunks', () => {
    const config = readBundleBudgetConfig();

    const excelAsset = config.assetPatternBudgets.find(
      budget => budget.pattern === '^vendor/exceljs\\.bare\\.min\\.js$'
    );
    expectPositiveByteCeiling(excelAsset?.maxBytes, 'exceljs.bare.min.js');
    expect(findBudget(config, '^exceljs\\.min-.*\\.js$')).toBeUndefined();

    for (const pattern of [
      '^pdf-.*\\.js$',
      '^vendor-pdf-.*\\.js$',
      '^vendor-pdfjs-.*\\.js$',
      '^pdf\\.worker-.*\\.mjs$',
      '^vendor-heic2any-.*\\.js$',
      '^vendor-zod-.*\\.js$',
      '^vendor-firebase-core-.*\\.js$',
      '^vendor-firebase-firestore-.*\\.js$',
      '^vendor-firebase-aux-.*\\.js$',
      '^vendor-firebase-functions-.*\\.js$',
      '^vendor-excel-(?!core-).*\\.js$',
    ]) {
      const budget = findBudget(config, pattern);
      expect(budget, pattern).toBeDefined();
      expectPositiveByteCeiling(budget?.maxBytes, pattern);
    }
  });

  it('keeps startup chunk budgets blocking and below the generic chunk ceiling', () => {
    const config = readBundleBudgetConfig();

    for (const label of [
      'entry-app',
      'app-bootstrap',
      'firebase-core',
      'app-authenticated-shell',
    ]) {
      const budget = config.startupChunkBudgets.find(entry => entry.label === label);
      expect(budget, label).toMatchObject({ severity: 'error' });
      expectPositiveByteCeiling(budget?.maxBytes, label);
      expect(budget!.maxBytes).toBeLessThan(config.chunkMaxBytes);
    }
  });

  it('keeps the install-time precache policy focused on critical runtime files', () => {
    const config = readBundleBudgetConfig();

    expectPositiveByteCeiling(config.precacheMaxBytes, 'precacheMaxBytes');
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
