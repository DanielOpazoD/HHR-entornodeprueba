// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildAnalysisDataResult,
  mergeBilirrubinas,
} from '@/features/laboratory/controllers/labAnalysisResultController';
import type { ProcessedFindings } from '@/features/laboratory/controllers/labAnalyticsContracts';

describe('labAnalysisResultController', () => {
  it('merges bilirubin components into a single comparison row', () => {
    const comparison = {};

    mergeBilirrubinas(comparison, {
      '06/04/2026 10:00': {
        total: '1.2',
        directa: '0.3',
        indirecta: '0.9',
      },
    });

    expect(comparison).toEqual({
      'Bilirrubinas (T/D/I)': {
        '06/04/2026 10:00': expect.objectContaining({
          result: '1.2 / 0.3 / 0.9',
          unit: 'mg/dL',
        }),
      },
    });
  });

  it('sorts comparison keys, dates and microbiology entries into the final analysis payload', () => {
    const processed: ProcessedFindings = {
      comparison: {
        Creatinina: {
          '06/04/2026 10:00': {
            section: 'RENAL',
            analysis: 'Creatinina',
            result: '1.1',
            unit: 'mg/dL',
            refValue: '0.6-1.2',
          },
        },
        Hemoglobina: {
          '06/04/2026 10:00': {
            section: 'HEMOGRAMA',
            analysis: 'Hemoglobina',
            result: '13.5',
            unit: 'g/dL',
            refValue: '12-16',
          },
        },
      },
      trendMap: {
        Hemoglobina: [
          {
            date: '06/04/2026 10:00',
            isoDate: '2026-04-06',
            value: 13.5,
            unit: 'g/dL',
            refMin: 12,
            refMax: 16,
          },
          {
            date: '05/04/2026 10:00',
            isoDate: '2026-04-05',
            value: 13.1,
            unit: 'g/dL',
            refMin: 12,
            refMax: 16,
          },
        ],
      },
      columnKeys: ['06/04/2026 10:00', '05/04/2026 10:00'],
      bilirubinByCol: {},
      microbiologyEntries: [
        {
          category: 'pcr_8_virus',
          date: '05/04/2026 10:00',
          examLabel: 'PCR 8 virus',
          findings: [],
          hasAlertFinding: false,
          sourceExam: {
            id: '2',
            link: 'http://example.com/2',
            date: '05/04/2026',
            time: '10:00:00',
            patientName: 'TEST',
            origin: 'HOSP',
            exams: ['PCR PANEL RESPIRATORIO #2'],
          },
        },
        {
          category: 'otros_cultivos',
          date: '06/04/2026 10:00',
          examLabel: 'Otros cultivos',
          findings: [],
          hasAlertFinding: false,
          sourceExam: {
            id: '1',
            link: 'http://example.com/1',
            date: '06/04/2026',
            time: '10:00:00',
            patientName: 'TEST',
            origin: 'HOSP',
            exams: ['CULTIVO CORRIENTE 1'],
          },
        },
      ],
    };

    const result = buildAnalysisDataResult(processed);

    expect(Object.keys(result.comparison)).toEqual(['Hemoglobina', 'Creatinina']);
    expect(result.examDates).toEqual(['05/04/2026 10:00', '06/04/2026 10:00']);
    expect(result.microbiologyEntries.map(entry => entry.examLabel)).toEqual([
      'Otros cultivos',
      'PCR 8 virus',
    ]);
    expect(result.trendGroups).toHaveLength(1);
    expect(result.trendGroups[0].variables.Hemoglobina.map(point => point.isoDate)).toEqual([
      '2026-04-05',
      '2026-04-06',
    ]);
  });
});
