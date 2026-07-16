// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import '../../../extension/lab-viewer.js';

interface LabFinding {
  section: string;
  analysis: string;
  result: string;
  unit: string;
  refValue: string;
}

interface LabViewerApi {
  normalizeRutBody: (value: string) => string;
  examRowsMatchRut: (exams: unknown[], expectedRutBody: string) => boolean;
  isAllowedSyslabLink: (value: string) => boolean;
  findingAlert: (finding: LabFinding) => boolean;
  sanitizeExamList: (value: unknown[]) => Array<{ id: string; link: string }>;
  validateDetailBatch: (
    details: Array<{ url: string; rutBody: string; findings: LabFinding[]; error?: string }>,
    expectedLinks: string[],
    expectedRutBody: string
  ) => Array<{ url: string; rutBody: string; findings: LabFinding[]; error?: string }> | null;
  comparisonClipboard: (analysis: ReturnType<LabViewerApi['buildAnalysis']>) => string;
  buildAnalysis: (
    details: Array<{ url: string; findings: LabFinding[] }>,
    exams: unknown[]
  ) => {
    columns: Array<{ key: string }>;
    comparison: Array<{
      analysis: string;
      values: Record<string, LabFinding & { alert: boolean }>;
    }>;
    trends: Array<{ analysis: string; points: Array<{ value: number }> }>;
    summary: { reportCount: number; findingCount: number; alertCount: number };
  };
}

const labViewer = (globalThis as unknown as { HhrLabViewer: LabViewerApi }).HhrLabViewer;
const syslabLink = (id: string) =>
  `http://10.4.69.90/syslab/detalleexamenes.php?id=${id}&user=session`;

