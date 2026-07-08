/**
 * @fileoverview Tests for the lab summary controller.
 * Validates clinical abbreviation mapping, value formatting, and summary generation.
 */

import { describe, it, expect } from 'vitest';
import { buildLabSummaryText } from '@/features/laboratory/controllers/labSummaryController';
import type { LabResultRow } from '@/types/domain/labExamTypes';

const makeFinding = (analysis: string, result: string, unit = '', refValue = ''): LabResultRow => ({
  section: 'TEST',
  analysis,
  result,
  unit,
  refValue,
});

describe('buildLabSummaryText', () => {
  it('generates summary with clinical abbreviations', () => {
    const findings: LabResultRow[] = [
      makeFinding('Hemoglobina', '13,0', 'g/dL', '12,0 - 16,0'),
      makeFinding('Hematocrito', '40', 'o/o', '37,0 - 47,0'),
      makeFinding('Creatinina', '1,0', 'mg/dl', '0,52 - 1,04'),
    ];

    const result = buildLabSummaryText(findings, '08/04/2026', '14:00:00');

    expect(result).toContain('Laboratorio (08/04/2026 14:00)');
    expect(result).toContain('Hb 13,0');
    expect(result).toContain('HTO 40%');
    expect(result).toContain('Creat 1,0');
  });

  it('multiplies x10^3 values for RGB and Plaquetas', () => {
    const findings: LabResultRow[] = [
      makeFinding('Recuento Leucocitos', '7,5', 'x10^3/ul'),
      makeFinding('Recuento de Plaquetas', '192', 'x10^3/ul'),
    ];

    const result = buildLabSummaryText(findings, '08/04/2026', '10:00:00');

    expect(result).toContain('RGB 7.500');
    expect(result).toContain('Plaq 192.000');
  });

  it('shows unit only for variable-unit exams', () => {
    const findings: LabResultRow[] = [
      makeFinding('Sodio', '140', 'mmol/L'),
      makeFinding('Proteina C Reactiva', '57', 'mg/L'),
      makeFinding('TSH', '3,5', 'uUI/mL'),
    ];

    const result = buildLabSummaryText(findings, '08/04/2026', '10:00:00');

    // Na should NOT have unit
    expect(result).toMatch(/Na 140(?!\s*mmol)/);
    // PCR should have unit
    expect(result).toContain('PCR 57 mg/L');
    // TSH should have unit
    expect(result).toContain('TSH 3,5 uUI/mL');
  });

  it('follows clinical priority order', () => {
    const findings: LabResultRow[] = [
      makeFinding('ASAT/GOT', '34', 'U/L'),
      makeFinding('Hemoglobina', '13', 'g/dL'),
      makeFinding('Sodio', '140', 'mmol/L'),
    ];

    const result = buildLabSummaryText(findings, '08/04/2026', '10:00:00');

    const hbPos = result.indexOf('Hb ');
    const naPos = result.indexOf('Na ');
    const gotPos = result.indexOf('GOT ');

    expect(hbPos).toBeLessThan(naPos);
    expect(naPos).toBeLessThan(gotPos);
  });

  it('skips qualitative results', () => {
    const findings: LabResultRow[] = [
      makeFinding('Hemoglobina', '13', 'g/dL'),
      {
        section: 'PCR PANEL',
        analysis: 'Influenza A',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
    ];

    const result = buildLabSummaryText(findings, '08/04/2026', '10:00:00');

    expect(result).toContain('Hb 13');
    expect(result).not.toContain('Influenza');
    expect(result).not.toContain('NEGATIVO');
  });

  it('falls back to explicit result text when no findings match abbreviations', () => {
    const findings: LabResultRow[] = [makeFinding('Unknown Variable', '42', 'units')];

    const result = buildLabSummaryText(findings, '08/04/2026', '10:00:00');
    expect(result).toBe('Laboratorio (08/04/2026 10:00): Unknown Variable 42 units');
  });

  it('falls back to qualitative-only exam text instead of returning empty', () => {
    const findings: LabResultRow[] = [
      {
        section: 'MICROBIOLOGIA',
        analysis: 'Cultivo corriente',
        result: 'SIN DESARROLLO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
    ];

    const result = buildLabSummaryText(findings, '08/04/2026', '10:00:00');
    expect(result).toBe('Laboratorio (08/04/2026 10:00): Cultivo corriente SIN DESARROLLO');
  });

  it('truncates time to HH:MM', () => {
    const findings: LabResultRow[] = [makeFinding('Hemoglobina', '13', 'g/dL')];
    const result = buildLabSummaryText(findings, '08/04/2026', '14:30:45');
    expect(result).toContain('14:30)');
    expect(result).not.toContain('14:30:45');
  });

  it('normalizes analysis names before matching', () => {
    const findings: LabResultRow[] = [makeFinding('HCO3 ACTUAL', '22', 'mEq/L')];

    const result = buildLabSummaryText(findings, '08/04/2026', '10:00:00');
    expect(result).toContain('HCO3 22');
  });

  it('adds % suffix for Segmentados', () => {
    const findings: LabResultRow[] = [makeFinding('Segmentados', '70', 'o/o')];

    const result = buildLabSummaryText(findings, '08/04/2026', '10:00:00');
    expect(result).toContain('PMN 70%');
  });

  it('includes Bilirrubina Total and Directa separately', () => {
    const findings: LabResultRow[] = [
      makeFinding('Bilirrubina Total', '2,0', 'mg/dL'),
      makeFinding('Bilirrubina Directa', '1,0', 'mg/dL'),
    ];

    const result = buildLabSummaryText(findings, '08/04/2026', '10:00:00');
    expect(result).toContain('BT 2,0');
    expect(result).toContain('BD 1,0');
  });
});
