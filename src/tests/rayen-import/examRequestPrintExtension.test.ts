// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { Blob as NodeBlob } from 'node:buffer';
import path from 'node:path';
import { DecompressionStream as NodeDecompressionStream } from 'node:stream/web';
import vm from 'node:vm';

import { jsPDF } from 'jspdf';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';

const helperSource = readFileSync(path.resolve('extension/exam-request-print.js'), 'utf8');
const contentSource = readFileSync(path.resolve('extension/content-exam-request-print.js'), 'utf8');
const pdfSource = readFileSync(path.resolve('extension/exam-request-pdf.js'), 'utf8');
const backgroundSource = readFileSync(path.resolve('extension/background.js'), 'utf8');
const manifest = JSON.parse(readFileSync(path.resolve('extension/manifest.json'), 'utf8')) as {
  content_scripts?: Array<{ js?: string[] }>;
};

type OfficialRequest = {
  folio: string;
  orderId: string;
  requestDate: string;
  requiredDate: string;
  healthService: string;
  establishment: string;
  group?: string;
  patient: Record<string, string>;
  clinical: Record<string, string>;
  professional: Record<string, string>;
  tests: Array<{ code: string; name: string }>;
  sourcePageCount: number;
};

const loadHelpers = () => {
  const context = vm.createContext({
    URL,
    Blob: NodeBlob,
    TextDecoder,
    DecompressionStream: NodeDecompressionStream,
    module: { exports: {} },
  });
  vm.runInContext(helperSource, context);
  return (
    context.module as {
      exports: {
        findExamRequestTable: (documentRef: Document) => HTMLTableElement | null;
        collectExamRequests: (table: HTMLTableElement) => Array<Record<string, string>>;
        resolveEncounterId: (url: string) => string;
        validateSelection: (values: string[]) => { valid: boolean };
        extractOfficialExamRequestContent: (buffer: ArrayBuffer) => Promise<OfficialRequest | null>;
      };
    }
  ).exports;
};

const loadPdfGenerator = () => {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(pdfSource, context);
  return (
    context.module as {
      exports: {
        generateIntegratedExamRequestPdf: (
          data: { requests: OfficialRequest[] },
          constructor: typeof jsPDF
        ) => ArrayBuffer;
      };
    }
  ).exports;
};

const buildOfficialRequestPdf = (
  orderId: string,
  tests: Array<{ code: string; name: string }>,
  clinical?: { diagnosisLines?: string[]; healthProblemLines?: string[] }
) => {
  const document = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'letter',
    compress: true,
  });
  const at = (value: string, x: number, pdfY: number) => document.text(value, x, 792 - pdfY);
  at('Fecha Solicitud:', 20, 685.41);
  at('15', 104.44, 685.41);
  at('07', 127.44, 685.41);
  at('2026', 154.88, 685.41);
  at('Fecha requerida de toma:', 380.5, 685.41);
  at('15', 506.44, 685.41);
  at('07', 529.44, 685.41);
  at('2026', 556.88, 685.41);
  at('1. Servicio de Salud', 20, 662.41);
  at('Servicio de Salud Metropolitano Oriente', 22, 647.41);
  at('2. Establecimiento', 300, 662.41);
  at('Hospital Hanga Roa (Isla De Pascua)', 302, 647.41);
  at('Primer Apellido', 20, 591.66);
  at('Pakarati', 20, 604.2);
  at('Segundo Apellido', 200, 591.66);
  at('Arevalo', 200, 604.2);
  at('Nombres', 400, 590.66);
  at('Osvaldo Santiago', 400, 604.2);
  at('RUN', 20, 556.41);
  at('11.736.986-2', 20, 573.91);
  at('Previsión', 20, 528.66);
  at('Fonasa C', 20, 541.2);
  at('Sexo', 20, 500.66);
  at('Hombre', 20, 512.2);
  at('Fecha de Nacimiento', 200, 500.66);
  at('25-07-1969', 200, 512.2);
  at('Edad', 400, 500.66);
  at('56 año(s)', 400, 512.2);
  at(`ELO-${orderId}`, 538.31, 761.62);
  at('Hipótesis diagnóstica:', 21, 453.91);
  (clinical?.diagnosisLines || ['INSUFICIENCIA CARDIACA DESCOMPENSADA']).forEach((line, index) => {
    at(line, index === 0 ? 131 : 21, 453.91 - index * 8);
  });
  at('¿Es GES?', 20, 437.62);
  at('NO', 22.5, 413.91);
  at('X', 46.67, 413.91);
  at('SI', 65.28, 413.91);
  at('Problema de Salud:', 132.18, 413.91);
  (clinical?.healthProblemLines || []).forEach((line, index) => {
    at(line, index === 0 ? 245 : 132.18, 413.91 - index * 8);
  });
  at('Observaciones Clínicas:', 20, 393.91);
  at('Se solicitan las siguientes pruebas de Laboratorio:', 20, 369.41);
  tests.forEach((test, index) => {
    at(`${test.code} - ${test.name} - Prueba de laboratorio`, 20, 352.62 - index * 18);
  });
  at('DATOS DEL (LA) PROFESIONAL', 20, 191.62);
  at('Primer Apellido', 20, 151.66);
  at('Salfate', 20, 165.2);
  at('Segundo Apellido', 200, 151.66);
  at('Nombres', 400, 151.66);
  at('Valeria', 400, 165.2);
  at('RUN', 20, 117.66);
  at('17.723.202-5', 20, 130.2);
  return document.output('arraybuffer');
};