describe('native Eloisa laboratory viewer', () => {
  it('uses only the numeric RUT body expected by Syslab', () => {
    expect(labViewer.normalizeRutBody('17.752.753-2')).toBe('17752753');
    expect(labViewer.normalizeRutBody(' 10.096.004-4 ')).toBe('10096004');
  });

  it('rejects report links outside the private Syslab report route', () => {
    expect(labViewer.isAllowedSyslabLink(syslabLink('43092446'))).toBe(true);
    expect(labViewer.isAllowedSyslabLink('http://10.4.69.90/admin/export.php')).toBe(false);
    expect(
      labViewer.isAllowedSyslabLink('http://10.4.69.90/syslab/archive/detalleexamenes.php?id=1')
    ).toBe(false);
    expect(
      labViewer.isAllowedSyslabLink(
        'http://embedded-user@10.4.69.90/syslab/detalleexamenes.php?id=1'
      )
    ).toBe(false);
    expect(labViewer.isAllowedSyslabLink('https://evil.example/syslab/detalleexamenes.php')).toBe(
      false
    );
    expect(labViewer.isAllowedSyslabLink('file:///etc/passwd')).toBe(false);
  });

  it('filters malformed search rows before creating a patient-bound selection', () => {
    const exams = labViewer.sanitizeExamList([
      {
        id: '43092446',
        link: syslabLink('43092446'),
        date: '02/05/2026',
        time: '06:09:55',
        patientName: 'Paciente Uno',
        origin: 'HOSPITALIZADO',
        exams: ['HEMOGRAMA'],
      },
      {
        id: 'not-an-id',
        link: 'http://example.test/report',
        date: '02/05/2026',
        exams: [],
      },
    ]);

    expect(exams).toEqual([
      expect.objectContaining({ id: '43092446', link: syslabLink('43092446') }),
    ]);
  });

  it('requires every Syslab search row to carry the requested RUN', () => {
    const rows = [
      { id: '1', rutBody: '17.752.753-2' },
      { id: '2', rutBody: '17752753' },
    ];

    expect(labViewer.examRowsMatchRut(rows, '17752753')).toBe(true);
    expect(labViewer.examRowsMatchRut([{ id: '1', rutBody: '10096004' }], '17752753')).toBe(false);
    expect(labViewer.examRowsMatchRut([{ id: '1' }], '17752753')).toBe(false);
  });

  it('keeps the 100 newest valid reports when Syslab returns a larger history', () => {
    const history = Array.from({ length: 101 }, (_, index) => ({
      id: String(index + 1),
      link: syslabLink(String(index + 1)),
      date: index === 100 ? '02/05/2026' : '01/05/2026',
      time: '08:00:00',
      exams: ['HEMOGRAMA'],
    }));

    const exams = labViewer.sanitizeExamList(history);

    expect(exams).toHaveLength(100);
    expect(exams[0]).toEqual(expect.objectContaining({ id: '101' }));
    expect(exams.some(exam => exam.id === '100')).toBe(false);
  });

  it('marks numeric ranges, one-sided bounds and qualitative alerts', () => {
    const finding = (result: string, refValue: string): LabFinding => ({
      section: 'BIOQUIMICA',
      analysis: 'Glicemia',
      result,
      unit: 'mg/dL',
      refValue,
    });

    expect(labViewer.findingAlert(finding('138', '70 - 100'))).toBe(true);
    expect(labViewer.findingAlert(finding('92', '70 - 100'))).toBe(false);
    expect(labViewer.findingAlert(finding('31', '< 30'))).toBe(true);
    expect(labViewer.findingAlert(finding('30', '< 30'))).toBe(true);
    expect(labViewer.findingAlert(finding('>200', '< 100'))).toBe(true);
    expect(labViewer.findingAlert(finding('<2', '3 - 5'))).toBe(true);
    expect(labViewer.findingAlert(finding('<=3', '>3'))).toBe(true);
    expect(labViewer.findingAlert(finding('<4', '3 - 5'))).toBe(false);
    expect(
      labViewer.findingAlert({ ...finding('POSITIVO', ''), analysis: 'PCR respiratorio' })
    ).toBe(false);
    expect(
      labViewer.findingAlert({ ...finding('POSITIVO', 'NEGATIVO'), analysis: 'PCR respiratorio' })
    ).toBe(true);
    expect(
      labViewer.findingAlert({ ...finding('POSITIVO', 'POSITIVO'), analysis: 'Grupo RhD' })
    ).toBe(false);
  });

  it('rejects incomplete or duplicated detail batches before analysis', () => {
    const first = syslabLink('1');
    const second = syslabLink('2');
    const details = [
      { url: second, rutBody: '17752753', findings: [] },
      { url: first, rutBody: '17752753', findings: [] },
    ];

    expect(labViewer.validateDetailBatch(details, [first, second], '17752753')).toEqual([
      details[1],
      details[0],
    ]);
    expect(labViewer.validateDetailBatch([details[0]], [first, second], '17752753')).toBeNull();
    expect(
      labViewer.validateDetailBatch([details[0], details[0]], [first, second], '17752753')
    ).toBeNull();
    expect(
      labViewer.validateDetailBatch(
        [
          { url: first, rutBody: '17752753', findings: [] },
          { url: 'http://example.test/report', rutBody: '17752753', findings: [] },
        ],
        [first, second],
        '17752753'
      )
    ).toBeNull();
    expect(
      labViewer.validateDetailBatch(
        [details[1], { ...details[0], rutBody: '10096004' }],
        [first, second],
        '17752753'
      )
    ).toBeNull();
    expect(
      labViewer.validateDetailBatch(
        [details[1], { ...details[0], error: 'PDF sin texto interpretable' }],
        [first, second],
        '17752753'
      )
    ).toBeNull();
  });

  it('does not rename individual findings from a ratio-like section', () => {
    const exam = {
      id: '1',
      link: syslabLink('1'),
      date: '01/05/2026',
      time: '08:00:00',
      patientName: 'Paciente Uno',
      origin: 'HOSPITALIZADO',
      exams: ['ORINA'],
    };
    const analysis = labViewer.buildAnalysis(
      [
        {
          url: exam.link,
          findings: [
            {
              section: 'ALBUMINURIA / CREATININURIA',
              analysis: 'Microalbuminuria',
              result: '20',
              unit: 'mg/L',
              refValue: '<30',
            },
            {
              section: 'ALBUMINURIA / CREATININURIA',
              analysis: 'Creatininuria',
              result: '100',
              unit: 'mg/dL',
              refValue: '70 - 140',
            },
          ],
        },
      ],
      [exam]
    );

    expect(analysis.comparison.map(row => row.analysis).sort()).toEqual([
      'Creatininuria',
      'Microalbuminuria',
    ]);
  });

  it('keeps different specimens and units separate and does not chart censored values', () => {
    const exams = [
      {
        id: '1',
        link: syslabLink('1'),
        date: '01/05/2026',
        time: '08:00:00',
        patientName: 'Paciente Uno',
        origin: 'HOSPITALIZADO',
        exams: ['QUIMICA'],
      },
      {
        id: '2',
        link: syslabLink('2'),
        date: '02/05/2026',
        time: '08:00:00',
        patientName: 'Paciente Uno',
        origin: 'HOSPITALIZADO',
        exams: ['QUIMICA'],
      },
    ];
    const details = [
      {
        url: exams[0].link,
        findings: [
          { section: 'SANGRE', analysis: 'pH', result: '7,40', unit: '', refValue: '7,35 - 7,45' },
          { section: 'ORINA', analysis: 'pH', result: '6,0', unit: '', refValue: '5,0 - 8,0' },
          {
            section: 'BIOQUIMICA',
            analysis: 'Troponina',
            result: '<0,01',
            unit: 'ng/mL',
            refValue: '<0,04',
          },
        ],
      },
      {
        url: exams[1].link,
        findings: [
          { section: 'SANGRE', analysis: 'pH', result: '7,41', unit: '', refValue: '7,35 - 7,45' },
          { section: 'ORINA', analysis: 'pH', result: '6,5', unit: '', refValue: '5,0 - 8,0' },
          {
            section: 'BIOQUIMICA',
            analysis: 'Troponina',
            result: '<0,01',
            unit: 'ng/mL',
            refValue: '<0,04',
          },
        ],
      },
    ];

    const analysis = labViewer.buildAnalysis(details, exams);

    expect(analysis.comparison.filter(row => row.analysis === 'pH')).toHaveLength(2);
    expect(analysis.trends.filter(trend => trend.analysis === 'pH')).toHaveLength(2);
    expect(analysis.trends.some(trend => trend.analysis === 'Troponina')).toBe(false);
    const clipboard = labViewer.comparisonClipboard(analysis);
    expect(clipboard).toContain('pH · SANGRE');
    expect(clipboard).toContain('pH · ORINA');
  });

  it('organizes selected reports into comparison, alerts and numeric trends', () => {
    const exams = [
      {
        id: '1',
        link: syslabLink('1'),
        date: '01/05/2026',
        time: '08:00:00',
        patientName: 'Paciente Uno',
        origin: 'HOSPITALIZADO',
        exams: ['HEMOGRAMA'],
      },
      {
        id: '2',
        link: syslabLink('2'),
        date: '02/05/2026',
        time: '08:00:00',
        patientName: 'Paciente Uno',
        origin: 'HOSPITALIZADO',
        exams: ['HEMOGRAMA'],
      },
    ];
    const details = exams.map((exam, index) => ({
      url: exam.link,
      findings: [
        {
          section: 'HEMOGRAMA',
          analysis: 'LEUCOCITOS',
          result: index === 0 ? '7,6' : '12,2',
          unit: 'x10^3/uL',
          refValue: '4,0 - 11,0',
        },
      ],
    }));

    const analysis = labViewer.buildAnalysis(details, exams);

    expect(analysis.summary).toEqual({ reportCount: 2, findingCount: 2, alertCount: 1 });
    expect(analysis.columns.map(column => column.key)).toEqual(['1', '2']);
    expect(analysis.comparison[0].analysis).toBe('Recuento Leucocitos');
    expect(analysis.comparison[0].values['2'].alert).toBe(true);
    expect(analysis.trends).toEqual([
      expect.objectContaining({
        analysis: 'Recuento Leucocitos',
        points: [expect.objectContaining({ value: 7.6 }), expect.objectContaining({ value: 12.2 })],
      }),
    ]);
  });

  it('wires local-only requests through expiring background batches and exposes Lab in the bar', () => {
    const background = readFileSync(path.resolve('extension/background.js'), 'utf8');
    const content = readFileSync(path.resolve('extension/content-prescription-print.js'), 'utf8');
    const manifest = readFileSync(path.resolve('extension/manifest.json'), 'utf8');

    expect(background).toContain("SYSLAB_LOCAL_ORIGIN = 'http://localhost:3001'");
    expect(background).toContain('LAB_BATCH_TTL_MS = 15 * 60 * 1000');
    expect(background).toContain('sweepExpiredLabBatches');
    expect(background).toContain('Puedes analizar como máximo 24 informes por operación.');
    expect(background).toContain('25_000');
    expect(background).toContain('límite seguro de 6 MB');
    expect(background).toContain('RAYEN_LAB_SEARCH_REQUEST');
    expect(background).toContain('RAYEN_LAB_DETAILS_REQUEST');
    expect(background).toContain('validateDetailBatch');
    expect(background).toContain('rutBody: batchResult.batch.rutBody');
    expect(background).toContain('validateLabSenderEncounter');
    expect(background).toContain('examRowsMatchRut(payload.data, rutBody)');
    expect(background).toContain(
      'Syslab no confirmó que los informes correspondan al RUN solicitado'
    );
    expect(background).toContain('senderEncounterId !== String(expectedEncounterId');
    expect(background).toContain(
      'handleLabDetailsRequest({ batchId: msg.batchId, examIds: msg.examIds, sender })'
    );
    expect(background).toContain(
      'handleLabPdfOpenRequest({ batchId: msg.batchId, examId: msg.examId, sender })'
    );
    expect(background).toContain('RAYEN_LAB_PDF_OPEN_REQUEST');
    expect(background).toContain('print-pdf.html?job=');
    expect(background).not.toMatch(/17752753|SYSLAB_PASS|SYSLAB_USER/);
    expect(content).toContain('hhr-ops-lab');
    expect(content).toContain("key: 'connection'");
    expect(content).toContain("['scores', 'connection', 'lab'].includes(module)");
    expect(content).toContain("else if (activeModule === 'lab') renderLabCenter(root, encId)");
    expect(content).toContain('else renderConnectionCenter(root, encId)');
    expect(content).toContain('Comparación');
    expect(content).toContain('Tendencias');
    expect(content).toContain('Por informe');
    expect(content).toContain('requestGeneration');
    expect(content).toContain('invalidateLabAnalysis');
    expect(content).toContain("batchId = ''");
    expect(manifest).toContain('"lab-viewer.js"');
    expect(manifest).toContain('"version": "0.24.1"');
  });
});
