import { describe, expect, it } from 'vitest';

import { buildAnalysisData } from '@/features/laboratory/controllers/labAnalyticsController';
import { parseLabMeasurement } from '@/features/laboratory/controllers/labNumericParser';
import {
  classifyLabSpecimen,
  isLabComparisonEligible,
  isLabTrendSpecimenEligible,
} from '@/features/laboratory/controllers/labSpecimenController';
import { syslabGoldenSpecimenCollisionScenario } from './fixtures/syslabGoldenLabFixtures';

const findTrend = (name: string) => {
  const analysis = buildAnalysisData(
    syslabGoldenSpecimenCollisionScenario.details,
    syslabGoldenSpecimenCollisionScenario.exams
  );
  return analysis.trendGroups
    .flatMap(group => Object.entries(group.variables))
    .find(([key]) => key === name)?.[1];
};

describe('Syslab clinical parsing regression', () => {
  it('interprets dotted U/L values as thousands without changing scaled cell counts', () => {
    expect(parseLabMeasurement('1.071', { unit: 'U/L', refValue: '40 - 129' })?.value).toBe(1071);
    expect(parseLabMeasurement('1.720', { unit: 'U/L', refValue: '10 - 71' })?.value).toBe(1720);
    expect(parseLabMeasurement('1.071', { unit: 'U/L |', refValue: '38 - 126' })?.value).toBe(1071);
    expect(parseLabMeasurement('1.720', { unit: 'U/L |', refValue: '15 - 73' })?.value).toBe(1720);
    expect(parseLabMeasurement('7.280', { unit: 'x10^3/uL', refValue: '4,0 - 11,0' })?.value).toBe(
      7.28
    );
    expect(parseLabMeasurement('+1.720', { unit: 'U/L |', refValue: '15 - 73' })?.value).toBe(1720);
    expect(
      parseLabMeasurement('-1.071', { unit: 'U/L |', refValue: '-2.000 - 2.000' })?.value
    ).toBe(-1071);
    expect(parseLabMeasurement('0.125', { unit: 'U/L', refValue: '0.001 - 0.250' })?.value).toBe(
      0.125
    );
  });

  it('classifies albuminuria and urinary sediment from their PDF section', () => {
    const urineFindings = syslabGoldenSpecimenCollisionScenario.details[2].findings;
    expect(urineFindings.map(classifyLabSpecimen)).toEqual(['urine', 'urine', 'urine']);
  });

  it('keeps generic body fluids out of systemic comparisons and trends', () => {
    const pericardialAlbumin = {
      section: 'LIQUIDO PERICARDICO',
      analysis: 'Albumina',
      result: '2,1',
      unit: 'g/dL',
      refValue: '',
    };
    const synovialLeukocytes = {
      ...pericardialAlbumin,
      section: 'LIQUIDO SINOVIAL',
      analysis: 'Recuento Leucocitos',
      result: '1200',
      unit: '/uL',
    };

    for (const finding of [pericardialAlbumin, synovialLeukocytes]) {
      expect(classifyLabSpecimen(finding)).toBe('other-fluid');
      expect(isLabComparisonEligible(finding)).toBe(false);
      expect(isLabTrendSpecimenEligible(finding)).toBe(false);
    }
  });

  it('graphs the hepatic thousands values exactly', () => {
    expect(findTrend('GGT')?.map(point => point.value)).toEqual([1720, 946]);
    expect(findTrend('Fosfatasa Alcalina')?.map(point => point.value)).toEqual([1071, 682]);
  });

  it('does not mix urine albumin, leukocytes or segmentados into systemic curves', () => {
    expect(findTrend('Albumina')?.map(point => point.value)).toEqual([2, 1.9]);
    expect(findTrend('Recuento Leucocitos')?.map(point => point.value)).toEqual([3.1, 3.2]);
    expect(findTrend('Segmentados')?.map(point => point.value)).toEqual([72, 42.4]);
  });

  it('retains the source value and PDF section in every graph point', () => {
    expect(findTrend('Fosfatasa Alcalina')?.[0]).toEqual(
      expect.objectContaining({ rawValue: '1.071', sourceSection: 'PERFIL HEPATICO' })
    );
  });
});
