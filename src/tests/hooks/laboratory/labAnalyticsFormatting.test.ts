// @vitest-environment node
import { describe, it, expect } from 'vitest';

import { buildAnalysisData } from '@/features/laboratory/controllers/labAnalyticsController';
import type { SyslabExamDetail, SyslabExamItem } from '@/types/domain/labExamTypes';
import type { LabTrendGroup } from '@/types/domain/labAnalyticsTypes';

const MOCK_EXAM: SyslabExamItem = {
  id: '43091284',
  link: 'http://10.4.69.90/syslab/detalleexamenes.php?id=43091284',
  date: '06/04/2026',
  time: '13:08:43',
  patientName: 'JUAN PÉREZ',
  origin: 'HOSPITALIZADOS',
  exams: ['HEMOGRAMA', 'GLICEMIA'],
};

const MOCK_EXAM_2: SyslabExamItem = {
  id: '43090001',
  link: 'http://10.4.69.90/syslab/detalleexamenes.php?id=43090001',
  date: '01/03/2026',
  time: '09:00:00',
  patientName: 'JUAN PÉREZ',
  origin: 'HOSPITALIZADOS',
  exams: ['HEMOGRAMA'],
};

describe('buildAnalysisData', () => {
  const examList: SyslabExamItem[] = [MOCK_EXAM, MOCK_EXAM_2];
  const details: SyslabExamDetail[] = [
    {
      url: MOCK_EXAM.link!,
      findings: [
        {
          section: 'HEMOGRAMA',
          analysis: 'HEMOGLOBINA',
          result: '14.5',
          unit: 'g/dL',
          refValue: '12.0-16.0',
        },
        {
          section: 'HEMOGRAMA',
          analysis: 'LEUCOCITOS',
          result: '7500',
          unit: 'uL',
          refValue: '4500-11000',
        },
      ],
    },
    {
      url: MOCK_EXAM_2.link!,
      findings: [
        {
          section: 'HEMOGRAMA',
          analysis: 'HEMOGLOBINA',
          result: '13.2',
          unit: 'g/dL',
          refValue: '12.0-16.0',
        },
      ],
    },
  ];

  it('creates trend groups for variables with 2+ points', () => {
    const result = buildAnalysisData(details, examList);
    const hbGroup = result.trendGroups.find((g: LabTrendGroup) =>
      Object.keys(g.variables).some(v => v === 'HEMOGLOBINA')
    );
    expect(hbGroup).toBeDefined();
    expect(hbGroup!.variables['HEMOGLOBINA']).toHaveLength(2);
  });

  it('sorts trend points chronologically', () => {
    const result = buildAnalysisData(details, examList);
    const hbGroup = result.trendGroups.find((g: LabTrendGroup) => g.variables['HEMOGLOBINA']);
    const hb = hbGroup!.variables['HEMOGLOBINA'];
    expect(hb[0].isoDate).toBe('2026-03-01');
    expect(hb[1].isoDate).toBe('2026-04-06');
  });

  it('builds comparison grid with date+time column keys', () => {
    const result = buildAnalysisData(details, examList);
    expect(result.comparison['HEMOGLOBINA']['06/04/2026 13:08'].result).toBe('14.5');
    expect(result.comparison['HEMOGLOBINA']['01/03/2026 09:00'].result).toBe('13.2');
  });

  it('includes sorted exam dates with time', () => {
    const result = buildAnalysisData(details, examList);
    expect(result.examDates).toEqual(['01/03/2026 09:00', '06/04/2026 13:08']);
  });

  it('includes reference range in trend points', () => {
    const result = buildAnalysisData(details, examList);
    const hbGroup = result.trendGroups.find((g: LabTrendGroup) => g.variables['HEMOGLOBINA']);
    expect(hbGroup!.variables['HEMOGLOBINA'][0].refMin).toBe(12);
    expect(hbGroup!.variables['HEMOGLOBINA'][0].refMax).toBe(16);
  });

  it('builds microbiology entries from qualitative culture-style findings', () => {
    const microExam: SyslabExamItem = {
      ...MOCK_EXAM,
      id: '999',
      date: '08/04/2026',
      time: '16:00:00',
      link: 'http://10.4.69.90/syslab/detalleexamenes.php?id=999',
      exams: ['CULTIVO CORRIENTE 1.', 'ANTIBIOGRAMA EXTENDIDO 1.', 'PCR PANEL RESPIRATORIO #2.'],
    };

    const result = buildAnalysisData(
      [
        ...details,
        {
          url: microExam.link!,
          findings: [
            {
              section: 'MICROBIOLOGIA',
              analysis: 'Cultivo',
              result: 'Desarrollo de E. coli',
              unit: '',
              refValue: '',
              qualitative: true,
            },
            {
              section: 'MICROBIOLOGIA',
              analysis: 'Ceftazidima',
              result: 'Susceptible',
              unit: '',
              refValue: '',
              qualitative: true,
            },
            {
              section: 'MICROBIOLOGIA',
              analysis: 'Rhinovirus',
              result: 'NEGATIVO',
              unit: '',
              refValue: '',
              qualitative: true,
            },
            {
              section: 'MICROBIOLOGIA',
              analysis: 'Influenza A',
              result: 'NEGATIVO',
              unit: '',
              refValue: '',
              qualitative: true,
            },
          ],
        },
      ],
      [...examList, microExam]
    );

    expect(result.microbiologyEntries).toHaveLength(2);
    expect(result.microbiologyEntries.map(entry => entry.examLabel)).toEqual(
      expect.arrayContaining(['Otros cultivos', 'PCR 8 virus'])
    );
    expect(
      result.microbiologyEntries.find(entry => entry.examLabel === 'Otros cultivos')?.findings
    ).toEqual([
      { analysis: 'Cultivo', result: 'Desarrollo de E. coli' },
      { analysis: 'Ceftazidima', result: 'Susceptible' },
    ]);
    expect(
      result.microbiologyEntries.find(entry => entry.examLabel === 'PCR 8 virus')?.findings
    ).toEqual([
      { analysis: 'Rhinovirus', result: 'NEGATIVO' },
      { analysis: 'Influenza A', result: 'NEGATIVO' },
    ]);
  });

  it('keeps microbiology exam cards visible even when the parser only extracts one subsection', () => {
    const combinedExam: SyslabExamItem = {
      ...MOCK_EXAM,
      id: '43091284',
      date: '06/04/2026',
      time: '11:40:30',
      link: 'http://10.4.69.90/syslab/detalleexamenes.php?id=43091284',
      exams: [
        'CULTIVO CORRIENTE 1.',
        'ATB BACILOS GRAM (-) 1.',
        'ANTIBIOGRAMA EXTENDIDO 1.',
        'PCR PANEL RESPIRATORIO #2.',
      ],
    };

    const result = buildAnalysisData(
      [
        {
          url: combinedExam.link!,
          findings: [
            {
              section: 'GENERAL',
              analysis: 'Influenza A',
              result: 'NEGATIVO',
              unit: '',
              refValue: '',
              qualitative: true,
            },
            {
              section: 'GENERAL',
              analysis: 'Rhinovirus',
              result: 'NEGATIVO',
              unit: '',
              refValue: '',
              qualitative: true,
            },
          ],
        },
      ],
      [combinedExam]
    );

    expect(result.microbiologyEntries.map(entry => entry.examLabel)).toEqual(
      expect.arrayContaining(['Otros cultivos', 'PCR 8 virus'])
    );
    expect(
      result.microbiologyEntries.find(entry => entry.examLabel === 'Otros cultivos')?.findings
    ).toEqual([]);
    expect(
      result.microbiologyEntries.find(entry => entry.examLabel === 'PCR 8 virus')?.findings
    ).toEqual([
      { analysis: 'Influenza A', result: 'NEGATIVO' },
      { analysis: 'Rhinovirus', result: 'NEGATIVO' },
    ]);
  });
});
