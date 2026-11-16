// @vitest-environment node
import './labAnalyticsController.testSupport';

import { describe, expect, it } from 'vitest';
import { buildAnalysisData } from '@/features/laboratory/controllers/labAnalyticsController';
import { buildDetail, buildExam, buildFinding } from './labAnalyticsController.testSupport';

describe('labAnalyticsController urine policy', () => {
  it('tracks RPC and RAC trends but excludes urine density trends', () => {
    const urineExamOne = buildExam({
      id: '500',
      link: 'http://example.com/500',
      date: '10/04/2026',
      time: '08:00:00',
      exams: ['QUIMICA/ORINA'],
    });

    const urineExamTwo = buildExam({
      id: '501',
      link: 'http://example.com/501',
      date: '20/04/2026',
      time: '08:00:00',
      exams: ['QUIMICA/ORINA'],
    });

    const result = buildAnalysisData(
      [
        buildDetail({
          url: urineExamOne.link!,
          findings: [
            buildFinding({
              section: 'QUIMICA/ORINA',
              analysis: 'Rel. Proteinuria/Creatininuria',
              result: '120',
              unit: '',
              refValue: '< 200,0',
            }),
            buildFinding({
              section: 'RELAC. ALBUMINA/CREATINURIA',
              analysis: 'RELAC. ALBUMINA/CREATINURIA',
              result: '35',
              unit: '',
              refValue: '< 30,0',
            }),
            buildFinding({
              section: 'ORINA FISICO-QUIMICO',
              analysis: 'Densidad',
              result: '1,015',
              unit: '',
              refValue: '',
            }),
          ],
        }),
        buildDetail({
          url: urineExamTwo.link!,
          findings: [
            buildFinding({
              section: 'QUIMICA/ORINA',
              analysis: 'Rel. Proteinuria/Creatininuria',
              result: '90',
              unit: '',
              refValue: '< 200,0',
            }),
            buildFinding({
              section: 'RELAC. ALBUMINA/CREATINURIA',
              analysis: 'RELAC. ALBUMINA/CREATINURIA',
              result: '28',
              unit: '',
              refValue: '< 30,0',
            }),
            buildFinding({
              section: 'ORINA FISICO-QUIMICO',
              analysis: 'Densidad',
              result: '1,010',
              unit: '',
              refValue: '',
            }),
          ],
        }),
      ],
      [urineExamOne, urineExamTwo]
    );

    const urineTrendGroup = result.trendGroups.find(group => group.label === 'RPC / RAC');
    expect(urineTrendGroup?.variables.RPC).toHaveLength(2);
    expect(urineTrendGroup?.variables.RAC).toHaveLength(2);
    expect(urineTrendGroup?.variables.Densidad).toBeUndefined();
  });

  it('prioritizes RPC and RAC over component support values', () => {
    const urineExam = buildExam({
      id: '43091921',
      link: 'http://example.com/43091921',
      date: '19/04/2026',
      time: '20:30:45',
      exams: ['ORINA FISICO-QUIMICO', 'SEDIMENTO URINARIO', 'QUIMICA/ORINA'],
    });

    const result = buildAnalysisData(
      [
        buildDetail({
          url: urineExam.link!,
          findings: [
            buildFinding({
              section: 'ORINA FISICO-QUIMICO',
              analysis: 'Leucocitos',
              result: '+/-',
              unit: '',
              refValue: '',
            }),
            buildFinding({
              section: 'SEDIMENTO URINARIO',
              analysis: 'Bacterias',
              result: 'Escasa cantidad',
              unit: '',
              refValue: '',
            }),
            buildFinding({
              section: 'SEDIMENTO URINARIO',
              analysis: 'Placas de pus',
              result: 'No se observa',
              unit: '',
              refValue: '',
            }),
            buildFinding({
              section: 'QUIMICA/ORINA',
              analysis: 'Rel. Proteinuria/Creatininuria',
              result: '136,2',
              unit: '',
              refValue: '< 200,0',
            }),
            buildFinding({
              section: 'QUIMICA/ORINA',
              analysis: 'Proteinuria',
              result: '126',
              unit: 'mg/L',
              refValue: '10 - 140',
            }),
            buildFinding({
              section: 'QUIMICA/ORINA',
              analysis: 'Creatininuria',
              result: '92,5',
              unit: 'mg/dL',
              refValue: '70,0 - 140,0',
            }),
            buildFinding({
              section: 'RELAC. ALBUMINA/CREATINURIA',
              analysis: 'Relacion Albumina/Creatininuri',
              result: '238,9',
              unit: '',
              refValue: '< 30,0',
            }),
            buildFinding({
              section: 'RELAC. ALBUMINA/CREATINURIA',
              analysis: 'Microalbuminuria',
              result: '221',
              unit: 'mg/L',
              refValue: '< 250',
            }),
          ],
        }),
      ],
      [urineExam]
    );

    expect(result.comparison.RPC).toBeDefined();
    expect(result.comparison.RAC).toBeDefined();
    expect(result.comparison.Leucocitos).toBeUndefined();
    expect(result.comparison.Bacterias).toBeUndefined();
    expect(result.comparison['Placas de pus']).toBeUndefined();
    expect(result.comparison.Proteinuria).toBeUndefined();
    expect(result.comparison.Creatininuria).toBeUndefined();
    expect(result.comparison.Microalbuminuria).toBeUndefined();
  });

  it('excludes urine qualitative rows and MIDAS metadata from comparison', () => {
    const urineExam = buildExam({
      id: '43091921',
      link: 'http://example.com/43091921',
      date: '19/04/2026',
      time: '19:55:00',
      exams: ['ORINA FISICO-QUIMICO', 'QUIMICA/ORINA'],
    });

    const result = buildAnalysisData(
      [
        buildDetail({
          url: urineExam.link!,
          findings: [
            buildFinding({
              section: 'GENERAL',
              analysis: 'N° ingreso a MIDAS',
              result: '2605786',
              unit: '',
              refValue: '',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Leucocitos',
              result: 'Negativo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Cuerpos Cetónicos',
              result: 'Negativo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Nitritos',
              result: 'Negativo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Rel. Proteinuria/Creatininuria',
              result: '136,2',
              unit: '',
              refValue: '< 200,0',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'RELAC. ALBUMINA/CREATINURIA',
              result: '238,9',
              unit: '',
              refValue: '< 30,0',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Creatininuria',
              result: '92,5',
              unit: 'mg/dL',
              refValue: '70,0 - 140,0',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Proteinuria',
              result: '126',
              unit: 'mg/L',
              refValue: '10 - 140',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Microalbuminuria',
              result: '221',
              unit: 'mg/L',
              refValue: '< 250',
            }),
          ],
        }),
      ],
      [urineExam]
    );

    expect(result.comparison['N° ingreso a MIDAS']).toBeUndefined();
    expect(result.comparison['Recuento Leucocitos']).toBeUndefined();
    expect(result.comparison['Cuerpos Cetónicos']).toBeUndefined();
    expect(result.comparison.Nitritos).toBeUndefined();
    expect(result.comparison.Creatininuria).toBeUndefined();
    expect(result.comparison.Proteinuria).toBeUndefined();
    expect(result.comparison.Microalbuminuria).toBeUndefined();
    expect(result.comparison.RPC).toBeDefined();
    expect(result.comparison.RAC).toBeDefined();
  });

  it('excludes complete-urine header rows and keeps RPC/RAC', () => {
    const urineExam = buildExam({
      id: '43091921',
      link: 'http://example.com/43091921',
      date: '19/04/2026',
      time: '19:55:00',
      exams: ['ORINA FISICO-QUIMICO', 'SEDIMENTO URINARIO', 'QUIMICA/ORINA'],
    });

    const result = buildAnalysisData(
      [
        buildDetail({
          url: urineExam.link!,
          findings: [
            buildFinding({
              section: 'GENERAL',
              analysis: 'ORINA FISICO-QUIMICO',
              result: '',
              unit: '',
              refValue: '',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'N° ingreso a midas.',
              result: '2605786',
              unit: '',
              refValue: '',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Leucocitos',
              result: 'Negativo',
              unit: ' ',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Cuerpos Cetónicos',
              result: 'Negativo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Nitritos',
              result: 'Negativo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Sangre',
              result: 'Negativo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Urobilinógeno',
              result: 'Negativo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Glucosa',
              result: 'Negativo',
              unit: '',
              refValue: '',
              qualitative: true,
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Rel. Proteinuria/Creatininuria',
              result: '136,2',
              unit: '',
              refValue: '< 200,0',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'RELAC. ALBUMINA/CREATINURIA',
              result: '238,9',
              unit: '',
              refValue: '< 30,0',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Creatininuria',
              result: '92,5',
              unit: 'mg/dL',
              refValue: '70,0 - 140,0',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Proteinuria',
              result: '126',
              unit: 'mg/L',
              refValue: '10 - 140',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Microalbuminuria',
              result: '221',
              unit: 'mg/L',
              refValue: '< 250',
            }),
          ],
        }),
      ],
      [urineExam]
    );

    expect(result.comparison['ORINA FISICO-QUIMICO']).toBeUndefined();
    expect(result.comparison['N° ingreso a midas.']).toBeUndefined();
    expect(result.comparison['Recuento Leucocitos']).toBeUndefined();
    expect(result.comparison['Cuerpos Cetónicos']).toBeUndefined();
    expect(result.comparison.Nitritos).toBeUndefined();
    expect(result.comparison.Sangre).toBeUndefined();
    expect(result.comparison['Urobilinógeno']).toBeUndefined();
    expect(result.comparison.Glucosa).toBeUndefined();
    expect(result.comparison.Creatininuria).toBeUndefined();
    expect(result.comparison.Proteinuria).toBeUndefined();
    expect(result.comparison.Microalbuminuria).toBeUndefined();
    expect(result.comparison.RPC).toBeDefined();
    expect(result.comparison.RAC).toBeDefined();
  });

  it('builds RPC and RAC when Syslab writes ratio labels inline', () => {
    const urineExam = buildExam({
      id: '43091921',
      link: 'http://example.com/43091921',
      date: '19/04/2026',
      time: '19:55:00',
      exams: ['QUIMICA/ORINA'],
    });

    const result = buildAnalysisData(
      [
        buildDetail({
          url: urineExam.link!,
          findings: [
            buildFinding({
              section: 'GENERAL',
              analysis: 'Rel. Proteinuria/Creatininuria = RPC',
              result: '136,2',
              unit: '',
              refValue: '< 200,0',
            }),
            buildFinding({
              section: 'RELAC. ALBUMINA/CREATINURIA= RAC.',
              analysis: '',
              result: '238,9',
              unit: '',
              refValue: '< 30,0',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Creatininuria',
              result: '92,5',
              unit: 'mg/dL',
              refValue: '70,0 - 140,0',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Proteinuria',
              result: '126',
              unit: 'mg/L',
              refValue: '10 - 140',
            }),
            buildFinding({
              section: 'GENERAL',
              analysis: 'Microalbuminuria',
              result: '221',
              unit: 'mg/L',
              refValue: '< 250',
            }),
          ],
        }),
      ],
      [urineExam]
    );

    expect(result.comparison.RPC).toBeDefined();
    expect(result.comparison.RAC).toBeDefined();
    expect(result.comparison.Creatininuria).toBeUndefined();
    expect(result.comparison.Proteinuria).toBeUndefined();
    expect(result.comparison.Microalbuminuria).toBeUndefined();
  });
});
