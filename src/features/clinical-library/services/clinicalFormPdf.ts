import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';
import { validateClinicalFormValues } from '../domain/forms/clinicalFormDraft';
import { formatFormDate, parseFormDate } from '../domain/forms/clinicalFormDates';
import type {
  ClinicalFormDefinition,
  ClinicalFormTarget,
  ClinicalFormValues,
  ClinicalFormValue,
} from '../domain/forms/clinicalFormTypes';
import { layoutClinicalFormText } from './clinicalFormPdfLayout';

const targetText = (target: ClinicalFormTarget, value: ClinicalFormValue): string => {
  if (Object.hasOwn(target, 'equals')) return value === target.equals ? 'X' : '';
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (target.format === 'sex_initial')
    return (
      ({ Masculino: 'M', Femenino: 'F', Indeterminado: 'I' } as Record<string, string>)[text] ?? ''
    );
  if (target.format === 'date_dmy') return formatFormDate(text);
  if (target.format?.startsWith('date_')) {
    const date = parseFormDate(text);
    if (!date) return '';
    const part =
      target.format === 'date_day'
        ? date.day
        : target.format === 'date_month'
          ? date.month
          : date.year;
    return String(part).padStart(target.format === 'date_year' ? 4 : 2, '0');
  }
  return text;
};

export const clinicalFormTemplateHash = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

/** Overlay only reviewed values; retain original page artwork, dimensions and page order. */
export const createClinicalFormPdf = async (
  template: Uint8Array,
  form: ClinicalFormDefinition,
  input: ClinicalFormValues,
  hidden: ReadonlyArray<string> = []
): Promise<Uint8Array> => {
  const values = validateClinicalFormValues(form, input, hidden);
  if ((await clinicalFormTemplateHash(template)) !== form.templateSha256) {
    throw new Error(
      'La plantilla cambió. Actualiza la aplicación antes de imprimir este formulario.'
    );
  }
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLibGenerationRuntime();
  const pdf = await PDFDocument.load(template);
  if (
    pdf.getPageCount() !== form.pages.length ||
    form.pages.some((size, i) => {
      const page = pdf.getPage(i);
      return (
        Math.abs(page.getWidth() - size.width) > 0.2 ||
        Math.abs(page.getHeight() - size.height) > 0.2
      );
    })
  )
    throw new Error('Las páginas no coinciden con la plantilla verificada.');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const field of form.fields) {
    for (const target of field.targets) {
      const text = targetText(target, values[field.id]);
      if (!text) continue;
      const page = pdf.getPage(target.page);
      const [x, y, width, height] = target.rect;
      if (
        x < 0 ||
        y < 0 ||
        width <= 0 ||
        height <= 0 ||
        x + width > page.getWidth() ||
        y + height > page.getHeight()
      ) {
        throw new Error(`Casillero fuera de la plantilla: ${field.label}.`);
      }
      const lines = layoutClinicalFormText(
        field,
        target,
        text,
        font,
        page.getHeight(),
        Object.hasOwn(target, 'equals')
      );
      for (const line of lines)
        page.drawText(line.text, {
          x: line.x,
          y: line.y,
          size: line.size,
          font,
          color: rgb(0, 0, 0),
        });
    }
  }
  return pdf.save();
};

// Public blank templates only. Patient data and generated PDFs are never cached here.
const templates = new Map<string, Promise<Uint8Array>>();
export const loadClinicalFormTemplate = (form: ClinicalFormDefinition): Promise<Uint8Array> => {
  const cached = templates.get(form.templateUrl);
  if (cached) return cached;
  const request = fetch(form.templateUrl)
    .then(async response => {
      if (!response.ok)
        throw new Error('No se pudo cargar la plantilla. Revisa la conexión y vuelve a intentar.');
      return new Uint8Array(await response.arrayBuffer());
    })
    .catch((error: unknown) => {
      templates.delete(form.templateUrl);
      throw error;
    });
  templates.set(form.templateUrl, request);
  return request;
};

export const generateClinicalFormPdf = async (
  form: ClinicalFormDefinition,
  values: ClinicalFormValues,
  hidden: ReadonlyArray<string>
) => createClinicalFormPdf(await loadClinicalFormTemplate(form), form, values, hidden);
