import { describe, expect, it } from 'vitest';

import {
  buildRuntimeAssetMarginReport,
  formatRuntimeAssetMarginMarkdown,
} from '../../../scripts/runtimeAssetMarginReportSupport.mjs';

const ledgerConfig = {
  policyVersion: 'test-policy',
  surfaces: [
    {
      id: 'vendor-heic2any',
      owner: 'prescriptions/runtime',
      workflow: 'HEIC/HEIF prescription photo conversion',
      loadReason: 'Only high-efficiency prescription photos require conversion.',
      chunkBudgetPattern: '^vendor-heic2any-.*\\.js$',
      nextAction: 'Keep behind loadHeicConverter.',
    },
    {
      id: 'vendor-pdfjs',
      owner: 'clinical-documents/PDF runtime',
      workflow: 'PDF text/import runtime',
      loadReason: 'Only PDF text extraction workflows require PDF.js.',
      chunkBudgetPattern: '^vendor-pdfjs-.*\\.js$',
      nextAction: 'Keep behind loadPdfJsTextRuntime.',
    },
    {
      id: 'vendor-pdf-lib',
      owner: 'clinical-documents/PDF generation',
      workflow: 'PDF generation and manipulation',
      loadReason: 'Only browser PDF generation requires pdf-lib.',
      chunkBudgetPattern: '^vendor-pdf-.*\\.js$',
      nextAction: 'Keep behind loadPdfLibGenerationRuntime.',
    },
    {
      id: 'pdfjs-worker',
      owner: 'clinical-documents/PDF runtime',
      workflow: 'PDF.js worker runtime',
      loadReason: 'Only PDF text extraction requires the PDF.js worker.',
      chunkBudgetPattern: '^pdf\\.worker-.*\\.mjs$',
      nextAction: 'Track worker dependency drift.',
    },
    {
      id: 'app-authenticated-shell',
      owner: 'app-shell/census runtime',
      workflow: 'Authenticated census shell',
      loadReason: 'Post-login census runtime shell.',
      startupBudgetLabel: 'app-authenticated-shell',
      nextAction: 'Lazy-load secondary authenticated concerns.',
    },
  ],
};

const bundleBudgetConfig = {
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
    {
      label: 'pdfjs-worker',
      pattern: '^pdf\\.worker-.*\\.mjs$',
      maxBytes: 2_500_000,
    },
  ],
};

