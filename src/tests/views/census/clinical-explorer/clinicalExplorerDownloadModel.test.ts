import { describe, expect, it } from 'vitest';
import type { AuditDocumentsResult } from '@/features/audit-documents/eloisa-history';
import {
  buildLabReportGroups,
  bundleFileName,
  ctFileName,
  defaultDownloadRange,
  describeCtPart,
  describeRecordPart,
  labReadFrom,
  outcome,
  planCtReports,
  planLabPart,
  rangeProblem,
  reviewDownload,
  settleLabRead,
  zipEntryNames,
  type DownloadDocument,
} from '@/features/census/components/clinical-explorer/clinicalExplorerDownloadModel';
import type { MMRADExam } from '@/services/radiology/mmradService';
import type { LabAnalysisData } from '@/types/domain/labAnalyticsTypes';
import type { LabResultRow } from '@/types/domain/labExamTypes';

const row = (analysis: string, result: string, unit = 'mg/dL'): LabResultRow => ({
  section: 'BIOQUIMICA',
  analysis,
  result,
  unit,
  refValue: '0.7 - 1.3',
});

// Synthetic Syslab matrix: two reports on 31/10 (before admission), 02/11 and 05/11.
const analysis: LabAnalysisData = {
  trendGroups: [],
  examDates: [],
  microbiologyEntries: [],
  comparison: {
    Hemoglobina: {
      '02/11/2026 08:30': row('Hemoglobina', '11.2', 'g/dL'),
      '05/11/2026 07:10': row('Hemoglobina', '10.8', 'g/dL'),
    },
    Creatinina: {
      '31/10/2026 22:00': row('Creatinina', '1.9'),
      '02/11/2026 08:30': row('Creatinina', '1.4'),
      '05/11/2026 07:10': row('Creatinina', '1.1'),
    },
  },
};

const exam = (overrides: Partial<MMRADExam>): MMRADExam => ({
  nombre_examen: 'TC tórax',
  fecha_examen: '03/11/2026 10:15',
  fecha_asignacion: '03/11/2026',
  mod: 'CT',
  estado: 'Validado',
  pdf_url: null,
  dicom_url: null,
  informe_html_url: null,
  report: null,
  ...overrides,
});

const pdf = (part: DownloadDocument['part'], fileName: string): DownloadDocument => ({
  part,
  fileName,
  bytes: new Uint8Array([1]),
});

const summaryRow = (overrides: Partial<NonNullable<AuditDocumentsResult['summary']>[number]>) => ({
  run: '123456785',
  name: 'PACIENTE SINTETICO',
  hospitalizations: 1,
  unverified: 0,
  downloaded: 1,
  reconstructed: 0,
  incomplete: 0,
  failed: 0,
  ...overrides,
});

describe('download range on the hospital calendar', () => {
  it('defaults to admission through today and falls back to today without a usable admission', () => {
    expect(defaultDownloadRange('2026-11-01', '2026-11-06')).toEqual({
      from: '2026-11-01',
      to: '2026-11-06',
    });
    expect(defaultDownloadRange('', '2026-11-06')).toEqual({
      from: '2026-11-06',
      to: '2026-11-06',
    });
    expect(defaultDownloadRange('2026-11-09', '2026-11-06').from).toBe('2026-11-06');
  });

  it('rejects an inverted or incomplete range', () => {
    expect(rangeProblem({ from: '2026-11-05', to: '2026-11-02' })).toMatch(/posterior/);
    expect(rangeProblem({ from: '', to: '2026-11-02' })).toMatch(/Elige/);
    expect(rangeProblem({ from: '2026-11-02', to: '2026-11-02' })).toBeNull();
  });

  it('reads Syslab from the admission unless «desde» is earlier, so the explorer read is reused', () => {
    expect(labReadFrom('2026-11-01', '2026-11-04')).toBe('2026-11-01');
    expect(labReadFrom('2026-11-01', '2026-10-25')).toBe('2026-10-25');
    expect(labReadFrom('', '2026-11-04')).toBe('2026-11-04');
  });
});

