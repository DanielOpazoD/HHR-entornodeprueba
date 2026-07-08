import { describe, expect, it } from 'vitest';

import {
  classifyBuildAssetBudget,
  resolveBuildAssetBudget,
} from '../../../scripts/bundleBudgetSupport.mjs';

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

describe('bundleBudgetSupport', () => {
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
