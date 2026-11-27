// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_RETIREMENT_DEBT_GENERATED_AT,
  buildLegacyRetirementDebtReport,
  collectObservedLegacyConsumers,
  formatLegacyRetirementDebtMarkdown,
} from '../../../scripts/check-legacy-retirement-debt.mjs';

const baseConfig = {
  policyVersion: '2026-06-v1',
  maxOpenSurfaces: 4,
  surfaces: [
    {
      id: 'role-aliases',
      label: 'Role aliases',
      owner: 'auth/security',
      phase: 'retired',
      guardrails: ['src/tests/security/legacyRoleAliasStatic.test.ts'],
      evidenceReports: ['reports/legacy-retirement-debt.md'],
      retirementCriteria: 'Two releases without viewer_census in claims or config roles.',
      nextAction: 'Retired: keep legacyRoleAliasStatic.test.ts enforcing zero entries.',
    },
  ],
};

describe('legacyRetirementDebtSupport', () => {
  it('builds a deterministic report with retired surfaces and release posture', () => {
    const report = buildLegacyRetirementDebtReport({
      config: baseConfig,
    });

    expect(report.generatedAt).toBe(LEGACY_RETIREMENT_DEBT_GENERATED_AT);
    expect(report.status).toBe('ok');
    expect(report.openSurfaceCount).toBe(0);
    expect(report.maxOpenSurfaces).toBe(4);
    expect(report.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'role-aliases',
          phase: 'retired',
          status: 'ok',
          signal: 'documented',
        }),
      ])
    );
  });

  it('reports ok and zero open surfaces when retired role-aliases has maxOpenSurfaces 0', () => {
    const report = buildLegacyRetirementDebtReport({
      config: {
        ...baseConfig,
        maxOpenSurfaces: 0,
      },
    });

    expect(report.status).toBe('ok');
    expect(report.openSurfaceCount).toBe(0);
    expect(report.surfaces[0]).toEqual(
      expect.objectContaining({
        id: 'role-aliases',
        phase: 'retired',
        status: 'ok',
        signal: 'documented',
      })
    );
  });

  it('degrades consumer-budget surfaces when observed consumers exceed the approved list', () => {
    const report = buildLegacyRetirementDebtReport({
      config: {
        policyVersion: '2026-06-v1',
        maxOpenSurfaces: 1,
        surfaces: [
          {
            id: 'legacy-clinical-document-hydration',
            label: 'Legacy clinical document hydration',
            owner: 'clinical-documents',
            phase: 'restrict',
            maxAuthorizedConsumers: 3,
            approvedConsumers: [
              'src/application/clinical-documents/clinicalDocumentEditorUseCases.ts',
              'src/services/repositories/ClinicalDocumentRepository.ts',
            ],
          },
        ],
      },
      observedConsumersBySurface: {
        'legacy-clinical-document-hydration': [
          'src/application/clinical-documents/clinicalDocumentEditorUseCases.ts',
          'src/services/repositories/ClinicalDocumentRepository.ts',
          'src/features/clinical-documents/hooks/newLegacyHydrationConsumer.ts',
        ],
      },
    });

    expect(report.status).toBe('degraded');
    expect(report.surfaces[0]).toEqual(
      expect.objectContaining({
        status: 'degraded',
        signal: 'consumers=3/3, unapproved=1',
      })
    );
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.stringContaining('newLegacyHydrationConsumer.ts')])
    );
  });

  it('locks retired consumer-budget surfaces at zero consumers and degrades if any marker returns', () => {
    const retiredConfig = {
      policyVersion: '2026-06-v1',
      maxOpenSurfaces: 0,
      surfaces: [
        {
          id: 'legacy-clinical-document-hydration',
          label: 'Legacy clinical document hydration',
          owner: 'clinical-documents',
          phase: 'retired',
          maxAuthorizedConsumers: 0,
          approvedConsumers: [],
        },
      ],
    };

    const okReport = buildLegacyRetirementDebtReport({
      config: retiredConfig,
      observedConsumersBySurface: {
        'legacy-clinical-document-hydration': [],
      },
    });
    expect(okReport.status).toBe('ok');
    expect(okReport.openSurfaceCount).toBe(0);
    expect(okReport.surfaces[0]).toEqual(
      expect.objectContaining({
        status: 'ok',
        signal: 'consumers=0/0, unapproved=0',
      })
    );

    const regressedReport = buildLegacyRetirementDebtReport({
      config: retiredConfig,
      observedConsumersBySurface: {
        'legacy-clinical-document-hydration': ['src/domain/clinical-documents/compatibility.ts'],
      },
    });
    expect(regressedReport.status).toBe('degraded');
    expect(regressedReport.surfaces[0]).toEqual(
      expect.objectContaining({
        status: 'degraded',
        signal: 'consumers=1/0, unapproved=1',
      })
    );
  });

  it('detects generic surfaces and reports when open surfaces exceed the aggregate budget', () => {
    const report = buildLegacyRetirementDebtReport({
      config: {
        policyVersion: '2026-06-v1',
        maxOpenSurfaces: 1,
        surfaces: [
          {
            id: 'documented-legacy-surface',
            label: 'Documented legacy surface',
            owner: 'platform',
            phase: 'observe',
          },
          {
            id: 'second-documented-legacy-surface',
            label: 'Second documented legacy surface',
            owner: 'platform',
            phase: 'restrict',
          },
        ],
      },
    });

    expect(report.status).toBe('degraded');
    expect(report.surfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'documented-legacy-surface',
          signal: 'documented',
          status: 'ok',
        }),
      ])
    );
    expect(report.issues).toEqual(
      expect.arrayContaining(['open legacy surfaces 2 exceed budget 1'])
    );
  });

  it('collects observed legacy consumers from configured markers', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-retirement-consumers-'));
    fs.mkdirSync(path.join(root, 'src/features/clinical-documents/controllers'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(root, 'src/tests/features/clinical-documents'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, 'src/features/clinical-documents/controllers/current.ts'),
      'export const useLegacy = () => hydrateLegacyClinicalDocument({} as never);\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(root, 'src/tests/features/clinical-documents/current.test.ts'),
      'hydrateLegacyClinicalDocument({} as never);\n',
      'utf8'
    );

    const config = {
      policyVersion: '2026-06-v1',
      surfaces: [
        {
          id: 'legacy-clinical-document-hydration',
          consumerDetection: {
            sourceRoots: ['src'],
            markers: ['hydrateLegacyClinicalDocument'],
            includePathPatterns: ['^src/features/clinical-documents/'],
            excludePathPatterns: ['\\.test\\.'],
          },
        },
      ],
    };

    expect(collectObservedLegacyConsumers({ config, root })).toEqual({
      'legacy-clinical-document-hydration': [
        'src/features/clinical-documents/controllers/current.ts',
      ],
    });

    const report = buildLegacyRetirementDebtReport({
      config: {
        policyVersion: '2026-06-v1',
        maxOpenSurfaces: 1,
        surfaces: [
          {
            id: 'legacy-episode-hydration',
            label: 'Legacy episode hydration',
            owner: 'clinical-documents',
            phase: 'restrict',
            maxAuthorizedConsumers: 1,
            approvedConsumers: ['src/features/clinical-documents/controllers/current.ts'],
          },
        ],
      },
      observedConsumersBySurface: {
        'legacy-episode-hydration': ['src/features/clinical-documents/controllers/current.ts'],
      },
    });

    expect(report.status).toBe('ok');
    expect(report.surfaces[0].signal).toBe('consumers=1/1, unapproved=0');
  });

  it('renders a concise markdown table for release evidence', () => {
    const report = buildLegacyRetirementDebtReport({
      config: baseConfig,
    });

    const markdown = formatLegacyRetirementDebtMarkdown(report);

    expect(markdown).toContain('# Legacy Retirement Debt Snapshot');
    expect(markdown).toContain('| Surface | Owner | Phase | Status | Signal | Next action |');
    expect(markdown).toContain('Role aliases');
  });

  it('documents the short legacy retirement priorities and closure signals in the plan', () => {
    const plan = fs.readFileSync(
      path.resolve(process.cwd(), 'docs/LEGACY_RETIREMENT_PLAN.md'),
      'utf8'
    );

    expect(plan).toContain('role aliases');
    expect(plan).toContain('legacy clinical document');
    expect(plan).toContain('legacy episode');
    expect(plan).toContain('Closure signals');
    expect(plan).toContain('Non-goals');
    expect(plan).toContain('0 legacy role aliases detected for 2 consecutive releases');
    expect(plan).toContain('0 legacy hydration leaks outside approved controllers');
  });
});
