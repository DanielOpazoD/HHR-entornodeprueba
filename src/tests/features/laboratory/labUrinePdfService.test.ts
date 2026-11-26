// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/laboratory/syslabService', () => ({
  fetchSyslabPdfArrayBuffer: vi.fn(),
}));

vi.mock('@/features/laboratory/services/labPdfTextSupport', async importOriginal => {
  const original =
    await importOriginal<typeof import('@/features/laboratory/services/labPdfTextSupport')>();
  return {
    ...original,
    extractPdfText: vi.fn(),
  };
});

import type { SyslabExamDetail, SyslabExamItem } from '@/types/domain/labExamTypes';
import { fetchSyslabPdfArrayBuffer } from '@/services/laboratory/syslabService';
import { extractPdfText } from '@/features/laboratory/services/labPdfTextSupport';
import {
  enrichUrineRatioDetailsFromPdf,
  parseUrineRatioFindingsFromPdfText,
} from '@/features/laboratory/services/labUrinePdfService';

describe('labUrinePdfService', () => {
  it('parses RPC and RAC from the urine ratio PDF text', () => {
    const text = `
      QUIMICA/ORINA
      Resultado Unidad Valor de Referencia
      Rel. Proteinuria/Creatininuria : 136,2 < 200,0
      Creatininuria : 92,5 mg/dL 70,0 - 140,0
      Proteinuria : 126 mg/L 10 - 140

      RELAC. ALBUMINA/CREATINURIA
      Resultado Unidad Valor de Referencia
      Creatininuria : 92,5 mg/dL 70,0 - 140,0
      Microalbuminuria : 221 mg/L < 250
      Relacion Albumina/Creatininuri : 238,9 < 30,0
    `;

    expect(parseUrineRatioFindingsFromPdfText(text)).toEqual([
      {
        section: 'QUIMICA/ORINA',
        analysis: 'Rel. Proteinuria/Creatininuria',
        result: '136,2',
        unit: '',
        refValue: '< 200,0',
        qualitative: false,
      },
      {
        section: 'RELAC. ALBUMINA/CREATINURIA',
        analysis: 'Relacion Albumina/Creatininuri',
        result: '238,9',
        unit: '',
        refValue: '< 30,0',
        qualitative: false,
      },
    ]);
  });

  it('enriches missing urine ratios from the PDF fallback', async () => {
    const exam: SyslabExamItem = {
      id: '43091921',
      link: 'http://10.4.69.90/syslab/detalleexamenes.php?id=43091921',
      date: '19/04/2026',
      time: '20:30:45',
      patientName: 'ARAKI PAKOMIO,RAUL IVAN',
      origin: 'HOSPITALIZADO',
      exams: ['ORINA FISICO-QUIMICO', 'SEDIMENTO URINARIO', 'QUIMICA/ORINA'],
    };

    const detail: SyslabExamDetail = {
      url: exam.link!,
      findings: [
        {
          section: 'QUIMICA/ORINA',
          analysis: 'Creatininuria',
          result: '92,5',
          unit: 'mg/dL',
          refValue: '70,0 - 140,0',
        },
        {
          section: 'QUIMICA/ORINA',
          analysis: 'Proteinuria',
          result: '126',
          unit: 'mg/L',
          refValue: '10 - 140',
        },
        {
          section: 'RELAC. ALBUMINA/CREATINURIA',
          analysis: 'Microalbuminuria',
          result: '221',
          unit: 'mg/L',
          refValue: '< 250',
        },
      ],
    };

    vi.mocked(fetchSyslabPdfArrayBuffer).mockResolvedValue(new ArrayBuffer(0));
    vi.mocked(extractPdfText).mockResolvedValue(`
      QUIMICA/ORINA
      Resultado Unidad Valor de Referencia
      Rel. Proteinuria/Creatininuria : 136,2 < 200,0

      RELAC. ALBUMINA/CREATINURIA
      Resultado Unidad Valor de Referencia
      Relacion Albumina/Creatininuri : 238,9 < 30,0
    `);

    const enriched = await enrichUrineRatioDetailsFromPdf([detail], [exam]);

    expect(enriched[0].findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          section: 'QUIMICA/ORINA',
          analysis: 'Rel. Proteinuria/Creatininuria',
          result: '136,2',
        }),
        expect.objectContaining({
          section: 'RELAC. ALBUMINA/CREATINURIA',
          analysis: 'Relacion Albumina/Creatininuri',
          result: '238,9',
        }),
      ])
    );
  });
});
