// @vitest-environment node
import { describe, expect, it } from 'vitest';

import '../../../extension/lab-result-parser.js';
import '../../../extension/lab-viewer.js';

interface LabFinding {
  section: string;
  analysis: string;
  result: string;
  unit: string;
  refValue: string;
}

interface LabViewerApi {
  normalizePatientRutBody: (value: string) => string;
  normalizeRutBody: (value: string) => string;
  extractRutBodyFromReportText: (value: string) => string;
  parseReportText: (value: string) => LabFinding[];
  examRowsMatchRut: (exams: unknown[], expectedRutBody: string) => boolean;
  findingAlert: (finding: LabFinding) => boolean;
  sanitizeExamList: (value: unknown[]) => Array<{ id: string }>;
  validateDetailBatch: (
    details: Array<{ examId: string; rutBody: string; findings: LabFinding[]; error?: string }>,
    expectedExamIds: string[],
    expectedRutBody: string
  ) => Array<{ examId: string; rutBody: string; findings: LabFinding[]; error?: string }> | null;
  comparisonClipboard: (analysis: ReturnType<LabViewerApi['buildAnalysis']>) => string;
  buildAnalysis: (
    details: Array<{ examId: string; findings: LabFinding[] }>,
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
describe('native Eloisa laboratory viewer', () => {
  it('uses only the numeric RUT body expected by Syslab', () => {
    expect(labViewer.normalizeRutBody('17.752.753-2')).toBe('17752753');
    expect(labViewer.normalizeRutBody(' 10.096.004-4 ')).toBe('10096004');
    expect(labViewer.normalizePatientRutBody('8.528.847-4')).toBe('8528847');
    expect(labViewer.normalizePatientRutBody('85288474')).toBe('8528847');
    expect(labViewer.normalizePatientRutBody('8528847')).toBe('8528847');
  });

  it('parses the Syslab report text locally and extracts its patient RUN', () => {
    const report = [
      'HOSPITAL DE HANGA ROA',
      'Nombre : Paciente Uno',
      'Rut/Fic : 17.752.753-2',
      'BIOQUIMICA',
      'Glicemia : 138 mg/dL 70 - 100',
      'Exceso de base : -5 mmol/L -2 - 2',
      'INR : 1,1 0,8 - 1,2',
      'Eritrocitos : 4.500.000 /uL 4.000.000 - 5.000.000',
      'PCR respiratorio : POSITIVO',
    ].join('\n');

    expect(labViewer.extractRutBodyFromReportText(report)).toBe('17752753');
    expect(labViewer.parseReportText(report)).toEqual([
      expect.objectContaining({ analysis: 'Glicemia', result: '138', unit: 'mg/dL' }),
      expect.objectContaining({
        analysis: 'Exceso de base',
        result: '-5',
        unit: 'mmol/L',
        refValue: '-2 - 2',
      }),
      expect.objectContaining({ analysis: 'INR', result: '1,1', unit: '', refValue: '0,8 - 1,2' }),
      expect.objectContaining({
        analysis: 'Eritrocitos',
        result: '4.500.000',
        unit: '/uL',
        refValue: '4.000.000 - 5.000.000',
      }),
      expect.objectContaining({
        analysis: 'PCR respiratorio',
        result: 'POSITIVO',
        qualitative: true,
      }),
    ]);
  });

  it('keeps urine leukocytes separate and parses dotted hepatic thousands contextually', () => {
    const report = [
      'PERFIL HEPATICO',
      'GGT : +1.720 U/L 10 - 71',
      'Fosfatasa Alcalina : 1.071 U/L 40 - 129',
      'SEDIMENTO URINARIO',
      'Leucocitos : 0 x campo 0 - 5',
    ].join('\n');

    const findings = labViewer.parseReportText(report);

    expect(findings).toEqual([
      expect.objectContaining({ section: 'PERFIL HEPATICO', analysis: 'GGT', result: '+1.720' }),
      expect.objectContaining({
        section: 'PERFIL HEPATICO',
        analysis: 'Fosfatasa Alcalina',
        result: '1.071',
      }),
      expect.objectContaining({
        section: 'SEDIMENTO URINARIO',
        analysis: 'Leucocitos',
        result: '0',
      }),
    ]);

    const exams = [
      { id: '1', date: '11/07/2026', time: '00:09:00', exams: ['PERFIL HEPATICO'] },
      { id: '2', date: '16/07/2026', time: '07:42:00', exams: ['PERFIL HEPATICO'] },
    ];
    const analysis = labViewer.buildAnalysis(
      [
        { examId: '1', findings: findings.slice(0, 2) },
        {
          examId: '2',
          findings: [
            {
              section: 'PERFIL HEPATICO',
              analysis: 'GGT',
              result: '946',
              unit: 'U/L',
              refValue: '10 - 71',
            },
            {
              section: 'PERFIL HEPATICO',
              analysis: 'Fosfatasa Alcalina',
              result: '682',
              unit: 'U/L',
              refValue: '40 - 129',
            },
          ],
        },
      ],
      exams
    );

    expect(analysis.trends.find(trend => trend.analysis === 'GGT')?.points[0]?.value).toBe(1720);
    expect(
      analysis.trends.find(trend => trend.analysis === 'Fosfatasa Alcalina')?.points[0]?.value
    ).toBe(1071);
  });

  it('filters malformed search rows before creating a patient-bound selection', () => {
    const exams = labViewer.sanitizeExamList([
      {
        id: '43092446',
        date: '02/05/2026',
        time: '06:09:55',
        patientName: 'Paciente Uno',
        origin: 'HOSPITALIZADO',
        exams: ['HEMOGRAMA'],
      },
      {
        id: 'not-an-id',
        date: '02/05/2026',
        exams: [],
      },
    ]);

    expect(exams).toEqual([expect.objectContaining({ id: '43092446' })]);
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
      labViewer.findingAlert({
        ...finding('1.500', '1.000 - 2.000'),
        analysis: 'Enzima agrupada',
        unit: 'U/L |',
      })
    ).toBe(false);
    expect(
      labViewer.findingAlert({
        ...finding('0.125', '0.001 - 0.250'),
        analysis: 'Actividad enzimática fraccionaria',
        unit: 'U/L',
      })
    ).toBe(false);
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
    const first = '1';
    const second = '2';
    const details = [
      { examId: second, rutBody: '17752753', findings: [] },
      { examId: first, rutBody: '17752753', findings: [] },
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
          { examId: first, rutBody: '17752753', findings: [] },
          { examId: 'not-selected', rutBody: '17752753', findings: [] },
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
      date: '01/05/2026',
      time: '08:00:00',
      patientName: 'Paciente Uno',
      origin: 'HOSPITALIZADO',
      exams: ['ORINA'],
    };
    const analysis = labViewer.buildAnalysis(
      [
        {
          examId: exam.id,
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
        date: '01/05/2026',
        time: '08:00:00',
        patientName: 'Paciente Uno',
        origin: 'HOSPITALIZADO',
        exams: ['QUIMICA'],
      },
      {
        id: '2',
        date: '02/05/2026',
        time: '08:00:00',
        patientName: 'Paciente Uno',
        origin: 'HOSPITALIZADO',
        exams: ['QUIMICA'],
      },
    ];
    const details = [
      {
        examId: exams[0].id,
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
          {
            section: 'BIOQUIMICA',
            analysis: 'Albumina',
            result: '3,2',
            unit: 'g/dL',
            refValue: '3,5 - 5,2',
          },
          {
            section: 'ALBUMINURIA',
            analysis: 'Albumina',
            result: '44,7',
            unit: 'mg/L',
            refValue: '<30',
          },
        ],
      },
      {
        examId: exams[1].id,
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
          {
            section: 'BIOQUIMICA',
            analysis: 'Albumina',
            result: '3,1',
            unit: 'g/dL',
            refValue: '3,5 - 5,2',
          },
          {
            section: 'ALBUMINURIA',
            analysis: 'Albumina',
            result: '22,1',
            unit: 'mg/L',
            refValue: '<30',
          },
        ],
      },
    ];

    const analysis = labViewer.buildAnalysis(details, exams);

    expect(analysis.comparison.filter(row => row.analysis === 'pH')).toHaveLength(2);
    expect(analysis.trends.filter(trend => trend.analysis === 'pH')).toHaveLength(1);
    expect(analysis.trends.filter(trend => trend.analysis === 'Albumina')).toEqual([
      expect.objectContaining({
        unit: 'g/dL',
        points: [expect.objectContaining({ value: 3.2 }), expect.objectContaining({ value: 3.1 })],
      }),
    ]);
    expect(analysis.trends.some(trend => trend.analysis === 'Troponina')).toBe(false);
    const clipboard = labViewer.comparisonClipboard(analysis);
    expect(clipboard).toContain('pH · SANGRE');
    expect(clipboard).toContain('pH · ORINA');
  });

  it('treats both creatinuria spellings as urine in the native trends', () => {
    const exams = [
      { id: '1', date: '01/05/2026', time: '08:00:00', exams: ['ORINA'] },
      { id: '2', date: '02/05/2026', time: '08:00:00', exams: ['ORINA'] },
    ];
    const details = exams.map(exam => ({
      examId: exam.id,
      findings: [
        {
          section: 'CREATINURIA',
          analysis: 'Albumina',
          result: '20',
          unit: 'mg/L',
          refValue: '<30',
        },
      ],
    }));

    expect(labViewer.buildAnalysis(details, exams).trends).toEqual([]);
  });

  it('organizes selected reports into comparison, alerts and numeric trends', () => {
    const exams = [
      {
        id: '1',
        date: '01/05/2026',
        time: '08:00:00',
        patientName: 'Paciente Uno',
        origin: 'HOSPITALIZADO',
        exams: ['HEMOGRAMA'],
      },
      {
        id: '2',
        date: '02/05/2026',
        time: '08:00:00',
        patientName: 'Paciente Uno',
        origin: 'HOSPITALIZADO',
        exams: ['HEMOGRAMA'],
      },
    ];
    const details = exams.map((exam, index) => ({
      examId: exam.id,
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
});