describe('runtimeAssetMarginReportSupport', () => {
  it('reports owners, load reasons, usage and near-limit posture for tracked runtime assets', () => {
    const report = buildRuntimeAssetMarginReport({
      ledgerConfig,
      bundleBudgetConfig,
      assets: [
        { file: 'dist/assets/vendor-heic2any-ClJ2fQYX.js', sizeBytes: 1_350_000 },
        { file: 'dist/assets/vendor-pdfjs-C4G2Lk1-.js', sizeBytes: 400_000 },
        { file: 'dist/assets/vendor-pdf-lib-BrVFzLGn.js', sizeBytes: 300_000 },
        { file: 'dist/assets/pdf.worker-2htIQpfR.mjs', sizeBytes: 2_350_000 },
        { file: 'dist/assets/app-authenticated-shell-B_IbeW9R.js', sizeBytes: 550_000 },
      ],
      gitSha: 'abc123',
    });

    expect(report.status).toBe('near-limit');
    expect(report.policyVersion).toBe('test-policy');
    expect(report.trackedSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'vendor-heic2any',
          owner: 'prescriptions/runtime',
          loadReason: 'Only high-efficiency prescription photos require conversion.',
          budgetUtilizationPct: 93.1,
          status: 'near-limit',
          nextAction: expect.stringContaining('Keep behind loadHeicConverter'),
        }),
        expect.objectContaining({
          id: 'app-authenticated-shell',
          budgetSource: 'startupChunkBudget',
          budgetUtilizationPct: 91.7,
          status: 'near-limit',
        }),
        expect.objectContaining({
          id: 'pdfjs-worker',
          owner: 'clinical-documents/PDF runtime',
          budgetUtilizationPct: 94,
          status: 'near-limit',
        }),
      ])
    );
    expect(report.topAssets[0]).toMatchObject({
      file: 'dist/assets/pdf.worker-2htIQpfR.mjs',
      owner: 'clinical-documents/PDF runtime',
      status: 'near-limit',
    });
    expect(report.topAssets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'dist/assets/vendor-heic2any-ClJ2fQYX.js',
          owner: 'prescriptions/runtime',
          status: 'near-limit',
        }),
      ])
    );
  });

  it('keeps over-budget runtime assets blocking while under-budget warning-band assets remain near-limit', () => {
    const report = buildRuntimeAssetMarginReport({
      ledgerConfig,
      bundleBudgetConfig,
      assets: [
        { file: 'dist/assets/vendor-heic2any-ClJ2fQYX.js', sizeBytes: 1_350_000 },
        { file: 'dist/assets/vendor-pdfjs-C4G2Lk1-.js', sizeBytes: 540_000 },
        { file: 'dist/assets/vendor-pdf-lib-BrVFzLGn.js', sizeBytes: 300_000 },
        { file: 'dist/assets/pdf.worker-2htIQpfR.mjs', sizeBytes: 2_350_000 },
        { file: 'dist/assets/app-authenticated-shell-B_IbeW9R.js', sizeBytes: 500_000 },
      ],
    });

    expect(report.status).toBe('blocking');
    expect(report.trackedSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'vendor-heic2any',
          status: 'near-limit',
        }),
        expect.objectContaining({
          id: 'vendor-pdfjs',
          status: 'blocking',
          nextAction: expect.stringContaining('Intervene before merge'),
        }),
      ])
    );
  });

  it('reports missing tracked surfaces with the directly configured budget', () => {
    const report = buildRuntimeAssetMarginReport({
      ledgerConfig,
      bundleBudgetConfig,
      assets: [
        { file: 'dist/assets/vendor-heic2any-ClJ2fQYX.js', sizeBytes: 1_350_000 },
        { file: 'dist/assets/vendor-pdfjs-C4G2Lk1-.js', sizeBytes: 400_000 },
        { file: 'dist/assets/pdf.worker-2htIQpfR.mjs', sizeBytes: 2_350_000 },
        { file: 'dist/assets/app-authenticated-shell-B_IbeW9R.js', sizeBytes: 550_000 },
      ],
    });

    expect(report.status).toBe('blocking');
    expect(report.trackedSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'vendor-pdf-lib',
          file: null,
          sizeBytes: 0,
          maxBytes: 430_000,
          budgetLabel: 'vendor-pdf-lib',
          budgetSource: 'chunkPatternBudget',
          budgetUtilizationPct: null,
          status: 'missing',
          nextAction: expect.stringContaining('Intervene before merge'),
        }),
      ])
    );
  });

  it('escapes pipe characters in generated markdown table cells', () => {
    const report = buildRuntimeAssetMarginReport({
      ledgerConfig: {
        policyVersion: 'test-policy',
        surfaces: [
          {
            id: 'vendor-pdfjs',
            owner: 'clinical-documents | PDF runtime',
            workflow: 'PDF text/import runtime',
            loadReason: 'Keep behind loadPdfJsTextRuntime | loadPdfLibGenerationRuntime',
            chunkBudgetPattern: '^vendor-pdfjs-.*\\.js$',
            nextAction: 'Observe | split only with evidence.',
          },
        ],
      },
      bundleBudgetConfig,
      assets: [{ file: 'dist/assets/vendor-pdfjs-C4G2Lk1-.js', sizeBytes: 400_000 }],
    });

    const markdown = formatRuntimeAssetMarginMarkdown(report);

    expect(markdown).toContain('clinical-documents \\| PDF runtime');
    expect(markdown).toContain('loadPdfJsTextRuntime \\| loadPdfLibGenerationRuntime');
    expect(markdown).toContain('Observe \\| split only with evidence.');
  });
});
