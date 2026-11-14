import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';
import { validateClinicalFormValues } from '../domain/forms/clinicalFormDraft';
import { SIC_FORM_ID, validateSicRequired } from '../domain/forms/sicFormData';
import type { ClinicalFormDefinition, ClinicalFormValues } from '../domain/forms/clinicalFormTypes';
import { clinicalFormTemplateHash, targetText } from './clinicalFormPdf';
import { layoutClinicalFormText } from './clinicalFormPdfLayout';
import { insertSicWordSignature } from './sicWordSignature';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Direct table/row/cell indexes of the hash-verified original. Never reconstruct its tables.
const SLOTS: Record<string, Array<[number, number, number]>> = {
  formulario_fecha_emision: [
    [1, 0, 2],
    [1, 0, 3],
    [1, 0, 4],
  ],
  sic_prioridad: [[1, 0, 8]],
  paciente_rut: [[3, 2, 1]],
  paciente_edad_texto: [[3, 2, 3]],
  paciente_sexo_biologico: [
    [3, 3, 2],
    [3, 3, 4],
  ],
  paciente_fecha_nacimiento: [
    [3, 3, 6],
    [3, 3, 7],
    [3, 3, 8],
  ],
  sic_direccion: [[3, 5, 1]],
  sic_fono_fijo: [[3, 5, 3]],
  sic_fono_movil: [[3, 6, 3]],
  sic_especialidad: [[4, 0, 2]],
  sic_establecimiento: [[4, 0, 4]],
  sic_tipo_consulta: [
    [4, 1, 2],
    [4, 1, 4],
  ],
  sic_confirmacion: [[4, 3, 1]],
  sic_tratamiento: [[4, 3, 3]],
  sic_examenes: [[4, 3, 5]],
  sic_ges: [[4, 3, 7]],
  sic_otro: [[4, 3, 9]],
  diagnostico_texto: [[4, 4, 1]],
  sic_fundamento: [[4, 5, 1]],
  sic_adjuntos: [[4, 6, 1]],
  sic_profesional_nombre: [[5, 0, 1]],
  sic_profesional_rut: [[5, 0, 3]],
};
const required = <T>(value: T | undefined | null): T => {
  if (value == null) throw new Error('La estructura Word no coincide con la plantilla verificada.');
  return value;
};
const children = (node: Element, tag: string) =>
  Array.from(node.children).filter(child => child.namespaceURI === W && child.localName === tag);

export const createSicFormDocx = async (
  template: Uint8Array,
  form: ClinicalFormDefinition,
  input: ClinicalFormValues,
  hidden: ReadonlyArray<string> = [],
  png?: Uint8Array
): Promise<Uint8Array> => {
  if (form.id !== SIC_FORM_ID || (await clinicalFormTemplateHash(template)) !== form.sourceSha256)
    throw new Error('La plantilla Word cambió. Actualiza la aplicación antes de descargar.');
  const values = validateClinicalFormValues(form, input, hidden);
  validateSicRequired(values);
  const [{ default: PizZip }, { PDFDocument, StandardFonts }] = await Promise.all([
    import('pizzip'),
    loadPdfLibGenerationRuntime(),
  ]);
  const font = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
  const zip = new PizZip(template);
  const document = new DOMParser().parseFromString(
    zip.file('word/document.xml')!.asText(),
    'application/xml'
  );
  const body = required(document.getElementsByTagNameNS(W, 'body')[0]);
  const tables = children(body, 'tbl');
  if (tables.length !== 6)
    throw new Error('La estructura Word no coincide con la plantilla verificada.');
  const cell = (t: number, r: number, c: number) =>
    required(children(required(children(required(tables[t]), 'tr')[r]), 'tc')[c]);
  const element = (name: string, attributes: Record<string, string> = {}) => {
    const node = document.createElementNS(W, `w:${name}`);
    for (const [key, value] of Object.entries(attributes))
      node.setAttributeNS(W, `w:${key}`, value);
    return node;
  };
  const paragraph = (target: Element) => {
    children(target, 'p').forEach(node => node.remove());
    const p = target.appendChild(element('p'));
    const props = p.appendChild(element('pPr'));
    props.appendChild(
      element('spacing', { before: '0', after: '0', line: '200', lineRule: 'auto' })
    );
    return p;
  };
  const write = (p: Element, text: string, size: number) => {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
      throw new Error('El texto contiene caracteres no compatibles con Word.');
    const run = p.appendChild(element('r'));
    const props = run.appendChild(element('rPr'));
    props.appendChild(element('rFonts', { ascii: 'Arial', hAnsi: 'Arial' }));
    props.appendChild(element('sz', { val: String(Math.floor(size * 2)) }));
    text.split('\n').forEach((line, i) => {
      if (i) run.appendChild(element('br'));
      const node = run.appendChild(element('t'));
      node.textContent = line;
      node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    });
  };
  for (const field of form.fields) {
    const slots = SLOTS[field.id];
    if (!slots) continue;
    slots.forEach(([t, r, c], i) => {
      const target = required(field.targets[i]);
      const text = targetText(target, values[field.id] ?? null);
      const targetCell = cell(t, r, c);
      // Keep original preprinted dashes, even when the optional description is empty.
      if (!text) return;
      const printedText = ['diagnostico_texto', 'sic_fundamento', 'sic_adjuntos'].includes(field.id)
        ? `- ${text}\n-`
        : text;
      const p = paragraph(targetCell);
      // Same bounded layout as PDF, capped at 9pt to allow for Word's cell padding.
      const lines = layoutClinicalFormText(
        field,
        { ...target, fontSize: 6 },
        printedText,
        font,
        792,
        Object.hasOwn(target, 'equals')
      );
      write(p, lines.map(line => line.text).join('\n'), Math.min(9, required(lines[0]).size));
    });
  }
  const names = paragraph(cell(3, 0, 0));
  const parts = ['paciente_apellido_paterno', 'paciente_apellido_materno', 'paciente_nombres'];
  if (values.paciente_nombre_completo) {
    const field = form.fields.find(field => field.id === 'paciente_nombre_completo')!;
    const lines = layoutClinicalFormText(
      field,
      { ...required(field.targets[0]), fontSize: 6 },
      String(values.paciente_nombre_completo),
      font,
      792,
      false
    );
    write(names, String(values.paciente_nombre_completo), required(lines[0]).size);
  } else {
    const tabs = names.firstElementChild!.appendChild(element('tabs'));
    [3900, 7580].forEach(pos =>
      tabs.appendChild(element('tab', { val: 'left', pos: String(pos) }))
    );
    parts.forEach((id, i) => {
      if (i) names.appendChild(element('r')).appendChild(element('tab'));
      const text = String(values[id] ?? '');
      if (!text) return;
      const field = form.fields.find(field => field.id === id)!;
      const lines = layoutClinicalFormText(
        field,
        { ...required(field.targets[0]), fontSize: 6 },
        text,
        font,
        792,
        false
      );
      write(names, text, required(lines[0]).size);
    });
  }
  if (png) await insertSicWordSignature(zip, document, paragraph(cell(5, 0, 5)), png);
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
};

export const generateSicFormDocx = async (
  form: ClinicalFormDefinition,
  values: ClinicalFormValues,
  hidden: ReadonlyArray<string>,
  png?: Uint8Array
) => {
  const response = await fetch(form.sourceUrl);
  if (!response.ok) throw new Error('No se pudo cargar la plantilla Word. Vuelve a intentar.');
  return createSicFormDocx(new Uint8Array(await response.arrayBuffer()), form, values, hidden, png);
};