describe('Syslab results', () => {
  it('keeps only the reports inside the range, one block per report, oldest first', () => {
    const groups = buildLabReportGroups(analysis, { from: '2026-11-01', to: '2026-11-05' });
    expect(groups.map(group => [group.dayIso, group.time])).toEqual([
      ['2026-11-02', '08:30'],
      ['2026-11-05', '07:10'],
    ]);
    // Clinical order inside a report: creatinina before hemoglobina.
    expect(groups[0]?.rows.map(item => [item.name, item.display])).toEqual([
      ['Creatinina', '1.4'],
      ['Hemoglobina', '11.2'],
    ]);
    expect(
      buildLabReportGroups(analysis, { from: '2026-10-31', to: '2026-11-02' }).map(g => g.dayIso)
    ).toEqual(['2026-10-31', '2026-11-02']);
  });

  it('tells a failed read from a range without reports', () => {
    const range = { from: '2026-11-06', to: '2026-11-06' };
    expect(planLabPart({ kind: 'failed', problem: 'Syslab no respondió.' }, range)).toEqual({
      outcome: expect.objectContaining({ status: 'failed', problem: 'Syslab no respondió.' }),
    });
    expect(planLabPart({ kind: 'empty' }, range)).toEqual({
      outcome: expect.objectContaining({
        status: 'empty',
        summary: 'Sin informes de Syslab del 06-11-2026.',
      }),
    });
    expect(planLabPart({ kind: 'ready', analysis, pending: 2 }, range)).toEqual({
      outcome: expect.objectContaining({
        status: 'empty',
        notes: ['Syslab aún no entrega resultados de 2 informes; no van incluidos.'],
      }),
    });
    expect(
      planLabPart({ kind: 'ready', analysis, pending: 0 }, { from: '2026-11-01', to: '2026-11-06' })
    ).toEqual(expect.objectContaining({ summary: '2 informes del 01-11-2026 al 06-11-2026' }));
  });

  it('waits while Syslab is asked and reports a session or read failure as such', () => {
    const base = { message: '', analysis: null, pending: 0, refreshing: false };
    expect(settleLabRead({ ...base, phase: 'checking' })).toBeNull();
    expect(settleLabRead({ ...base, phase: 'listing' })).toBeNull();
    expect(settleLabRead({ ...base, phase: 'reading' })).toBeNull();
    expect(settleLabRead({ ...base, phase: 'login-required' })).toEqual({
      kind: 'failed',
      problem: expect.stringMatching(/Syslab pide iniciar sesión/),
    });
    expect(settleLabRead({ ...base, phase: 'error', message: 'Syslab no respondió.' })).toEqual({
      kind: 'failed',
      problem: 'Syslab no respondió.',
    });
    expect(settleLabRead({ ...base, phase: 'empty' })).toEqual({ kind: 'empty' });
    expect(settleLabRead({ ...base, phase: 'ready', analysis, pending: 1 })).toEqual({
      kind: 'ready',
      analysis,
      pending: 1,
    });
  });

  it('waits while a cached Syslab read is renewed instead of taking what it had', () => {
    const renewing = { message: '', pending: 0, refreshing: true };
    expect(settleLabRead({ ...renewing, phase: 'ready', analysis })).toBeNull();
    expect(settleLabRead({ ...renewing, phase: 'empty', analysis: null })).toBeNull();
    // A failure is still a failure while something else renews.
    expect(
      settleLabRead({
        ...renewing,
        phase: 'error',
        analysis: null,
        message: 'Syslab no respondió.',
      })
    ).toEqual({ kind: 'failed', problem: 'Syslab no respondió.' });
  });
});

