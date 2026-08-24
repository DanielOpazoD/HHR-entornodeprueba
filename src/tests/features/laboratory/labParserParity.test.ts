// @vitest-environment node
import { describe, expect, it } from 'vitest';

import '../../../../extension/lab-result-parser.js';
import { parseLabMeasurement } from '@/features/laboratory/controllers/labNumericParser';
import {
  classifyLabSpecimen,
  isLabTrendSpecimenEligible,
} from '@/features/laboratory/controllers/labSpecimenController';
import type { LabResultRow } from '@/types/domain/labExamTypes';

interface ExtensionParserApi {
  isSystemicTrendEligible: (finding: LabResultRow) => boolean;
  normalizeAnalysisName: (value: string, section?: string) => string;
  parseMeasurement: (
    value: string,
    context: Pick<LabResultRow, 'unit' | 'refValue'>
  ) => { comparator: string; value: number } | null;
}

const extensionParser = (
  globalThis as typeof globalThis & { HhrLabResultParser: ExtensionParserApi }
).HhrLabResultParser;

describe('Syslab parser parity', () => {
  it.each([
    'CK',
    'CPK',
    'CK TOTAL',
    'Creatina Quinasa Total',
    'Creatina Fosfoquinasa',
    'Creatinfosfoquinasa',
  ])('normalizes the CK alias "%s" consistently in the extension', alias => {
    expect(extensionParser.normalizeAnalysisName(alias)).toBe('CK Total');
  });

  it.each([
    ['1.071', 'U/L', '40 - 129'],
    ['1.720', 'U/L |', '10 - 71'],
    ['7.280', 'x10^3/uL', '4,0 - 11,0'],
    ['4.500', '/uL', '4.000 - 11.000'],
    ['4.500', 'células/uL', '4.000 - 11.000'],
    ['4.500', '/mm3', '4.000 - 11.000'],
    ['0.125', 'U/L', '0.001 - 0.250'],
    ['<1,5', 'mg/dL', '< 2,0'],
  ])('keeps localized measurement rules aligned for %s', (rawValue, unit, refValue) => {
    const context = { unit, refValue };
    const native = parseLabMeasurement(rawValue, context);
    const extension = extensionParser.parseMeasurement(rawValue, context);

    expect(extension).toEqual(native && { comparator: native.comparator, value: native.value });
  });

  it.each([
    ['PERFIL HEPATICO', 'Glucosa', 'mg/dL', 'blood'],
    ['SEDIMENTO URINARIO', 'Leucocitos', 'x campo', 'urine'],
    ['GENERAL', 'Microalbuminuria', 'mg/L', 'urine'],
    ['LIQUIDO PLEURAL', 'Albumina', 'g/dL', 'other-fluid'],
    ['ANALISIS DE LIQUIDOS CORPORALES', 'Albumina', 'g/dL', 'other-fluid'],
    ['LCR', 'Glucosa', 'mg/dL', 'other-fluid'],
    ['GENERAL', 'ClCr', 'mL/min', 'unknown'],
    ['GENERAL', 'Proteina C Reactiva', 'mg/L', 'unknown'],
  ] as const)('keeps specimen rules aligned for %s / %s', (section, analysis, unit, expected) => {
    const finding: LabResultRow = { section, analysis, unit, result: '1', refValue: '' };

    expect(classifyLabSpecimen(finding)).toBe(expected);
    expect(extensionParser.isSystemicTrendEligible(finding)).toBe(
      isLabTrendSpecimenEligible(finding)
    );
  });
});
