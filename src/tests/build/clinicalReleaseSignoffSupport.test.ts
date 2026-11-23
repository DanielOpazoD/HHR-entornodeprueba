// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildClinicalReleaseSignoffReport,
  collectClinicalReleaseSignoffIssues,
  formatClinicalReleaseSignoffMarkdown,
} from '../../../scripts/clinicalReleaseSignoffSupport.mjs';
import {
  buildClinicalReleaseValidationReport,
  formatClinicalReleaseValidationMarkdown,
} from '../../../scripts/clinicalReleaseValidationSupport.mjs';

const scenarioIds = ['census_reload_remote_reconcile', 'clinical_documents_pdf_print'];

describe('clinical release signoff support', () => {
  it('rejects missing scenario signoff entries', () => {
    const issues = collectClinicalReleaseSignoffIssues({
      scenarioIds,
      signoffs: [{ scenarioId: 'census_reload_remote_reconcile', status: 'passed' }],
      requirePassed: false,
    });

    expect(issues).toContain('Missing signoff entry for scenario clinical_documents_pdf_print.');
  });

  it('rejects passed signoffs without reviewer, timestamp, or evidence', () => {
    const issues = collectClinicalReleaseSignoffIssues({
      scenarioIds: ['census_reload_remote_reconcile'],
      signoffs: [{ scenarioId: 'census_reload_remote_reconcile', status: 'passed' }],
      requirePassed: true,
    });

    expect(issues).toContain('census_reload_remote_reconcile is missing validatedBy.');
    expect(issues).toContain('census_reload_remote_reconcile is missing validatedAt.');
    expect(issues).toContain('census_reload_remote_reconcile is missing validation evidence.');
  });

  it('accepts a fully evidenced passed signoff', () => {
    const issues = collectClinicalReleaseSignoffIssues({
      scenarioIds: ['census_reload_remote_reconcile'],
      signoffs: [
        {
          scenarioId: 'census_reload_remote_reconcile',
          status: 'passed',
          validatedBy: 'Clinico responsable',
          validatedAt: '2026-05-16T17:00:00.000Z',
          evidence: [{ type: 'manual_walkthrough', reference: 'docs/release/session.md' }],
        },
      ],
      requirePassed: true,
    });

    expect(issues).toEqual([]);
  });

  it('preserves the historical record without approving the current candidate', () => {
    const report = buildClinicalReleaseSignoffReport(process.cwd(), { requirePassed: true });

    expect(report.overall).toBe('ok');
    expect(report.approvalScope).toBe('historical_record');
    expect(report.currentCandidateApproved).toBe(false);
    const markdown = formatClinicalReleaseSignoffMarkdown(report);
    expect(markdown).toContain('Current candidate approval: not verified');
    expect(markdown).toContain('Record completeness: ok');
    expect(markdown).toContain('Recorded release candidate: codex/release-readiness-blocks');
    expect(markdown).not.toContain('Overall: ok');
    expect(report.counts.scenarioCount).toBeGreaterThanOrEqual(6);
    expect(report.counts.pendingScenarioCount).toBe(0);
    expect(report.issues).toEqual([]);
    expect(report.signoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scenarioId: 'census_reload_remote_reconcile',
          status: 'passed',
          validatedBy: 'Dr. Nombre Apellido / Daniel / Equipo clínico HHR',
        }),
      ])
    );
  });

  it('maps every manual clinical scenario to release matrix ownership and three closure gates', () => {
    type ClinicalReleaseValidationScenario = {
      id: string;
      matrixAreas: string[];
      automatedRegression: string[];
      manualValidation: string[];
      closureGates: string[];
    };

    const report = buildClinicalReleaseValidationReport(process.cwd());
    const markdown = formatClinicalReleaseValidationMarkdown(report);
    const scenarios = report.scenarios as ClinicalReleaseValidationScenario[];

    expect(report.overall).toBe('ok');
    expect(report.runbook).toMatchObject({
      file: 'docs/runbooks/deployment-checklist.md',
      status: 'ok',
    });
    expect(report.counts.scenarioCount).toBeGreaterThanOrEqual(5);
    expect(report.counts.highRiskScenarioCount).toBeGreaterThanOrEqual(2);
    expect(markdown).toContain('# Clinical Release Validation');
    expect(markdown).toContain('codigo_corregido');
    expect(markdown).toContain('regresion_automatizada');
    expect(markdown).toContain('flujo_clinico_validado');
    expect(markdown).toContain('test:e2e:clinical-stability');
    const backupRestoreExport = scenarios.find(scenario => scenario.id === 'backup_restore_export');
    expect(backupRestoreExport?.automatedRegression).toContain('test:e2e:clinical-stability:ci');

    for (const scenario of scenarios) {
      expect(
        scenario.matrixAreas.length,
        `${scenario.id} must map to matrix ownership`
      ).toBeGreaterThan(0);
      expect(
        scenario.automatedRegression.length,
        `${scenario.id} must name regression evidence`
      ).toBeGreaterThan(0);
      expect(
        scenario.manualValidation.length,
        `${scenario.id} must name manual validation`
      ).toBeGreaterThan(0);
      expect(scenario.closureGates).toEqual([
        'codigo_corregido',
        'regresion_automatizada',
        'flujo_clinico_validado',
      ]);
    }
  });
});
