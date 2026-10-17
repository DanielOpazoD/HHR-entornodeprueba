import { validateClinicalFormValues } from '../domain/forms/clinicalFormDraft';
import { formatFormDate } from '../domain/forms/clinicalFormDates';
import type { ClinicalFormDefinition, ClinicalFormValues } from '../domain/forms/clinicalFormTypes';
import { clinicalFormTemplateHash } from './clinicalFormPdf';
import { CLINICAL_FORM_TEXT_SIZE } from './clinicalFormTypography';

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const TRANSFER_FORM = 'informe-traslado-hospital-salvador';
// Body-paragraph indices belong to the sourceSha256-verified original Word document.
const SLOTS: ReadonlyArray<readonly [string, number, boolean]> = [
  ['paciente_nombre_completo', 2, false],
  ['paciente_rut', 3, false],
  ['paciente_edad_texto', 4, false],
  ['formulario_fecha_emision', 5, false],
  ['paciente_fonasa_tramo', 6, false],
  ['paciente_domicilio', 7, false],
  ['paciente_ocupacion', 8, false],
  ['traslado_auge', 9, false],
  ['traslado_apoyo', 10, true],
  ['traslado_historia', 14, false],
  ['traslado_examen_fisico', 15, true],
  ['traslado_anamnesis', 17, false],
  ['traslado_estudio', 18, true],
  ['traslado_resultados', 19, true],
  ['traslado_tratamiento', 21, false],
  ['diagnostico_texto', 22, true],
  ['traslado_fundamento', 24, false],
  ['traslado_solicitud', 26, false],
];

/** Fill the original package, keeping page geometry, headers, images and styles intact. */
export const createClinicalFormDocx = async (
  template: Uint8Array,
  form: ClinicalFormDefinition,
  input: ClinicalFormValues,
  hidden: ReadonlyArray<string> = []
): Promise<Uint8Array> => {
  if (form.id !== TRANSFER_FORM) throw new Error('Este formulario no dispone de salida Word.');
  const values = validateClinicalFormValues(form, input, hidden);
  if ((await clinicalFormTemplateHash(template)) !== form.sourceSha256)
    throw new Error('La plantilla Word cambió. Actualiza la aplicación antes de descargar.');
  const { default: PizZip } = await import('pizzip');
  const zip = new PizZip(template);
  const source = zip.file('word/document.xml')?.asText();
  if (!source) throw new Error('La plantilla Word no contiene el documento esperado.');
  const document = new DOMParser().parseFromString(source, 'application/xml');
  const body = document.getElementsByTagNameNS(WORD_NS, 'body')[0];
  const paragraphs = Array.from(body?.children ?? []).filter(
    element => element.namespaceURI === WORD_NS && element.localName === 'p'
  );
  if (document.getElementsByTagName('parsererror').length || paragraphs.length !== 27)
    throw new Error('La estructura Word no coincide con la plantilla verificada.');
  for (const [id, index, newLine] of SLOTS) {
    const field = form.fields.find(candidate => candidate.id === id);
    if (!field) throw new Error('El mapa Word no coincide con las variables del formulario.');
    const value = values[id];
    if (value === null || value === undefined || value === '') continue;
    const text = (field.kind === 'date' ? formatFormDate(String(value)) : String(value))
      .normalize('NFC')
      .replace(/\r\n?/g, '\n');
    if ([...text].some(character => character.charCodeAt(0) < 32 && !'\t\n\r'.includes(character)))
      throw new Error(`«${field.label}» contiene caracteres no compatibles con Word.`);
    const paragraph = paragraphs[index];
    const paragraphProperties =
      paragraph.getElementsByTagNameNS(WORD_NS, 'pPr')[0] ??
      paragraph.insertBefore(document.createElementNS(WORD_NS, 'w:pPr'), paragraph.firstChild);
    const paragraphProperty = (name: string): Element => {
      const existing = paragraphProperties.getElementsByTagNameNS(WORD_NS, name)[0];
      if (existing) return existing;
      const following =
        name === 'ind' ? ['jc', 'rPr'] : name === 'spacing' ? ['ind', 'jc', 'rPr'] : ['rPr'];
      return paragraphProperties.insertBefore(
        document.createElementNS(WORD_NS, `w:${name}`),
        Array.from(paragraphProperties.children).find(child =>
          following.includes(child.localName)
        ) ?? null
      );
    };
    // Consume the original handwriting space, rather than stretching inserted lines by 1.5.
    const spacing = paragraphProperty('spacing');
    spacing.setAttributeNS(WORD_NS, 'w:line', '240');
    spacing.setAttributeNS(WORD_NS, 'w:lineRule', 'auto');
    paragraphProperty('jc').setAttributeNS(WORD_NS, 'w:val', 'left');
    if (index >= 14 && !newLine) {
      const indent = paragraphProperty('ind');
      indent.setAttributeNS(WORD_NS, 'w:left', '720');
      indent.setAttributeNS(WORD_NS, 'w:firstLine', '0');
    }
    const run = document.createElementNS(WORD_NS, 'w:r');
    const originalProperties = paragraph.getElementsByTagNameNS(WORD_NS, 'rPr')[0];
    const properties = originalProperties
      ? (originalProperties.cloneNode(true) as Element)
      : document.createElementNS(WORD_NS, 'w:rPr');
    for (const [name, value] of [
      ['b', '0'],
      ['bCs', '0'],
      ['sz', String(CLINICAL_FORM_TEXT_SIZE * 2)],
      ['szCs', String(CLINICAL_FORM_TEXT_SIZE * 2)],
    ]) {
      const property =
        properties.getElementsByTagNameNS(WORD_NS, name)[0] ??
        properties.appendChild(document.createElementNS(WORD_NS, `w:${name}`));
      property.setAttributeNS(WORD_NS, 'w:val', value);
    }
    run.appendChild(properties);
    if (newLine && !paragraph.getElementsByTagNameNS(WORD_NS, 'br').length)
      run.appendChild(document.createElementNS(WORD_NS, 'w:br'));
    text.split('\n').forEach((line, lineIndex) => {
      if (lineIndex) run.appendChild(document.createElementNS(WORD_NS, 'w:br'));
      const node = document.createElementNS(WORD_NS, 'w:t');
      node.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
      node.textContent = !newLine && lineIndex === 0 && index < 10 ? ` ${line}` : line;
      run.appendChild(node);
    });
    paragraph.appendChild(run);
  }
  zip.file('word/document.xml', new XMLSerializer().serializeToString(document));
  return zip.generate({ type: 'uint8array', compression: 'DEFLATE' });
};

// Cache only the public original template; never store completed documents or patient values.
let templateRequest: Promise<Uint8Array> | undefined;
export const generateClinicalFormDocx = async (
  form: ClinicalFormDefinition,
  values: ClinicalFormValues,
  hidden: ReadonlyArray<string>
): Promise<Uint8Array> => {
  if (form.id !== TRANSFER_FORM) throw new Error('Este formulario no dispone de salida Word.');
  templateRequest ??= fetch(form.sourceUrl)
    .then(async response => {
      if (!response.ok) throw new Error('No se pudo cargar la plantilla Word. Vuelve a intentar.');
      return new Uint8Array(await response.arrayBuffer());
    })
    .catch((error: unknown) => {
      templateRequest = undefined;
      throw error;
    });
  return createClinicalFormDocx(await templateRequest, form, values, hidden);
};
