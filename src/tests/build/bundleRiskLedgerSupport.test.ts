import { describe, expect, it } from 'vitest';
import {
  BUNDLE_RISK_LEDGER_GENERATED_AT,
  buildBundleRiskLedgerReport,
  formatBundleRiskLedgerMarkdown,
} from '../../../scripts/bundleRiskLedgerSupport.mjs';

const ledgerConfig = {
  policyVersion: '2026-06-v1',
  surfaces: [
    {
      id: 'vendor-heic2any',
      owner: 'prescriptions/runtime',
      workflow: 'HEIC prescription image conversion',
      thresholdLabel: '1,450,000 bytes chunk budget',
      chunkBudgetPattern: '^vendor-heic2any-.*\\.js$',
      precacheIgnoredPattern: '^assets/vendor-heic2any-.*\\.js$',
      releasePosture: 'async only; not a blocker while under threshold and outside precache',
      nextAction: 'Keep the converter behind its runtime loader.',
    },
    {
      id: 'app-authenticated-shell',
      owner: 'app-shell/census runtime',
      workflow: 'authenticated census shell',
      thresholdLabel: '600,000 bytes startup chunk budget',
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
  ],
  precacheIgnoredAssetPatterns: ['^assets/vendor-heic2any-.*\\.js$'],
};

describe('bundleRiskLedgerSupport', () => {
  it('builds an executable bundle risk ledger from config and bundle budgets', () => {
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
        }),
        expect.objectContaining({
          id: 'app-authenticated-shell',
          status: 'ok',
          budgetCovered: true,
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
        'app-authenticated-shell is missing an enforced bundle budget',
      ])
    );
  });

  it('renders markdown suitable for release debt review', () => {
    const report = buildBundleRiskLedgerReport({ ledgerConfig, bundleBudgetConfig });

    const markdown = formatBundleRiskLedgerMarkdown(report);

    expect(markdown).toContain('# Bundle Risk Ledger Snapshot');
    expect(markdown).toContain(
      '| Surface | Owner | Workflow | Threshold | Status | Budget | Precache | Release posture | Guardrails |'
    );
    expect(markdown).toContain('1,450,000 bytes chunk budget');
    expect(markdown).toContain('async only; not a blocker');
    expect(markdown).toContain('vendor-heic2any');
    expect(markdown).toContain('app-authenticated-shell');
  });
});
