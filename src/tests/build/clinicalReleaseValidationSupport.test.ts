import { describe, expect, it } from 'vitest';
import {
  buildClinicalReleaseValidationReport,
  formatClinicalReleaseValidationMarkdown,
} from '../../../scripts/clinicalReleaseValidationSupport.mjs';

type ClinicalReleaseValidationScenario = {
  id: string;
  matrixAreas: string[];
  automatedRegression: string[];
  manualValidation: string[];
  closureGates: string[];
};

describe('clinical release validation contract', () => {
  it('maps every manual clinical scenario to release matrix ownership and three closure gates', () => {
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
