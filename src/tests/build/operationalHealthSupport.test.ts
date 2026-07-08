import { describe, expect, it } from 'vitest';
import {
  extractBootstrapTelemetrySignals,
  selectFrontendStartupCriticalAssets,
  summarizeFrontendStartupHealth,
  summarizePreviewGate,
} from '../../../scripts/operationalHealthSupport.mjs';

type StartupAsset = {
  file: string;
  status: string;
};

describe('operationalHealthSupport', () => {
  it('extracts bootstrap telemetry signals from the bootstrap runtime module', () => {
    const content = `
      recordBootstrapIssue('bootstrap_recovery_reload', 'recoverable', 'reload');
      recordBootstrapIssue('bootstrap_runtime_failed', 'blocked', 'boom');
      recordBootstrapIssue('bootstrap_chunk_load_failed', 'blocked', 'chunk');
      recordBootstrapIssue('bootstrap_window_error', 'blocked', 'window');
      recordBootstrapIssue('bootstrap_unhandled_rejection', 'blocked', 'reject');
    `;

    expect(extractBootstrapTelemetrySignals(content)).toEqual([
      'bootstrap_recovery_reload',
      'bootstrap_runtime_failed',
      'bootstrap_chunk_load_failed',
      'bootstrap_window_error',
      'bootstrap_unhandled_rejection',
    ]);
  });

  it('summarizes a healthy preview gate as ok', () => {
    expect(
      summarizePreviewGate({
        stats: {
          expected: 1,
          unexpected: 0,
          flaky: 0,
          skipped: 0,
          interrupted: 0,
          duration: 1200,
        },
      })
    ).toMatchObject({
      status: 'ok',
      total: 1,
      expected: 1,
    });
  });

  it('surfaces degraded startup health when preview artifacts are missing while near-limit chunks stay advisory', () => {
    const buildAssets: StartupAsset[] = [
      {
        file: 'dist/assets/index-app.js',
        status: 'ok',
      },
      {
        file: 'dist/assets/vendor-firebase-core-app.js',
        status: 'near-limit',
      },
      {
        file: 'dist/assets/app-authenticated-shell-app.js',
        status: 'ok',
      },
    ];

    const report = summarizeFrontendStartupHealth({
      previewGate: summarizePreviewGate(null),
      criticalAssets: selectFrontendStartupCriticalAssets({
        buildAssets: buildAssets as never[],
        entryAssets: [
          {
            file: 'dist/assets/index-entry.js',
            status: 'ok',
          },
        ] as never[],
      }) as StartupAsset[],
      bootstrapTelemetrySignals: ['bootstrap_chunk_load_failed'],
    });

    expect(report.status).toBe('degraded');
    expect(report.criticalAssets).toHaveLength(3);
    expect(
      report.criticalAssets.some(
        (asset: StartupAsset) => asset.file === 'dist/assets/index-entry.js'
      )
    ).toBe(true);
    expect(
      report.criticalAssets.some(
        (asset: StartupAsset) => asset.file === 'dist/assets/app-authenticated-shell-app.js'
      )
    ).toBe(true);
    expect(report.issues).toContain(
      'No hay artefacto reciente del smoke de preview para validar el arranque real.'
    );
    expect(report.issues.some(issue => issue.includes('vendor-firebase-core-app.js'))).toBe(false);
  });

  it('keeps frontend startup healthy when chunks are only near limit and preview is clean', () => {
    const report = summarizeFrontendStartupHealth({
      previewGate: summarizePreviewGate({
        stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0, interrupted: 0 },
      }),
      criticalAssets: [
        {
          file: 'dist/assets/app-authenticated-shell-app.js',
          status: 'near-limit',
        },
      ] as never[],
      bootstrapTelemetrySignals: [],
    });

    expect(report.status).toBe('ok');
    expect(report.issues).toEqual([]);
  });
});
