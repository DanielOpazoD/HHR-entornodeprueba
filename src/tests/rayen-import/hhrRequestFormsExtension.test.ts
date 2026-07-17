/**
 * Guards the extension's exam-request forms module (extension/hhr-request-forms.js):
 * patient-view derivation, the imaging documents' overlay/PDF field maps (HHR parity)
 * and the printable laboratory request HTML (selection marks + escaping).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../../../extension/hhr-request-forms.js';

type Coord = { x: number; y: number; maxWidth?: number };
type ImagingDocument = {
  id: string;
  title: string;
  image: string;
  pdf: string;
  aspectRatio: string;
  overlays: (
    view: Record<string, string>,
    physician: string
  ) => Array<{ text: string; left: string; top: string }>;
  pdfFields: (
    view: Record<string, string>,
    physician: string
  ) => Array<{ coord: Coord; text: string }>;
};
type RequestFormsApi = {
  splitPatientName: (name?: string) => [string, string, string];
  calculateAge: (birthDate?: string) => string;
  formatDateCL: (date?: string) => string;
  buildPatientView: (patient: Record<string, unknown>, run?: string) => Record<string, string>;
  IMAGING_DOCUMENTS: Record<string, ImagingDocument>;
  EXAM_CATEGORIES: Array<{ id: string; name: string; exams: string[] }>;
  LAB_FORM_COLUMNS: string[][];
  buildLabRequestPrintHtml: (state: Record<string, unknown>) => string;
};

const forms = (globalThis as { HhrRequestForms?: RequestFormsApi })
  .HhrRequestForms as RequestFormsApi;

afterEach(() => {
  vi.useRealTimers();
});

describe('extension request forms · patient view', () => {
  it('splits names like HHR (4+ words → last two are surnames)', () => {
    expect(forms.splitPatientName('Jose Mario Solar Rebeco')).toEqual([
      'Jose Mario',
      'Solar',
      'Rebeco',
    ]);
    expect(forms.splitPatientName('Ana Rapu')).toEqual(['Ana', 'Rapu', '']);
    expect(forms.splitPatientName(undefined)).toEqual(['', '', '']);
  });

  it('formats birth dates to DD-MM-YYYY and derives an age label', () => {
    expect(forms.formatDateCL('1958-09-12')).toBe('12-09-1958');
    expect(forms.formatDateCL('12-09-1958')).toBe('12-09-1958');
    expect(forms.calculateAge('1958-09-12')).toMatch(/^\d+ años$/);
    expect(forms.calculateAge('')).toBe('');
  });

  it('keeps the birthday boundary in local time west of UTC', () => {
    const originalTz = process.env.TZ;
    process.env.TZ = 'Pacific/Easter';
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-07-16T02:00:00.000Z'));
      expect(forms.calculateAge('2000-07-16')).toBe('25 años');
      expect(forms.calculateAge('16-07-2000')).toBe('25 años');
      expect(forms.calculateAge('2000-02-30')).toBe('');
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it('builds the normalized view used by overlays and PDF fields', () => {
    const view = forms.buildPatientView(
      {
        name: 'Jose Mario Solar Rebeco',
        run: '7897149',
        birthDate: '1958-09-12',
        diagnosis: 'Neuronitis vestibular',
      },
      '7.897.149-5'
    );
    expect(view).toMatchObject({
      nombres: 'Jose Mario',
      primerApellido: 'Solar',
      segundoApellido: 'Rebeco',
      rut: '7.897.149-5',
      nacimiento: '12-09-1958',
      diagnostico: 'Neuronitis vestibular',
    });
    expect(view.hoy).toMatch(/^\d{2}-\d{2}-\d{4}$/);
  });
});

describe('extension request forms · imaging documents', () => {
  const view = forms.buildPatientView(
    {
      name: 'Jose Mario Solar Rebeco',
      run: '7897149',
      birthDate: '1958-09-12',
      diagnosis: 'Neuronitis',
    },
    '7.897.149-5'
  );

  it('ships the three official documents with template assets', () => {
    expect(Object.keys(forms.IMAGING_DOCUMENTS)).toEqual([
      'solicitud',
      'encuesta',
      'consentimiento',
    ]);
    for (const doc of Object.values(forms.IMAGING_DOCUMENTS)) {
      expect(doc.image).toMatch(/^forms\/.+\.png$/);
      expect(doc.pdf).toMatch(/^forms\/.+\.pdf$/);
      expect(doc.aspectRatio).toMatch(/^\d+ \/ \d+$/);
    }
  });

  it('produces the HHR field set per document with valid PDF coordinates', () => {
    const solicitud = forms.IMAGING_DOCUMENTS.solicitud.pdfFields(view, 'Dra. Atan');
    expect(solicitud).toHaveLength(9);
    expect(solicitud.find(field => field.text === '7.897.149-5')?.coord).toMatchObject({
      x: 60.47,
      y: 750.58,
    });
    for (const doc of Object.values(forms.IMAGING_DOCUMENTS)) {
      for (const field of doc.pdfFields(view, 'Dra. Atan')) {
        expect(Number.isFinite(field.coord.x)).toBe(true);
        expect(Number.isFinite(field.coord.y)).toBe(true);
      }
      for (const overlay of doc.overlays(view, 'Dra. Atan')) {
        expect(overlay.left).toMatch(/%$/);
        expect(overlay.top).toMatch(/%$/);
      }
    }
    // Encuesta carries birth date but no request date; consentimiento the inverse.
    const encuestaTexts = forms.IMAGING_DOCUMENTS.encuesta
      .pdfFields(view, 'X')
      .map(field => field.text);
    expect(encuestaTexts).toContain(view.nacimiento);
    expect(encuestaTexts).not.toContain(view.hoy);
    const consentTexts = forms.IMAGING_DOCUMENTS.consentimiento
      .pdfFields(view, 'X')
      .map(field => field.text);
    expect(consentTexts).toContain(view.hoy);
    expect(consentTexts).not.toContain(view.nacimiento);
  });
});

describe('extension request forms · laboratory print HTML', () => {
  const baseState = {
    patient: { name: 'Jose Mario Solar Rebeco', run: '7.897.149-5', birthDate: '12-09-1958' },
    diagnosis: 'Neuronitis vestibular',
    procedencia: 'Hospitalización',
    fonasaLevel: 'B',
    prais: false,
    selected: ['bioquimica|GLICEMIA', 'hematologia|HEMOGRAMA'],
    otros: '',
    medico: 'Dra. Atan',
    logoUrl: '',
  };

  it('marks only the selected exams and the chosen procedencia/FONASA level', () => {
    const html = forms.buildLabRequestPrintHtml(baseState);
    expect(html).toContain('<span class="box on">&times;</span><span>GLICEMIA</span>');
    expect(html).toContain('<span class="box on">&times;</span><span>HEMOGRAMA</span>');
    expect(html).toContain('<span class="box"></span><span>UREMIA</span>');
    expect(html).toContain('Jose Mario Solar Rebeco');
    expect(html).toContain('B <span class="box on">&times;</span>');
    expect(html).toContain('Hospitalización <span class="box on">&times;</span>');
    expect(html).toContain('TUBO VERDE');
    expect(html).toContain('ORINA / PARÁSITOS');
    expect(html).toContain('VIROLOGÍA / OTROS');
    expect(html).toContain('body { margin: 0; padding: 3mm 4mm;');
    expect(html).toContain('@page { size: letter portrait; margin: 4mm; }');
    expect(html).not.toContain('window.print()');
  });

  it('escapes patient-controlled text (no HTML injection into the print tab)', () => {
    const html = forms.buildLabRequestPrintHtml({
      ...baseState,
      otros: '<script>alert(1)</script>',
      medico: '"><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('covers every category of the official form across the three print columns', () => {
    const inColumns = new Set(forms.LAB_FORM_COLUMNS.flat());
    for (const category of forms.EXAM_CATEGORIES) {
      expect(inColumns.has(category.id)).toBe(true);
    }
  });
});
