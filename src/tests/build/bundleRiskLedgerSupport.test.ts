// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUNDLE_RISK_LEDGER_GENERATED_AT,
  buildBundleRiskLedgerReport,
  formatBundleRiskLedgerMarkdown,
  loadBundleRiskLedgerReport,
} from '../../../scripts/bundleRiskLedgerSupport.mjs';

const ledgerConfig = {
  policyVersion: '2026-06-v1',
  surfaces: [
    {
      id: 'vendor-heic2any',
      owner: 'prescriptions/runtime',
      workflow: 'HEIC prescription image conversion',
      chunkBudgetPattern: '^vendor-heic2any-.*\\.js$',
      precacheIgnoredPattern: '^assets/vendor-heic2any-.*\\.js$',
      releasePosture: 'async only; not a blocker while under threshold and outside precache',
      nextAction: 'Keep the converter behind its runtime loader.',
    },
    {
      id: 'vendor-firebase-functions',
      owner: 'firebase-runtime/functions',
      workflow: 'Callable Firebase Functions',
      chunkBudgetPattern: '^vendor-firebase-functions-.*\\.js$',
      releasePosture: 'precached runtime bounded by dedicated chunk ceiling',
      nextAction: 'Keep callable functions isolated.',
    },
    {
      id: 'app-authenticated-shell',
      owner: 'app-shell/census runtime',
      workflow: 'authenticated census shell',
      startupBudgetLabel: 'app-authenticated-shell',
      releasePosture: 'startup chunk remains below hard ceiling',
      nextAction: 'Move secondary authenticated concerns behind lazy boundaries.',
    },
  ],
};

const bundleBudgetConfig = {
  startupChunkBudgets: [
    {
      label: 'app-authenticated-shell',
      pattern: '^app-authenticated-shell-.*\\.js$',
      maxBytes: 600000,
    },
  ],
  chunkPatternBudgets: [
    {
      pattern: '^vendor-heic2any-.*\\.js$',
      maxBytes: 1450000,
    },
    {
      pattern: '^vendor-firebase-functions-.*\\.js$',
      maxBytes: 30000,
    },
  ],
  precacheIgnoredAssetPatterns: ['^assets/vendor-heic2any-.*\\.js$'],
};

describe('bundleRiskLedgerSupport', () => {
  it('derives threshold bytes and labels from enforced bundle budgets instead of manual strings', () => {
    const report = buildBundleRiskLedgerReport({ ledgerConfig, bundleBudgetConfig });

    expect(report.generatedAt).toBe(BUNDLE_RISK_LEDGER_GENERATED_AT);
    expect(report.status).toBe('ok');
    expect(report.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'vendor-heic2any',
          status: 'ok',
          budgetCovered: true,
          precacheExcluded: true,
          thresholdBytes: 1450000,
          thresholdLabel: '1,450,000 bytes async chunk budget',
        }),
        expect.objectContaining({
          id: 'vendor-firebase-functions',
          status: 'ok',
          budgetCovered: true,
          precacheExcluded: null,
          thresholdBytes: 30000,
          thresholdLabel: '30,000 bytes precached chunk budget',
        }),
        expect.objectContaining({
          id: 'app-authenticated-shell',
          status: 'ok',
          budgetCovered: true,
          thresholdBytes: 600000,
          thresholdLabel: '600,000 bytes startup chunk budget',
        }),
      ])
    );
  });

  it('degrades when a ledger surface no longer maps to an enforced budget', () => {
    const report = buildBundleRiskLedgerReport({
      ledgerConfig,
      bundleBudgetConfig: {
        startupChunkBudgets: [],
        chunkPatternBudgets: [],
        precacheIgnoredAssetPatterns: [],
      },
    });

    expect(report.status).toBe('degraded');
    expect(report.issues).toEqual(
      expect.arrayContaining([
        'vendor-heic2any is missing an enforced bundle budget',
        'vendor-heic2any is missing precache exclusion',
        'vendor-firebase-functions is missing an enforced bundle budget',
        'app-authenticated-shell is missing an enforced bundle budget',
      ])
    );
  });

  it('renders derived thresholds in markdown and loads the live repository ledger without manual threshold labels', () => {
    const report = buildBundleRiskLedgerReport({ ledgerConfig, bundleBudgetConfig });
    const markdown = formatBundleRiskLedgerMarkdown(report);

    expect(markdown).toContain('vendor-heic2any');
    expect(markdown).toContain('app-authenticated-shell');
    expect(markdown).toContain('1,450,000 bytes async chunk budget');
    expect(markdown).toContain('30,000 bytes precached chunk budget');
    expect(markdown).toContain('600,000 bytes startup chunk budget');
    expect(markdown).toContain('async only; not a blocker');

    const liveLedger = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'scripts/config/bundle-risk-ledger.json'), 'utf8')
    );
    for (const surface of liveLedger.surfaces) {
      expect(surface).not.toHaveProperty('thresholdLabel');
    }
    const liveReport = loadBundleRiskLedgerReport();
    expect(liveReport.status).toBe('ok');
    expect(
      liveReport.surfaces.find(surface => surface.id === 'vendor-firebase-functions')
        ?.thresholdLabel
    ).toBe('30,000 bytes precached chunk budget');
  });

  it('documents the governed heavy bundle surfaces in docs/BUNDLE_RISK_LEDGER.md', () => {
    const ledger = fs.readFileSync(path.join(process.cwd(), 'docs/BUNDLE_RISK_LEDGER.md'), 'utf8');

    for (const surface of [
      'vendor-heic2any',
      'vendor-pdfjs',
      'vendor-pdf-lib',
      'app-authenticated-shell',
    ]) {
      expect(ledger).toContain(surface);
    }
  });
});
