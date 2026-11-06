import { describe, expect, it } from 'vitest';
import type { AuditDocumentsResult } from '@/features/audit-documents/eloisa-history';
import {
  buildLabReportGroups,
  bundleFileName,
  ctFileName,
  defaultDownloadRange,
  describeCtPart,
  describeRecordPart,
  isVersionAtLeast,
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
import {
  countPendingInRange,
  parseHistorySummary,
  splitCtStudiesByDay,
} from '@/features/census/components/clinical-explorer/clinicalExplorerDownloadScope';
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
    // Reports Syslab has not delivered yet are missing results, never «sin informes».
    expect(
      planLabPart({ kind: 'ready', analysis, pendingDays: ['2026-11-06', ''] }, range)
    ).toEqual({
      outcome: expect.objectContaining({
        status: 'failed',
        problem: 'Syslab aún no entrega resultados de 2 informes del 06-11-2026.',
      }),
    });
    const wholeStay = { from: '2026-11-01', to: '2026-11-06' };
    expect(planLabPart({ kind: 'ready', analysis, pendingDays: [] }, wholeStay)).toEqual(
      expect.objectContaining({ summary: '2 informes del 01-11-2026 al 06-11-2026' })
    );
    expect(planLabPart({ kind: 'ready', analysis, pendingDays: [] }, wholeStay)).not.toHaveProperty(
      'partialProblem'
    );
    expect(
      planLabPart({ kind: 'ready', analysis, pendingDays: ['2026-11-03'] }, wholeStay)
    ).toEqual(
      expect.objectContaining({ partialProblem: 'Falta 1 informe que Syslab aún no entrega.' })
    );
    // A report pending outside the chosen days does not make this download partial.
    expect(
      planLabPart({ kind: 'ready', analysis, pendingDays: ['2026-10-20'] }, wholeStay)
    ).not.toHaveProperty('partialProblem');
    expect(planLabPart({ kind: 'ready', analysis, pendingDays: ['2026-10-20'] }, range)).toEqual({
      outcome: expect.objectContaining({ status: 'empty' }),
    });
  });

  it('waits while Syslab is asked and reports a session or read failure as such', () => {
    const base = { message: '', analysis: null, exams: [], pendingLinks: [], refreshing: false };
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
    expect(
      settleLabRead({
        ...base,
        phase: 'ready',
        analysis,
        exams: [
          {
            id: '9',
            link: 'syslab://9',
            date: '03/11/2026',
            time: '08:00:00',
            patientName: 'SINTÉTICO',
            origin: 'HOSP',
            exams: ['PCR'],
          },
        ],
        pendingLinks: ['syslab://9', 'syslab://unknown'],
      })
    ).toEqual({ kind: 'ready', analysis, pendingDays: ['2026-11-03', ''] });
  });

  it('waits while a cached Syslab read is renewed instead of taking what it had', () => {
    const renewing = { message: '', exams: [], pendingLinks: [], refreshing: true };
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
  const ADMISSION = '2026-11-01';
  const own = 'PACIENTE - 12345678-5 - Historial hospitalizacion - ingreso 2026-11-01.pdf';
  const other = 'PACIENTE - 12345678-5 - Historial hospitalizacion - ingreso 2026-10-25.pdf';
  const archive = (stays: Array<[string, string]>) => ({
    files: stays
      .filter(([, fileName]) => fileName)
      .map(([, fileName]) => ({ name: fileName, bytes: new Uint8Array([1]) })),
    stays: stays.map(([startDate, fileName]) => ({ startDate, fileName })),
  });
  const ok: AuditDocumentsResult = { ok: true, summary: [summaryRow({})] };

  it('takes only the history of the stay that starts on the admission day', () => {
    // A stay discharged that day (same-day readmission) also touches the day: it stays out.
    const part = describeRecordPart(
      ok,
      archive([
        [ADMISSION, own],
        ['2026-10-25', other],
      ]),
      ADMISSION
    );
    expect(part).toEqual(
      expect.objectContaining({ status: 'complete', summary: 'Historial de la hospitalización' })
    );
    expect(part.documents.map(document => document.fileName)).toEqual([own]);
  });

  it('includes nothing when two stays start that day, as a duplicate admission does', () => {
    const part = describeRecordPart(
      ok,
      archive([
        [ADMISSION, own],
        [
          ADMISSION,
          'PACIENTE - 12345678-5 - Historial hospitalizacion - ingreso 2026-11-01 (2).pdf',
        ],
      ]),
      ADMISSION
    );
    expect(part.status).toBe('failed');
    expect(part.documents).toEqual([]);
    expect(part.problem).toMatch(/2 hospitalizaciones de este RUT que empiezan el 01-11-2026/);
  });

  it('never takes the delivered stay when another one of that day failed to arrive', () => {
    const part = describeRecordPart(
      ok,
      archive([
        [ADMISSION, own],
        [ADMISSION, ''],
      ]),
      ADMISSION
    );
    expect(part.status).toBe('failed');
    expect(part.documents).toEqual([]);
  });

  it('names a stay that Eloísa listed but did not deliver, or did not list at all', () => {
    expect(describeRecordPart(ok, archive([[ADMISSION, '']]), ADMISSION).problem).toBe(
      'Eloísa no entregó el historial de esta hospitalización.'
    );
    expect(describeRecordPart(ok, archive([['2026-10-25', other]]), ADMISSION).problem).toMatch(
      /no muestra una hospitalización de este RUT que empiece el 01-11-2026/
    );
    expect(
      describeRecordPart(
        ok,
        { files: [{ name: own, bytes: new Uint8Array([1]) }], stays: null },
        ADMISSION
      ).problem
    ).toMatch(/no se puede comprobar a qué hospitalización corresponde/);
  });

  it('asks before going on when the history may be incomplete', () => {
    for (const gap of [{ incomplete: 1 }, { unverified: 1 }]) {
      const part = describeRecordPart(
        { ok: true, summary: [summaryRow({ hospitalizations: 1, ...gap })] },
        archive([[ADMISSION, own]]),
        ADMISSION
      );
      expect(part.status).toBe('partial');
      expect(part.documents).toHaveLength(1);
      expect(part.problem).toBe('La ficha de Eloísa puede estar incompleta (ver notas).');
    }
  });

  it('says an old extension saved the record apart instead of omitting it', () => {
    const part = describeRecordPart(
      { ok: true, filename: 'Auditoria_Eloisa.zip' },
      null,
      ADMISSION
    );
    expect(part.status).toBe('failed');
    expect(part.problem).toMatch(/anterior a la versión 0\.48\.71.*Auditoria_Eloisa\.zip/);
  });

  it('treats «no stay that day» and a failed Eloísa read as failures, never as an empty record', () => {
    expect(
      describeRecordPart(
        {
          ok: false,
          error: 'No hay hospitalizaciones',
          summary: [summaryRow({ hospitalizations: 0, downloaded: 0 })],
        },
        null,
        ADMISSION
      ).status
    ).toBe('failed');
    const failed = describeRecordPart(
      { ok: false, summary: [summaryRow({ hospitalizations: 0, error: 'HTTP 500' })] },
      null,
      ADMISSION
    );
    expect(failed).toEqual(
      expect.objectContaining({
        status: 'failed',
        problem: 'No se pudo consultar Eloísa: HTTP 500',
      })
    );
    expect(
      describeRecordPart({ ok: false, error: 'La extensión Eloísa no respondió.' }, null, ADMISSION)
        .problem
    ).toBe('La extensión Eloísa no respondió.');
    expect(
      describeRecordPart(
        {
          ok: false,
          error: 'No hay hospitalizaciones en las fechas pedidas.',
          summary: [summaryRow({ hospitalizations: 0, downloaded: 0, unverified: 1 })],
        },
        null,
        ADMISSION
      )
    ).toEqual(
      expect.objectContaining({
        status: 'failed',
        problem: 'Eloísa lista 1 hospitalización sin fecha o RUT verificable; revísalas allí.',
      })
    );
  });
});

