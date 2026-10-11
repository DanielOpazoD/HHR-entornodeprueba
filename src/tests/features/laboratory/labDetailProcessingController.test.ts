import { describe, expect, it } from 'vitest';
import { processLabExamDetails } from '@/features/laboratory/controllers/labDetailProcessingController';
import type { SyslabExamDetail, SyslabExamItem } from '@/types/domain/labExamTypes';

describe('labDetailProcessingController', () => {
  it('deduplicates repeated column keys while preserving distinct exams', () => {
    const examList: SyslabExamItem[] = [
      {
        id: '100',
        link: 'http://example.com/100',
        date: '06/04/2026',
        time: '10:00:00',
        patientName: 'TEST',
        origin: 'HOSP',
        exams: ['HEMOGRAMA'],
      },
      {
        id: '200',
        link: 'http://example.com/200',
        date: '06/04/2026',
        time: '10:00:00',
        patientName: 'TEST',
        origin: 'HOSP',
        exams: ['HEMOGRAMA'],
      },
    ];

    const details: SyslabExamDetail[] = [
      {
        url: 'http://example.com/100',
        findings: [
          {
            section: 'HEMOGRAMA',
            analysis: 'Hemoglobina',
            result: '14',
            unit: 'g/dL',
            refValue: '12-16',
          },
        ],
      },
      {
        url: 'http://example.com/100',
        findings: [
          {
            section: 'HEMOGRAMA',
            analysis: 'Creatinina',
            result: '0.9',
            unit: 'mg/dL',
            refValue: '0.6-1.2',
          },
        ],
      },
      {
        url: 'http://example.com/200',
        findings: [
          {
            section: 'HEMOGRAMA',
            analysis: 'Hemoglobina',
            result: '13',
            unit: 'g/dL',
            refValue: '12-16',
          },
        ],
      },
    ];

    const processed = processLabExamDetails(details, examList);

    expect(processed.columnKeys).toEqual([
      '06/04/2026 10:00:00 (#100)',
      '06/04/2026 10:00:00 (#200)',
    ]);
    expect(processed.comparison.Hemoglobina).toBeDefined();
    expect(processed.comparison.Creatinina).toBeDefined();
  });
});
