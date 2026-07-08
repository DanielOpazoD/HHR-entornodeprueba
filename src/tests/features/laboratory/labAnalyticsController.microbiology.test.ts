import './labAnalyticsController.testSupport';

import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/features/laboratory/controllers/labAnalyticsController';
import { MICROBIOLOGY_CATEGORY_RULES } from '@/features/laboratory/constants/labMicrobiologyRuleConstants';
import { buildDetail, buildExam, buildFinding } from './labAnalyticsController.testSupport';
import { syslabGoldenMixedMicrobiologyScenario } from './fixtures/syslabGoldenLabFixtures';

describe('labAnalyticsController microbiology output', () => {
  it('separates culture and PCR rows from one combined order', () => {
    const combinedExam = buildExam({
      id: '43091284',
      link: 'http://example.com/43091284',
      date: '06/04/2026',
      time: '11:40:00',
      exams: [
        'CULTIVO CORRIENTE 1',
        'ATB BACILOS GRAM (-) 1',
        'ANTIBIOGRAMA EXTENDIDO 1',
        'PCR PANEL RESPIRATORIO #2',
      ],
    });

    const result = buildAnalysisData(
      [
        buildDetail({
          url: 'http://example.com/43091284',
          findings: [
            buildFinding({
              section: 'MICRO',
              analysis: 'Cultivo',
              result: 'Bacilos Gram (-) No Fermentador',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'MICRO',
              analysis: 'Ceftazidima',
              result: 'Susceptible',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'MICRO',
              analysis: 'Rhinovirus',
              result: 'NEGATIVO',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
          ],
        }),
      ],
      [combinedExam]
    );

    const culture = result.microbiologyEntries.find(entry => entry.examLabel === 'Otros cultivos');
    const pcr = result.microbiologyEntries.find(entry => entry.examLabel === 'PCR 8 virus');

    expect(culture?.findings).toEqual(
      expect.arrayContaining([
        { analysis: 'Cultivo', result: 'Bacilos Gram (-) No Fermentador' },
        { analysis: 'Ceftazidima', result: 'Susceptible' },
      ])
    );
    expect(culture?.findings).not.toEqual(
      expect.arrayContaining([{ analysis: 'Rhinovirus', result: 'NEGATIVO' }])
    );
    expect(pcr?.findings).toEqual(
      expect.arrayContaining([{ analysis: 'Rhinovirus', result: 'NEGATIVO' }])
    );
  });

  it('surfaces arbovirus PCR as its own microbiology card', () => {
    const arbovirusExam = buildExam({
      id: '43088963',
      link: 'http://example.com/43088963',
      date: '16/02/2026',
      time: '15:19:41',
      origin: 'URG',
      exams: ['PCR ARBOVIROSIS'],
    });

    const result = buildAnalysisData(
      [
        buildDetail({
          url: arbovirusExam.link!,
          findings: [
            buildFinding({
              section: 'MICROBIOLOGIA',
              analysis: 'PCR virus Zika',
              result: 'Negativo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'MICROBIOLOGIA',
              analysis: 'PCR DENGUE',
              result: 'Negativo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
          ],
        }),
      ],
      [arbovirusExam]
    );

    expect(result.microbiologyEntries.map(entry => entry.examLabel)).toEqual(['PCR arbovirus']);
    expect(result.microbiologyEntries[0]?.findings).toEqual([
      { analysis: 'PCR virus Zika', result: 'Negativo' },
      { analysis: 'PCR DENGUE', result: 'Negativo' },
    ]);
  });

  it('keeps general chemistry rows out of microbiology cards inside mixed orders', () => {
    const mixedExam = buildExam({
      id: '43091999',
      link: 'http://example.com/43091999',
      date: '20/04/2026',
      time: '07:00:00',
      exams: ['UROCULTIVO'],
    });

    const result = buildAnalysisData(
      [
        buildDetail({
          url: mixedExam.link!,
          findings: [
            buildFinding({
              section: 'MICROBIOLOGIA',
              analysis: 'Cultivo',
              result: 'No hubo desarrollo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'BIOQUIMICA',
              analysis: 'Proteinas Totales',
              result: '14,5',
              unit: 'g/dL',
              refValue: '6,0-8,0',
            }),
            buildFinding({
              section: 'BIOQUIMICA',
              analysis: 'Albumina',
              result: '1,6',
              unit: 'g/dL',
              refValue: '3,5-5,0',
            }),
          ],
        }),
      ],
      [mixedExam]
    );

    expect(result.microbiologyEntries).toHaveLength(1);
    expect(result.microbiologyEntries[0]?.findings).toEqual([
      { analysis: 'Cultivo', result: 'No hubo desarrollo' },
    ]);
    expect(result.comparison['Proteinas Totales']).toBeDefined();
    expect(result.comparison.Albumina).toBeDefined();
  });

  it('routes SARS, uroculture and antibiogram-only rows to microbiology, not comparison', () => {
    const sarsExam = buildExam({
      id: '43033969',
      link: 'http://example.com/sars',
      date: '21/07/2022',
      time: '10:00:00',
      exams: ['SARS COV-2'],
    });
    const urineExam = buildExam({
      id: '43076591',
      link: 'http://example.com/urine',
      date: '08/03/2025',
      time: '08:00:00',
      exams: ['UROCULTIVO 1', 'ATB BACILOS GRAM (-) 1'],
    });

    const result = buildAnalysisData(
      [
        buildDetail({
          url: sarsExam.link!,
          findings: [
            buildFinding({
              section: 'SARS COV-2',
              analysis: 'PCR SARS-CoV-19',
              result: 'NEGATIVO',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
          ],
        }),
        buildDetail({
          url: urineExam.link!,
          findings: [
            buildFinding({
              section: 'UROCULTIVO 1',
              analysis: 'Recuento de Colonias',
              result: '> 100.000',
              unit: 'UFC/mL',
              refValue: '',
            }),
            buildFinding({
              section: 'ANTIBIOGRAMA',
              analysis: 'Gentamicina',
              result: 'Intermedio',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'RPR',
              analysis: 'Resultado',
              result: 'NO REACTIVO',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
          ],
        }),
      ],
      [sarsExam, urineExam]
    );

    expect(result.comparison['PCR SARS-CoV-19']).toBeUndefined();
    expect(result.comparison['Recuento de Colonias']).toBeUndefined();
    expect(result.comparison.Gentamicina).toBeUndefined();
    expect(result.comparison.Resultado).toBeUndefined();

    expect(result.microbiologyEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          examLabel: 'PCR 8 virus',
          findings: [{ analysis: 'PCR SARS-CoV-19', result: 'NEGATIVO' }],
        }),
        expect.objectContaining({
          examLabel: 'Urocultivo',
          findings: expect.arrayContaining([
            { analysis: 'Recuento de Colonias', result: '> 100.000' },
            { analysis: 'Gentamicina', result: 'Intermedio' },
          ]),
        }),
      ])
    );
  });

  it('keeps a golden Syslab mixed microbiology fixture clinically routed by explicit rules', () => {
    expect(MICROBIOLOGY_CATEGORY_RULES.urocultivo.findingStrong).toEqual(
      expect.arrayContaining(['UROCULTIVO', 'ANTIBIOGRAMA', 'RECUENTO DE COLONIA'])
    );
    expect(MICROBIOLOGY_CATEGORY_RULES.pcr_8_virus.exam).toEqual(
      expect.arrayContaining(['SARS', 'COVID', 'COV-2'])
    );

    const result = buildAnalysisData(
      syslabGoldenMixedMicrobiologyScenario.details,
      syslabGoldenMixedMicrobiologyScenario.exams
    );

    expect(result.comparison).toHaveProperty('Hb glicosilada');
    expect(result.comparison).toHaveProperty('Trigliceridos');
    expect(result.comparison).not.toHaveProperty('PCR SARS-CoV-19');
    expect(result.comparison).not.toHaveProperty('Recuento de Colonias');
    expect(result.comparison).not.toHaveProperty('Gentamicina');

    expect(result.microbiologyEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          examLabel: 'PCR 8 virus',
          findings: [{ analysis: 'PCR SARS-CoV-19', result: 'NEGATIVO' }],
        }),
        expect.objectContaining({
          examLabel: 'Urocultivo',
          findings: expect.arrayContaining([
            { analysis: 'Recuento de Colonias', result: '> 100.000' },
            { analysis: 'Gentamicina', result: 'Intermedio' },
          ]),
        }),
      ])
    );
  });
});
