// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildMicrobiologyEntriesForExam,
  collectMicrobiologyFinding,
  hasMicrobiologyPattern,
  resolveMicrobiologyCategoriesForExam,
} from '@/features/laboratory/controllers/labMicrobiologyAnalyticsController';
import type { LabResultRow, SyslabExamItem } from '@/types/domain/labExamTypes';
import type { LabMicrobiologyCategory } from '@/types/domain/labAnalyticsTypes';

describe('labMicrobiologyAnalyticsController', () => {
  const combinedExam: SyslabExamItem = {
    id: '43091284',
    link: 'http://example.com/43091284',
    date: '06/04/2026',
    time: '11:40:00',
    patientName: 'TEST',
    origin: 'HOSP',
    exams: [
      'CULTIVO CORRIENTE 1',
      'ATB BACILOS GRAM (-) 1',
      'ANTIBIOGRAMA EXTENDIDO 1',
      'PCR PANEL RESPIRATORIO #2',
    ],
  };

  it('detects microbiology patterns and categories from the combined exam names', () => {
    expect(hasMicrobiologyPattern('Rhinovirus')).toBe(true);
    expect(resolveMicrobiologyCategoriesForExam(combinedExam)).toEqual([
      'otros_cultivos',
      'pcr_8_virus',
    ]);
  });

  it('routes culture and PCR findings into separate category buckets', () => {
    const findingsByCategory = new Map<
      LabMicrobiologyCategory,
      Array<{ analysis: string; result: string }>
    >();

    const findings: LabResultRow[] = [
      {
        section: 'MICRO',
        analysis: 'Cultivo',
        result: 'Bacilos Gram (-) No Fermentador',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICRO',
        analysis: 'Ceftazidima',
        result: 'Susceptible',
        unit: '',
        refValue: '',
        qualitative: true,
      },
      {
        section: 'MICRO',
        analysis: 'Rhinovirus',
        result: 'NEGATIVO',
        unit: '',
        refValue: '',
        qualitative: true,
      },
    ];

    for (const finding of findings) {
      collectMicrobiologyFinding(
        finding,
        resolveMicrobiologyCategoriesForExam(combinedExam),
        findingsByCategory
      );
    }

    const entries = buildMicrobiologyEntriesForExam({
      exam: combinedExam,
      date: '06/04/2026 11:40',
      categories: resolveMicrobiologyCategoriesForExam(combinedExam),
      findingsByCategory,
    });

    const cultivo = entries.find(entry => entry.examLabel === 'Otros cultivos');
    const pcr = entries.find(entry => entry.examLabel === 'PCR 8 virus');

    expect(cultivo?.findings).toEqual(
      expect.arrayContaining([
        { analysis: 'Cultivo', result: 'Bacilos Gram (-) No Fermentador' },
        { analysis: 'Ceftazidima', result: 'Susceptible' },
      ])
    );
    expect(cultivo?.findings).not.toEqual(
      expect.arrayContaining([{ analysis: 'Rhinovirus', result: 'NEGATIVO' }])
    );
    expect(pcr?.findings).toEqual(
      expect.arrayContaining([{ analysis: 'Rhinovirus', result: 'NEGATIVO' }])
    );
  });

  it('keeps separated microbiology cards visible even before PDF fallback enriches findings', () => {
    const entries = buildMicrobiologyEntriesForExam({
      exam: combinedExam,
      date: '06/04/2026 11:40',
      categories: resolveMicrobiologyCategoriesForExam(combinedExam),
      findingsByCategory: new Map(),
    });

    expect(entries.map(entry => entry.examLabel)).toEqual(['Otros cultivos', 'PCR 8 virus']);
    expect(entries.every(entry => entry.findings)).toBe(true);
    expect(entries.every(entry => entry.sourceExam.id === '43091284')).toBe(true);
  });

  it('builds separate cards for arbovirus and uroculture families', () => {
    const arbovirusExam: SyslabExamItem = {
      id: '43088963',
      link: 'http://example.com/43088963',
      date: '16/02/2026',
      time: '15:19:41',
      patientName: 'TEST',
      origin: 'URG',
      exams: ['PCR ARBOVIROSIS'],
    };
    const urocultureExam: SyslabExamItem = {
      id: '43091999',
      link: 'http://example.com/43091999',
      date: '19/04/2026',
      time: '20:30:45',
      patientName: 'TEST',
      origin: 'HOSP',
      exams: ['UROCULTIVO'],
    };

    expect(resolveMicrobiologyCategoriesForExam(arbovirusExam)).toEqual(['pcr_arbovirus']);
    expect(resolveMicrobiologyCategoriesForExam(urocultureExam)).toEqual(['urocultivo']);

    expect(
      buildMicrobiologyEntriesForExam({
        exam: arbovirusExam,
        date: '16/02/2026 15:19',
        categories: ['pcr_arbovirus'],
        findingsByCategory: new Map(),
      }).map(entry => entry.examLabel)
    ).toEqual(['PCR arbovirus']);

    expect(
      buildMicrobiologyEntriesForExam({
        exam: urocultureExam,
        date: '19/04/2026 20:30',
        categories: ['urocultivo'],
        findingsByCategory: new Map(),
      }).map(entry => entry.examLabel)
    ).toEqual(['Urocultivo']);
  });
});
