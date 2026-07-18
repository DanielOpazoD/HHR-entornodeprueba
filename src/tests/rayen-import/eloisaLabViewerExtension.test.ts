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
        analysis: 'PCR respiratorio',
        result: 'POSITIVO',
        qualitative: true,
      }),
    ]);
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

  it('wires direct Syslab requests through expiring encounter-bound batches and exposes Lab', () => {
    const background = readFileSync(path.resolve('extension/background.js'), 'utf8');
    const content = readFileSync(path.resolve('extension/content-prescription-print.js'), 'utf8');
    const manifest = readFileSync(path.resolve('extension/manifest.json'), 'utf8');
    const bridge = readFileSync(path.resolve('extension/syslab-bridge.js'), 'utf8');
    const offscreen = readFileSync(path.resolve('extension/syslab-offscreen.js'), 'utf8');
    const offscreenHtml = readFileSync(path.resolve('extension/syslab-offscreen.html'), 'utf8');
    const login = readFileSync(path.resolve('extension/syslab-login.js'), 'utf8');
    const loginHtml = readFileSync(path.resolve('extension/syslab-login.html'), 'utf8');

    expect(background).not.toContain('localhost:3001');
    expect(background).toContain('LAB_BATCH_TTL_MS = 15 * 60 * 1000');
    expect(background).toContain('sweepExpiredLabBatches');
    expect(background).toContain('Puedes analizar como máximo 24 informes por operación.');
    expect(background).toContain('LAB_REPORT_TIMEOUT_MS = 90_000');
    expect(background).toContain('LAB_DETAILS_TIMEOUT_MS = 600_000');
    expect(background).toContain('searchSyslabDirectly');
    expect(background).toContain('[RUNTIME_MESSAGES.SYSLAB_STATUS_REQUEST]: runtimeRoute(');
    expect(background).toContain('[RUNTIME_MESSAGES.SYSLAB_LOGIN_REQUEST]: runtimeRoute(');
    expect(background).toContain('handleSyslabLoginRequest');
    expect(background).toContain("SYSLAB_OFFSCREEN_PATH = 'syslab-offscreen.html'");
    expect(background).toContain('chrome.offscreen.createDocument');
    expect(background).toContain("reasons: ['IFRAME_SCRIPTING']");
    expect(background).toContain('context.documentUrl === offscreenUrl');
    expect(background).toContain('const current = await readOffscreenContexts()');
    expect(background).toContain('sendToSyslabOffscreen');
    expect(background).not.toContain('SYSLAB_TAB_STORAGE_KEY');
    expect(background).not.toContain('focusSyslabTab');
    expect(background).toContain('previousBridgeId');
    expect(background).toContain('response.bridgeId !== previousBridgeId');
    expect(background).toContain('RAYEN_SYSLAB_READ_DETAILS');
    expect(background).toContain('linksByExamId');
    expect(background).toContain('[RUNTIME_MESSAGES.LAB_SEARCH_REQUEST]: runtimeRoute(');
    expect(background).toContain('[RUNTIME_MESSAGES.LAB_DETAILS_REQUEST]: runtimeRoute(');
    expect(background).toContain('validateDetailBatch');
    expect(background).toContain('linksByExamId');
    expect(background).toContain('const reportRequests = exams.map(exam => ({');
    expect(background).toContain('exams: reportRequests');
    expect(background).toContain('validateLabSenderEncounter');
    expect(background).toContain('examRowsMatchRut(payload.exams, rutBody)');
    expect(background).toContain(
      'Syslab no confirmó que los informes correspondan al RUN solicitado'
    );
    // The lab flow accepts the sender tab's own encounter (fast path) or any encounter present
    // in the active hospitalized census (shared patient picker); anything else is rejected.
    expect(background).toContain('senderEncounterId === String(expectedEncounterId');
    expect(background).toContain('await encounterInActiveCensus(expectedEncounterId, sender)');
    expect(background).toContain('no está en el censo de hospitalizados activo');
    expect(background).toContain(
      'handleLabDetailsRequest({ batchId: message.batchId, examIds: message.examIds, sender })'
    );
    expect(background).toContain(
      'handleLabPdfOpenRequest({ batchId: message.batchId, examId: message.examId, sender })'
    );
    expect(background).toContain('[RUNTIME_MESSAGES.LAB_PDF_OPEN_REQUEST]: runtimeRoute(');
    expect(background).toContain('base64: validation.pdfBase64');
    expect(background).toContain('print-pdf.html?job=');
    expect(background).not.toMatch(/17752753|SYSLAB_PASS|SYSLAB_USER/);
    expect(bridge).toContain("SYSLAB_ORIGIN = 'http://10.4.69.90'");
    expect(bridge).toContain("credentials: 'include'");
    expect(bridge).toContain('MAX_BODY_BYTES = 6 * 1024 * 1024');
    expect(bridge).toContain("import(chrome.runtime.getURL('pdf.min.mjs'))");
    expect(bridge).toContain('BRIDGE_ID = crypto.randomUUID()');
    expect(bridge).toContain("message.type === 'RAYEN_SYSLAB_LOGIN'");
    expect(bridge).toContain('extractRutBodyFromReportText');
    expect(bridge).toContain('includeValidatedPdf: true');
    expect(bridge).toContain('pdfBase64: detail.pdfBase64');
    expect(bridge).toContain("FRAME_REQUEST = 'HHR_SYSLAB_FRAME_REQUEST'");
    expect(bridge).toContain('event.origin !== EXTENSION_ORIGIN');
    expect(bridge).not.toMatch(/17752753|SYSLAB_PASS|SYSLAB_USER/);
    expect(offscreenHtml).toContain('src="http://10.4.69.90/syslab/"');
    expect(offscreenHtml).toContain('syslab-offscreen.js');
    expect(offscreen).toContain("REQUEST_TARGET = 'hhr-syslab-offscreen'");
    expect(offscreen).toContain('event.origin !== FRAME_ORIGIN');
    expect(offscreen).not.toContain('Math.min(1_500');
    expect(content).toContain('hhr-ops-lab');
    expect(content).toContain('hhr-syslab-login');
    expect(content).toContain("chrome.runtime.getURL('syslab-login.html')");
    expect(content).not.toContain('input name="password"');
    expect(loginHtml).toContain('No se guardan en la extensión');
    expect(login).toContain('type: runtimeMessages.SYSLAB_LOGIN_REQUEST');
    expect(login).toContain("candidate === 'https://fichamedico.rayensalud.cl'");
    expect(login).not.toContain('localStorage');
    expect(login).not.toContain('sessionStorage');
    expect(content).toContain("key: 'connection'");
    expect(content).toContain(
      "['scores', 'connection', 'lab', 'imaging', 'vitals', 'home'].includes(module)"
    );
    expect(content).toContain(
      "else if (activeModule === 'lab') renderLabRequestView(root, targetEncId)"
    );
    expect(content).toContain('else renderConnectionCenter(root, targetEncId)');
    expect(content).toContain('Comparación');
    expect(content).toContain('Tendencias');
    expect(content).toContain('Por informe');
    expect(content).toContain('requestGeneration');
    expect(content).toContain('invalidateLabAnalysis');
    expect(content).toContain("batchId = ''");
    expect(manifest).toContain('"lab-viewer.js"');
    expect(manifest).toContain('"syslab-bridge.js"');
    expect(manifest).toContain('"http://10.4.69.90/syslab/*"');
    expect(manifest).toContain('"offscreen"');
    expect(manifest).toContain('"all_frames": true');
    expect(manifest).toContain('"syslab-login.html"');
    expect(manifest).toContain('"version": "0.31.0"');
  });
});