describe('Eloísa record', () => {
  const files = [
    {
      name: 'PACIENTE - 12345678-5 - Historial hospitalizacion - ingreso 2026-11-01.pdf',
      bytes: new Uint8Array([1]),
    },
  ];

  it('takes the history PDFs of the extension ZIP', () => {
    const result: AuditDocumentsResult = { ok: true, summary: [summaryRow({})] };
    expect(describeRecordPart(result, files)).toEqual(
      expect.objectContaining({ status: 'complete', summary: 'Historial de la hospitalización' })
    );
  });

  it('names what Eloísa did not deliver and asks before going on', () => {
    const result: AuditDocumentsResult = {
      ok: true,
      summary: [summaryRow({ hospitalizations: 2, failed: 1, incomplete: 1 })],
    };
    const part = describeRecordPart(result, files);
    expect(part.status).toBe('partial');
    expect(part.problem).toBe('Eloísa no entregó 1 de 2 historiales.');
    expect(part.notes).toEqual(['1 historial queda sin parte de un día que Eloísa no genera.']);
  });

  it('says an old extension saved the record apart instead of omitting it', () => {
    const part = describeRecordPart({ ok: true, filename: 'Auditoria_Eloisa.zip' }, null);
    expect(part.status).toBe('failed');
    expect(part.problem).toMatch(/anterior a la versión 0\.48\.71.*Auditoria_Eloisa\.zip/);
  });

  it('separates «no hospitalizations» from a failed Eloísa read', () => {
    expect(
      describeRecordPart(
        {
          ok: false,
          error: 'No hay hospitalizaciones',
          summary: [summaryRow({ hospitalizations: 0, downloaded: 0 })],
        },
        null
      ).status
    ).toBe('empty');
    const failed = describeRecordPart(
      { ok: false, summary: [summaryRow({ hospitalizations: 0, error: 'HTTP 500' })] },
      null
    );
    expect(failed).toEqual(
      expect.objectContaining({
        status: 'failed',
        problem: 'No se pudo consultar Eloísa: HTTP 500',
      })
    );
    expect(
      describeRecordPart({ ok: false, error: 'La extensión Eloísa no respondió.' }, null).problem
    ).toBe('La extensión Eloísa no respondió.');
    // Stays Eloísa lists without a date or RUT to check are a gap to review, not «sin ficha».
    expect(
      describeRecordPart(
        {
          ok: false,
          error: 'No hay hospitalizaciones en las fechas pedidas.',
          summary: [summaryRow({ hospitalizations: 0, downloaded: 0, unverified: 1 })],
        },
        null
      )
    ).toEqual(
      expect.objectContaining({
        status: 'failed',
        problem: 'Eloísa lista 1 hospitalización sin fecha o RUT verificable; revísalas allí.',
      })
    );
  });
});

