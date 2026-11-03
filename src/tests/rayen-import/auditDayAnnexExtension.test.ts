// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { jsPDF } from 'jspdf';
import * as PDFLib from 'pdf-lib';
import { createRequire } from 'node:module';

import '../../../extension/audit-day-annex.js';

interface Entry {
  time: string;
  author: string;
  role: string;
  heading: string;
  lines: string[];
  flags: string[];
}
interface Model {
  day: string;
  sections: Array<{ title: string; entries: Entry[] }>;
}
const annex = (
  globalThis as unknown as {
    HhrAuditDayAnnex: {
      buildModel: (input: { events: unknown[]; day: string }) => Model;
      render: (input: {
        JsPDF: typeof jsPDF;
        model: Model;
        patient: { name: string; run: string; encId: string };
        generatedAt: number;
      }) => ArrayBuffer;
      rapaNuiSpan: (day: string) => { from: string; to: string };
    };
  }
).HhrAuditDayAnnex;

// Synthetic Ficha Médico history: mainland wall-clock times without offset.
const events = [
  {
    publishDatetime: '2026-09-06T10:15:00',
    evolutionResume: [
      {
        OBE_PUBLISH_DATETIME: '2026-09-06T10:15:00',
        OBE_NOTES: 'Evolución sintética\nsegunda línea',
        HCP_FGN: 'Ana',
        HCP_FFN: 'Prueba',
        HCPR_NAME: 'Médico',
        OBE_AMENDED: true,
        id: 11,
      },
    ],
    vitalSignObsResume: [
      {
        PUBLISH_DATE: '2026-09-06T08:00:00',
        HCP_NAME: 'Enfermera Uno',
        HCPR_ROLE: 'Enfermera',
        LABEL: 'PA',
        VALUE: '120/80',
        ORDER: 2,
      },
      {
        PUBLISH_DATE: '2026-09-06T08:00:00',
        HCP_NAME: 'Enfermera Uno',
        HCPR_ROLE: 'Enfermera',
        LABEL: 'FC',
        VALUE: '80',
        ORDER: 1,
      },
    ],
    pharmaPerformedActivityResume: [
      {
        PUBLISH_DATETIME: '2026-09-06T14:00:00',
        HCP_NAME: 'Técnico Uno',
        HCP_ROLE: 'TENS',
        PERF_ACTIVITY_NAME: 'Medicamento sintético 500 mg',
        POSOLOGY: 'cada 8 horas',
        PACT_PERFORMED: false,
        PACT_COULD_NOT_BE_PERFORMED: true,
        NOT_PERFORMED_MOTIVE: 'Paciente en ayuno',
      },
    ],
  },
  {
    publishDatetime: '2026-09-06T16:00:00',
    evaluationInstrumentsResume: [
      {
        FORM_NAME: 'Escala sintética',
        LABEL: 'Puntaje',
        VALUE: '18',
        PUBLISH_DATE_HCP_NAME: '06-09-2026 - 16:00 - Enfermera Dos - Enfermera',
      },
    ],
    futureResume: [{ ID: 5, ENC_ID: 9, NUEVO_CAMPO: 'valor nuevo', ARCHIVED: false }],
    // The same evolution published again must not appear twice.
    evolutionResume: [
      {
        OBE_PUBLISH_DATETIME: '2026-09-06T10:15:00',
        OBE_NOTES: 'Evolución sintética\nsegunda línea',
        HCP_FGN: 'Ana',
        HCP_FFN: 'Prueba',
        HCPR_NAME: 'Médico',
        OBE_AMENDED: true,
        id: 11,
      },
    ],
  },
  {
    // 00:30 of Sept 7 on the mainland: already in the official segment from Sept 7.
    publishDatetime: '2026-09-07T00:30:00',
    evolutionResume: [{ OBE_PUBLISH_DATETIME: '2026-09-07T00:30:00', OBE_NOTES: 'Otro día' }],
  },
];

describe('HHR annex of a day Eloísa cannot report', () => {
  const model = annex.buildModel({ events, day: '2026-09-06' });
  const section = (title: string) => model.sections.find(item => item.title === title);

  it('keeps only that mainland day and shows every time in Rapa Nui', () => {
    expect(model.sections.map(item => item.title)).toEqual([
      'Evoluciones',
      'Administración de medicamentos',
      'Signos vitales',
      'Escalas y evaluaciones',
      'Otros registros (futureResume)',
    ]);
    // Sept 6: mainland UTC-3, Rapa Nui UTC-5.
    expect(section('Evoluciones')?.entries).toEqual([
      {
        groupKey: null,
        instant: Date.parse('2026-09-06T13:15:00Z'),
        time: '06-09-2026 08:15',
        author: 'Ana Prueba',
        role: 'Médico',
        heading: '',
        lines: ['Evolución sintética\nsegunda línea'],
        flags: ['Enmendado'],
      },
    ]);
    expect(annex.rapaNuiSpan('2026-09-06')).toEqual({
      from: '05-09-2026 23:00',
      to: '06-09-2026 21:59',
    });
  });

  it('copies values as Eloísa gives them, grouped like the official report', () => {
    expect(section('Signos vitales')?.entries[0]).toMatchObject({
      time: '06-09-2026 06:00',
      author: 'Enfermera Uno',
      lines: ['FC: 80', 'PA: 120/80'],
    });
    expect(section('Administración de medicamentos')?.entries[0].lines).toEqual([
      'Medicamento sintético 500 mg',
      'Posología: cada 8 horas',
      'No administrado',
      'Motivo: Paciente en ayuno',
    ]);
    expect(section('Escalas y evaluaciones')?.entries[0]).toMatchObject({
      time: '06-09-2026 14:00',
      author: 'Enfermera Dos',
      role: 'Enfermera',
      heading: 'Escala sintética',
      lines: ['Puntaje: 18'],
    });
  });

  it('does not drop a kind of record it does not know, nor show its technical fields', () => {
    expect(section('Otros registros (futureResume)')?.entries[0].lines).toEqual([
      'NUEVO_CAMPO: valor nuevo',
    ]);
  });

  it('renders a readable PDF that says it is not official', async () => {
    const buffer = annex.render({
      JsPDF: jsPDF,
      model,
      patient: { name: 'Paciente Prueba Uno', run: '11111111-1', encId: '901' },
      generatedAt: Date.parse('2026-11-02T21:10:00Z'),
    });

    const pdf = await PDFLib.PDFDocument.load(buffer);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    const require = createRequire(import.meta.url);
    const pdfjs = await import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'));
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true })
      .promise;
    let text = '';
    for (let page = 1; page <= doc.numPages; page += 1) {
      text += (await (await doc.getPage(page)).getTextContent()).items
        .map((item: { str?: string }) => item.str ?? '')
        .join(' ');
    }
    expect(text).toContain('documento no oficial');
    expect(text).toContain('Evoluciones');
    expect(text).toContain('06-09-2026 08:15');
    expect(text).toContain('Paciente en ayuno');
    expect(text).toContain('de 05-09-2026 23:00 a 06-09-2026 21:59, hora de Rapa Nui');
  });

  it('says so when Ficha Médico has no records for the day', () => {
    expect(annex.buildModel({ events: [], day: '2026-09-06' }).sections).toEqual([]);
  });
});