const extractText = async (buffer: ArrayBuffer) => {
  const pdf = await getDocument({
    data: new Uint8Array(buffer),
    standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts') + path.sep,
    useWorkerFetch: false,
  }).promise;
  return Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items.map(item => ('str' in item ? item.str : '')).join(' ');
    })
  );
};

describe('integrated laboratory-request extension', () => {
  it('finds only primary request rows and keeps order metadata', () => {
    document.body.innerHTML = `
      <table>
        <thead><tr><th>Grupo de exámenes</th><th>Nro. Orden</th><th>Estado Orden</th><th>Fecha solicitud</th><th>Examen(es)</th><th>Observaciones</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          <tr><td>SANGRE, BIOQUÍMICOS</td><td>27241</td><td>Realizado</td><td>15-07-2026</td><td>Bilirrubina</td><td></td><td>Realizado</td><td></td></tr>
          <tr><td></td><td></td><td></td><td></td><td>Creatinina</td><td></td><td>Realizado</td><td></td></tr>
          <tr><td>SANGRE, HEMATOLOGÍA</td><td>27240</td><td>Realizado</td><td>15-07-2026</td><td>Hemograma</td><td></td><td>Realizado</td><td></td></tr>
        </tbody>
      </table>
    `;
    const helpers = loadHelpers();
    const table = helpers.findExamRequestTable(document) as HTMLTableElement;

    expect(helpers.collectExamRequests(table)).toEqual([
      { orderId: '27241', group: 'SANGRE, BIOQUÍMICOS', date: '15-07-2026' },
      { orderId: '27240', group: 'SANGRE, HEMATOLOGÍA', date: '15-07-2026' },
    ]);
  });

  it('accepts both patient routes and bounds selection to 2-3 numeric orders', () => {
    const helpers = loadHelpers();

    expect(
      helpers.resolveEncounterId(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list/141435'
      )
    ).toBe('141435');
    expect(
      helpers.resolveEncounterId(
        'https://fichamedico.rayensalud.cl/dashboard/encounter-list-nurse/141435'
      )
    ).toBe('141435');
    expect(helpers.resolveEncounterId('https://example.com/dashboard/encounter-list/141435')).toBe(
      ''
    );
    expect(helpers.validateSelection(['27241', '27240']).valid).toBe(true);
    expect(helpers.validateSelection(['27241']).valid).toBe(false);
    expect(helpers.validateSelection(['1', '2', '3', '4']).valid).toBe(false);
  });

  it('renders the integrated action and sends selected order groups', async () => {
    document.body.innerHTML = `
      <table>
        <thead><tr><th>Grupo de exámenes</th><th>Nro. Orden</th><th>Estado Orden</th><th>Fecha solicitud</th><th>Examen(es)</th><th>Observaciones</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          <tr><td>BIOQUÍMICOS</td><td>27241</td><td>Realizado</td><td>15-07-2026</td><td>Bilirrubina</td><td></td><td>Realizado</td><td></td></tr>
          <tr><td>HEMATOLOGÍA</td><td>27240</td><td>Realizado</td><td>15-07-2026</td><td>Hemograma</td><td></td><td>Realizado</td><td></td></tr>
        </tbody>
      </table>
    `;
    const helpers = loadHelpers();
    let respond: ((value: { ok: boolean }) => void) | undefined;
    const sendMessage = vi.fn((_message, callback) => {
      respond = callback;
    });
    Object.assign(globalThis, {
      HhrExamRequestPrintUi: { ...helpers, resolveEncounterId: () => '141435' },
      chrome: { runtime: { lastError: undefined, sendMessage } },
    });
    delete (window as Window & { __hhrExamRequestPrintInjected?: boolean })
      .__hhrExamRequestPrintInjected;

    vm.runInThisContext(contentSource);
    await new Promise(resolve => window.setTimeout(resolve, 120));
    const button = document.querySelector<HTMLButtonElement>(
      '#hhr-exam-request-print-control button'
    );
    expect(button?.textContent).toContain('Imprimir selección');
    button?.click();
    document.querySelector<HTMLButtonElement>('.hhr-exam-submit')?.click();
    await Promise.resolve();

    const overlay = document.getElementById('hhr-exam-request-print-modal');
    const cancel = document.querySelector<HTMLButtonElement>('.hhr-exam-cancel');
    expect(cancel?.disabled).toBe(true);
    overlay?.click();
    expect(overlay?.isConnected).toBe(true);

    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: 'RAYEN_EXAM_REQUEST_COMBINE_PRINT_REQUEST',
        encId: '141435',
        diteIds: ['27241', '27240'],
        requests: [
          { orderId: '27241', group: 'BIOQUÍMICOS' },
          { orderId: '27240', group: 'HEMATOLOGÍA' },
        ],
      },
      expect.any(Function)
    );
    respond?.({ ok: true });
    await Promise.resolve();
    expect(overlay?.isConnected).toBe(false);
    document.querySelector('table')?.remove();
    await new Promise(resolve => window.setTimeout(resolve, 120));
    expect(document.getElementById('hhr-exam-request-print-control')).toBeNull();
    (
      window as Window & { __hhrExamRequestPrintObserver?: MutationObserver }
    ).__hhrExamRequestPrintObserver?.disconnect();
  });

  it('extracts complete clinical fields and test codes from an official-style Jasper PDF', async () => {
    const helpers = loadHelpers();
    const extracted = await helpers.extractOfficialExamRequestContent(
      buildOfficialRequestPdf('27241', [
        { code: '302013', name: 'Bilirrubina Directa' },
        { code: '302023', name: 'Creatinina en Sangre' },
      ])
    );

    expect(extracted).toMatchObject({
      folio: 'ELO-27241',
      requestDate: '15-07-2026',
      requiredDate: '15-07-2026',
      patient: { name: 'Osvaldo Santiago Pakarati Arevalo', run: '11.736.986-2' },
      clinical: { diagnosis: 'INSUFICIENCIA CARDIACA DESCOMPENSADA', ges: 'NO' },
      professional: { name: 'Valeria Salfate', run: '17.723.202-5' },
    });
    expect(extracted?.tests).toEqual([
      { code: '302013', name: 'Bilirrubina Directa' },
      { code: '302023', name: 'Creatinina en Sangre' },
    ]);
  });

  it('preserves wrapped diagnosis and health-problem lines from the official PDF', async () => {
    const helpers = loadHelpers();
    const extracted = await helpers.extractOfficialExamRequestContent(
      buildOfficialRequestPdf('27241', [{ code: '302013', name: 'Bilirrubina Directa' }], {
        diagnosisLines: ['INSUFICIENCIA CARDIACA', 'DESCOMPENSADA CONGESTIVA'],
        healthProblemLines: ['CARDIOPATÍA CRÓNICA', 'EN DESCOMPENSACIÓN'],
      })
    );

    expect(extracted?.clinical).toMatchObject({
      diagnosis: 'INSUFICIENCIA CARDIACA DESCOMPENSADA CONGESTIVA',
      healthProblem: 'CARDIOPATÍA CRÓNICA EN DESCOMPENSACIÓN',
    });
  });

  it('generates a new one-page document and deduplicates shared clinical data', async () => {
    const helpers = loadHelpers();
    const first = await helpers.extractOfficialExamRequestContent(
      buildOfficialRequestPdf('27241', [
        { code: '302013', name: 'Bilirrubina Directa' },
        { code: '302023', name: 'Creatinina en Sangre' },
      ])
    );
    const second = await helpers.extractOfficialExamRequestContent(
      buildOfficialRequestPdf('27240', [
        { code: '301045', name: 'Hemograma' },
        { code: '301059', name: 'Protrombina, tiempo de o consumo de (incluye INR)' },
      ])
    );
    expect(first && second).toBeTruthy();
    const generator = loadPdfGenerator();
    const output = generator.generateIntegratedExamRequestPdf(
      {
        requests: [
          { ...(first as OfficialRequest), group: 'SANGRE, EXÁMENES BIOQUÍMICOS' },
          { ...(second as OfficialRequest), group: 'SANGRE, HEMATOLOGÍA' },
        ],
      },
      jsPDF
    );
    const pdf = await PDFDocument.load(output);
    const pages = await extractText(output);
    const text = pages.join(' ');

    expect(pdf.getPageCount()).toBe(1);
    expect(text).toContain('SOLICITUD DE EXÁMENES');
    expect(text).toContain('302013');
    expect(text).toContain('301045');
    expect(text.match(/INSUFICIENCIA CARDIACA DESCOMPENSADA/g)).toHaveLength(1);
    expect(text.match(/Valeria Salfate/g)).toHaveLength(1);
    expect(text).not.toContain('Órdenes:');

    const differingProfessionalOutput = generator.generateIntegratedExamRequestPdf(
      {
        requests: [
          { ...(first as OfficialRequest), group: 'BIOQUÍMICOS' },
          {
            ...(second as OfficialRequest),
            group: 'HEMATOLOGÍA',
            professional: {
              ...second?.professional,
              name: 'Segundo Profesional',
              run: '9.999.999-9',
            },
          },
        ],
      },
      jsPDF
    );
    const differingProfessionalText = (await extractText(differingProfessionalOutput)).join(' ');
    expect(differingProfessionalText).toContain('Solicitante: Valeria Salfate - RUN 17.723.202-5');
    expect(differingProfessionalText).toContain(
      'Solicitante: Segundo Profesional - RUN 9.999.999-9'
    );

    expect(() =>
      generator.generateIntegratedExamRequestPdf(
        {
          requests: [
            first as OfficialRequest,
            {
              ...(second as OfficialRequest),
              patient: { ...second?.patient, birthDate: '01-01-1970' },
            },
          ],
        },
        jsPDF
      )
    ).toThrow(/identificación demográfica/);
  });

  it('continues legibly when the integrated examination list exceeds one sheet', async () => {
    const helpers = loadHelpers();
    const base = await helpers.extractOfficialExamRequestContent(
      buildOfficialRequestPdf('27241', [{ code: '302013', name: 'Bilirrubina Directa' }])
    );
    expect(base).toBeTruthy();
    const longTests = Array.from({ length: 70 }, (_, index) => ({
      code: String(300000 + index),
      name: `Examen clínico de control número ${index + 1} con descripción completa`,
    }));
    const generator = loadPdfGenerator();
    const output = generator.generateIntegratedExamRequestPdf(
      {
        requests: [
          { ...(base as OfficialRequest), group: 'BIOQUÍMICOS', tests: longTests.slice(0, 35) },
          {
            ...(base as OfficialRequest),
            orderId: '27240',
            folio: 'ELO-27240',
            group: 'HEMATOLOGÍA',
            tests: longTests.slice(35),
          },
        ],
      },
      jsPDF
    );
    const pages = await extractText(output);

    expect(pages.length).toBeGreaterThan(1);
    pages.forEach(page => expect(page.replace(/\s+/g, ' ')).toContain('RUN 11.736.986-2'));
    expect(pages.join(' ')).toContain('300069');
    pages
      .filter(page => page.includes('300035'))
      .forEach(page => expect(page).toContain('ELO-27240'));
  });

  it('declares the UI, patient-bound message, extraction and integrated-PDF contracts', () => {
    const scripts = (manifest.content_scripts || []).flatMap(entry => entry.js || []);

    expect(scripts).toContain('exam-request-print.js');
    expect(scripts).toContain('content-exam-request-print.js');
    expect(contentSource).toContain('Imprimir selección (2–3 órdenes)');
    expect(contentSource).toContain('RAYEN_EXAM_REQUEST_COMBINE_PRINT_REQUEST');
    expect(backgroundSource).toContain('/api/report/Orden_Examen_Hospitalario.pdf');
    expect(backgroundSource).toContain("senderEncounterId !== String(encId || '')");
    expect(backgroundSource).toContain('extractOfficialExamRequestContent');
    expect(backgroundSource).toContain('generateIntegratedExamRequestPdf');
    expect(backgroundSource).not.toContain('imposePdfBuffers');
    expect(helperSource).toContain('lineX += Number(translation[1])');
    expect(helperSource).toContain('lineY += Number(translation[2])');
    expect(pdfSource).not.toContain('doc.setFillColor(black');
    expect(pdfSource).not.toContain('doc.setTextColor(255, 255, 255)');
    expect(pdfSource).not.toContain("'Órdenes:");
    expect(pdfSource).toContain('doc.splitTextToSize(commonProblem, contentWidth - 96)');
    expect(pdfSource).toContain('problemLines.length * 8 + 4');
    expect(pdfSource).toContain('ensureSpace(23 + difference.height + 14 + firstRowHeight)');
    expect(pdfSource).toContain('ensureSpace(index === 0 ? 49 : 35)');
  });
});