describe('MMRAD CT reports', () => {
  it('takes CT reports oldest first, the original PDF before the text, and says what stays out', () => {
    const plan = planCtReports([
      exam({ nombre_examen: 'TC abdomen', fecha_examen: '05/11/2026 09:00', pdf_url: 'pdf-2' }),
      exam({ nombre_examen: 'Rx tórax', mod: 'CR', pdf_url: 'rx' }),
      exam({
        nombre_examen: 'TC cerebro',
        fecha_examen: '02/11/2026 18:00',
        report: {
          title: null,
          technique: null,
          antecedentesClinicos: null,
          findings: 'Normal.',
          impression: null,
        },
      }),
      exam({ nombre_examen: 'TC pelvis', fecha_examen: '04/11/2026 12:00' }),
      exam({ nombre_examen: 'TC cuello', pdf_url: 'other', registered_patient_id: '123456780' }),
    ]);
    expect(plan.included.map(item => [item.exam.nombre_examen, item.source])).toEqual([
      ['TC cerebro', 'text'],
      ['TC abdomen', 'pdf'],
    ]);
    expect(plan.ctCount).toBe(4);
    expect(plan.withheld).toEqual(['TC cuello (03-11-2026 10:15)']);
    expect(plan.unreported).toEqual([
      'TC pelvis (04-11-2026 12:00): MMRAD aún no publica su informe.',
    ]);
  });

  it('states a stay without CT, and names a report that could not be downloaded', () => {
    const none = planCtReports([exam({ mod: 'CR' })]);
    const settled = { documents: [], failures: [], searchIncomplete: false };
    expect(describeCtPart({ plan: none, ...settled })).toEqual(
      expect.objectContaining({ status: 'empty', summary: 'Sin TAC en esta hospitalización.' })
    );
    expect(describeCtPart({ plan: planCtReports([exam({})]), ...settled })).toEqual(
      expect.objectContaining({
        status: 'empty',
        summary: 'Ningún TAC de la hospitalización tiene informe publicado.',
        notes: ['TC tórax (03-11-2026 10:15): MMRAD aún no publica su informe.'],
      })
    );
    const plan = planCtReports([
      exam({ pdf_url: 'a' }),
      exam({ nombre_examen: 'TC abdomen', pdf_url: 'b' }),
    ]);
    const partial = describeCtPart({
      plan,
      documents: [pdf('ct', 'a.pdf')],
      failures: ['TC abdomen (03-11-2026 10:15)'],
      searchIncomplete: false,
    });
    expect(partial).toEqual(
      expect.objectContaining({
        status: 'partial',
        problem: 'No se pudo descargar: TC abdomen (03-11-2026 10:15).',
      })
    );
    expect(
      describeCtPart({ plan, documents: [], failures: ['a', 'b'], searchIncomplete: false }).status
    ).toBe('failed');
  });

  it('asks before leaving out a study held for its check digit or an unfinished search', () => {
    const settled = { documents: [], failures: [], searchIncomplete: false };
    const held = describeCtPart({
      plan: planCtReports([exam({ pdf_url: 'x', registered_patient_id: '123456780' })]),
      ...settled,
    });
    expect(held).toEqual(
      expect.objectContaining({
        status: 'failed',
        summary: 'No incluidos',
        problem:
          'MMRAD registró con otro dígito verificador: TC tórax (03-11-2026 10:15). No van incluidos; revísalos en Imágenes.',
      })
    );
    const unfinished = describeCtPart({
      plan: planCtReports([exam({ mod: 'CR' })]),
      ...settled,
      searchIncomplete: true,
    });
    expect(unfinished).toEqual(
      expect.objectContaining({
        status: 'failed',
        problem:
          'La búsqueda de TAC registrados con otro dígito verificador no terminó; puede faltar alguno.',
      })
    );
    expect(reviewDownload(['ct'], { ct: unfinished }).incomplete).toEqual(['ct']);
  });
});

describe('files and the final decision', () => {
  it('names files with the patient and dates only, in plain ASCII', () => {
    expect(bundleFileName('MUÑOZ PÉREZ, JOSÉ', '2026-11-06', 'pdf')).toBe(
      'MUNOZ PEREZ, JOSE - Ficha examenes e informes TAC - 2026-11-06.pdf'
    );
    expect(ctFileName('ANA', exam({ nombre_examen: 'TC tórax/abdomen' }))).toBe(
      'ANA - Informe TAC - 2026-11-03 - TC torax abdomen.pdf'
    );
  });

  it('numbers ZIP entries by part and never repeats a name', () => {
    expect(
      zipEntryNames([
        pdf('record', 'h.pdf'),
        pdf('lab', 'l.pdf'),
        pdf('ct', 't.pdf'),
        pdf('ct', 't.pdf'),
      ])
    ).toEqual(['1 h.pdf', '2 l.pdf', '3 t.pdf', '3 t (2).pdf']);
  });

  it('orders ficha, exámenes and TAC, and lists the parts with something missing', () => {
    const review = reviewDownload(['ct', 'lab', 'record'], {
      ct: outcome('complete', '1 informe', { documents: [pdf('ct', 't.pdf')] }),
      lab: outcome('empty', 'Sin informes'),
      record: outcome('failed', 'No incluida', { problem: 'Sin extensión' }),
    });
    expect(review.documents.map(document => document.fileName)).toEqual(['t.pdf']);
    expect(review.incomplete).toEqual(['record']);
    const ordered = reviewDownload(['ct', 'record'], {
      ct: outcome('complete', '1', { documents: [pdf('ct', 't.pdf')] }),
      record: outcome('complete', '1', { documents: [pdf('record', 'h.pdf')] }),
    });
    expect(ordered.documents.map(document => document.part)).toEqual(['record', 'ct']);
    expect(ordered.incomplete).toEqual([]);
  });
});