describe('extension version and ZIP summary', () => {
  it('compares versions numerically and rejects unreadable ones', () => {
    expect(isVersionAtLeast('0.48.74', '0.48.71')).toBe(true);
    expect(isVersionAtLeast('0.48.71', '0.48.71')).toBe(true);
    expect(isVersionAtLeast('0.48.9', '0.48.71')).toBe(false);
    expect(isVersionAtLeast('0.49', '0.48.71')).toBe(true);
    expect(isVersionAtLeast('dev', '0.48.71')).toBe(false);
  });

  it('reads each listed stay and its file from the extension summary, quotes included', () => {
    const csv =
      '\uFEFFRUT;Nombre;Ingreso;Egreso;Documento;Resultado;Archivo\r\n' +
      '12.345.678-5;"PÉREZ; ANA";2026-11-01;En curso;Historial de hospitalización;Descargado;"a.pdf"\r\n' +
      '12.345.678-5;PÉREZ;2026-11-01;2026-11-01;Historial de hospitalización;No descargado: HTTP 500;\r\n' +
      '12.345.678-5;;;;;Sin hospitalizaciones en el periodo;\r\n';
    expect(parseHistorySummary(csv)).toEqual([
      { startDate: '2026-11-01', fileName: 'a.pdf' },
      { startDate: '2026-11-01', fileName: '' },
    ]);
    expect(parseHistorySummary('RUT;Nombre\r\n')).toBeNull();
  });

  it('keeps a stay whose quoted name spans lines, so a duplicate admission is never hidden', () => {
    const csv =
      '\uFEFFRUT;Nombre;Ingreso;Egreso;Documento;Resultado;Archivo\r\n' +
      '12.345.678-5;"Paciente\nSintetico";2026-11-01;2026-11-01;Historial de hospitalización;No descargado: HTTP 500;\r\n' +
      '12.345.678-5;PACIENTE;2026-11-01;En curso;Historial de hospitalización;Descargado;b.pdf\r\n';
    expect(parseHistorySummary(csv)).toEqual([
      { startDate: '2026-11-01', fileName: '' },
      { startDate: '2026-11-01', fileName: 'b.pdf' },
    ]);
    // A cell left open, or a document row without a readable «Ingreso», cannot be trusted.
    expect(parseHistorySummary(csv.replace('"Paciente', 'Paciente'))).toBeNull();
    expect(
      parseHistorySummary(
        'RUT;Nombre;Ingreso;Egreso;Documento;Resultado;Archivo\r\n1;A;;;Historial de hospitalización;Descargado;a.pdf\r\n'
      )
    ).toBeNull();
  });

  it('sets apart CT studies after a past census day and counts pending reports by range', () => {
    const before = exam({ nombre_examen: 'TC tórax', fecha_examen: '01/11/2026 09:00' });
    const after = exam({ nombre_examen: 'TC abdomen', fecha_examen: '05/11/2026 10:00' });
    expect(splitCtStudiesByDay([before, after], '2026-11-01')).toEqual({
      kept: [before],
      later: [after],
    });
    expect(splitCtStudiesByDay([before, after], null)).toEqual({
      kept: [before, after],
      later: [],
    });
    const range = { from: '2026-11-02', to: '2026-11-04' };
    expect(countPendingInRange(['2026-11-01', '2026-11-03', '', '2026-11-05'], range)).toBe(2);
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
