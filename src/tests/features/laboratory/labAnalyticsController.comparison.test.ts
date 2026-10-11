import './labAnalyticsController.testSupport';

import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/features/laboratory/controllers/labAnalyticsController';
import { groupVariablesByScale } from '@/features/laboratory/components/LabTrendChartHelpers';
import { buildDetail, buildExam, buildFinding } from './labAnalyticsController.testSupport';

describe('labAnalyticsController comparison output', () => {
  const examWithTime = buildExam({
    id: '100',
    link: 'http://example.com/100',
    date: '06/04/2026',
    time: '10:00:00',
  });

  const examWithTime2 = buildExam({
    id: '200',
    link: 'http://example.com/200',
    date: '01/03/2026',
    time: '09:00:00',
  });

  it('merges bilirrubina total and directa into one combined row', () => {
    const result = buildAnalysisData(
      [
        buildDetail({
          url: 'http://example.com/100',
          findings: [
            buildFinding({
              section: 'HEPATICO',
              analysis: 'Bilirrubina Total',
              result: '1.2',
              unit: 'mg/dL',
              refValue: '',
            }),
            buildFinding({
              section: 'HEPATICO',
              analysis: 'Bilirrubina Directa',
              result: '0.3',
              unit: 'mg/dL',
              refValue: '',
            }),
          ],
        }),
      ],
      [examWithTime]
    );

    expect(result.comparison['Bilirrubinas (T/D/I)']).toBeDefined();
    const column = Object.values(result.comparison['Bilirrubinas (T/D/I)'])[0];
    expect(column.result).toContain('1.2');
    expect(column.result).toContain('0.3');
  });

  it('excludes Baciliformes from comparison but keeps Hemoglobina', () => {
    const result = buildAnalysisData(
      [
        buildDetail({
          url: 'http://example.com/100',
          findings: [
            buildFinding({
              section: 'HEMOGRAMA',
              analysis: 'Hemoglobina',
              result: '14',
              unit: 'g/dL',
              refValue: '12-16',
            }),
            buildFinding({
              section: 'HEMOGRAMA',
              analysis: 'Baciliformes',
              result: '0',
              unit: '%',
              refValue: '0-2',
            }),
          ],
        }),
      ],
      [examWithTime]
    );

    expect(result.comparison.Hemoglobina).toBeDefined();
    expect(result.comparison.Baciliformes).toBeUndefined();
  });

  it.each(['10:00:59', '10:00:01'])('preserves distinct orders in the same minute: %s', time => {
    const first = buildExam({ id: '200', link: 'http://example.com/200', time: '10:00:01' });
    const second = buildExam({ id: '100', link: 'http://example.com/100', time });
    const result = buildAnalysisData(
      [
        buildDetail({ url: 'http://example.com/100', findings: [buildFinding({ result: '9' })] }),
        buildDetail({ url: 'http://example.com/200', findings: [buildFinding({ result: '13' })] }),
        buildDetail({ url: 'http://example.com/200', findings: [buildFinding({ result: '13' })] }),
      ],
      [first, second]
    );
    expect(Object.values(result.comparison.Hemoglobina).map(row => row.result)).toEqual([
      '9',
      '13',
    ]);
    expect(result.examDates).toHaveLength(2);
    expect(result.examDates).toContain(`06/04/2026 ${time} (#100)`);
    expect(result.examDates).toContain('06/04/2026 10:00:01 (#200)');
    const trend = result.trendGroups.find(group => group.variables.Hemoglobina)!.variables
      .Hemoglobina;
    expect(trend).toHaveLength(2);
    expect(new Set(trend.map(point => point.date)).size).toBe(2);
    if (time !== first.time) expect(result.examDates[0]).toBe('06/04/2026 10:00:01 (#200)');
  });

  it('splits the chart output when the same analyte changes unit between orders', () => {
    const result = buildAnalysisData(
      [
        buildDetail({
          url: 'http://example.com/100',
          findings: [buildFinding({ analysis: 'PCR', result: '1', unit: 'mg/dL' })],
        }),
        buildDetail({
          url: 'http://example.com/200',
          findings: [buildFinding({ analysis: 'PCR', result: '10', unit: 'mg/L' })],
        }),
      ],
      [examWithTime, examWithTime2]
    );
    const groups = result.trendGroups.flatMap(group => groupVariablesByScale(group.variables));
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map(group => group.unit))).toEqual(new Set(['mg/dL', 'mg/L']));
    expect(
      groups.flatMap(group => Object.values(group.vars).flat()).map(point => point.value)
    ).toEqual([10, 1]);
  });

  it('orders Hemoglobina before Creatinina before ASAT/GOT', () => {
    const result = buildAnalysisData(
      [
        buildDetail({
          url: 'http://example.com/100',
          findings: [
            buildFinding({
              section: 'RENAL',
              analysis: 'ASAT/GOT',
              result: '25',
              unit: 'U/L',
              refValue: '10-40',
            }),
            buildFinding({
              section: 'RENAL',
              analysis: 'Creatinina',
              result: '0.9',
              unit: 'mg/dL',
              refValue: '0.6-1.2',
            }),
            buildFinding({
              section: 'HEMOGRAMA',
              analysis: 'Hemoglobina',
              result: '14',
              unit: 'g/dL',
              refValue: '12-16',
            }),
          ],
        }),
      ],
      [examWithTime]
    );

    const keys = Object.keys(result.comparison);
    expect(keys.indexOf('Hemoglobina')).toBeLessThan(keys.indexOf('Creatinina'));
    expect(keys.indexOf('Creatinina')).toBeLessThan(keys.indexOf('ASAT/GOT'));
  });

  it('deduplicates repeated variable and date pairs', () => {
    const result = buildAnalysisData(
      [
        buildDetail({
          url: 'http://example.com/100',
          findings: [
            buildFinding({
              section: 'HEMOGRAMA',
              analysis: 'Hemoglobina',
              result: '14',
              unit: 'g/dL',
              refValue: '12-16',
            }),
            buildFinding({
              section: 'HEMOGRAMA',
              analysis: 'Hemoglobina',
              result: '14',
              unit: 'g/dL',
              refValue: '12-16',
            }),
          ],
        }),
        buildDetail({
          url: 'http://example.com/200',
          findings: [
            buildFinding({
              section: 'HEMOGRAMA',
              analysis: 'Hemoglobina',
              result: '13',
              unit: 'g/dL',
              refValue: '12-16',
            }),
          ],
        }),
      ],
      [examWithTime, examWithTime2]
    );

    const hemoglobinGroup = result.trendGroups.find(group => group.variables.Hemoglobina);
    expect(hemoglobinGroup?.variables.Hemoglobina).toHaveLength(2);
  });

  it('normalizes hemoglobina glicosilada to short metabolic row and trend', () => {
    const result = buildAnalysisData(
      [
        buildDetail({
          url: 'http://example.com/100',
          findings: [
            buildFinding({
              section: 'HEMOGLOBINA GLICOSILADA #2',
              analysis: 'Hemoglobina Glicosilada',
              result: '6,6',
              unit: 'o/o',
              refValue: '4,0 - 6,5',
            }),
          ],
        }),
        buildDetail({
          url: 'http://example.com/200',
          findings: [
            buildFinding({
              section: 'HEMOGLOBINA GLICOSILADA',
              analysis: 'Hemoglobina Glicosilada',
              result: '7,4',
              unit: 'o/o',
              refValue: '4,0 - 6,0',
            }),
          ],
        }),
      ],
      [examWithTime, examWithTime2]
    );

    expect(result.comparison['Hb glicosilada']).toBeDefined();
    expect(result.comparison['Hemoglobina Glicosilada']).toBeUndefined();
    const metabolicTrend = result.trendGroups.find(group => group.variables['Hb glicosilada']);
    expect(metabolicTrend?.variables['Hb glicosilada']).toHaveLength(2);
  });

  it('builds one CK Total chart from the CK aliases returned by Syslab', () => {
    const result = buildAnalysisData(
      [
        buildDetail({
          url: 'http://example.com/100',
          findings: [
            buildFinding({
              section: 'BIOQUIMICA',
              analysis: 'CK',
              result: '224',
              unit: 'U/L',
              refValue: '30-170',
            }),
          ],
        }),
        buildDetail({
          url: 'http://example.com/200',
          findings: [
            buildFinding({
              section: 'BIOQUIMICA',
              analysis: 'Creatina Quinasa Total',
              result: '181',
              unit: 'U/L',
              refValue: '30-170',
            }),
          ],
        }),
      ],
      [examWithTime, examWithTime2]
    );

    expect(result.comparison['CK Total']).toBeDefined();
    expect(result.comparison.CK).toBeUndefined();
    const muscleMarkers = result.trendGroups.find(group => group.label === 'Marcadores musculares');
    expect(muscleMarkers?.variables['CK Total'].map(point => point.value)).toEqual([181, 224]);
  });

  it('returns an empty structure when details are empty', () => {
    const result = buildAnalysisData([], []);
    expect(result.trendGroups).toEqual([]);
    expect(result.examDates).toEqual([]);
    expect(result.comparison).toEqual({});
  });
});
