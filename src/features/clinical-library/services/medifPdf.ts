import type { PDFFont, TextPosition } from 'pdf-lib';
import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';
import { MEDIF_FIELDS, type MedifField } from '../domain/medifSchema';
import { validateMedifValues, type MedifValues } from '../domain/medifDraft';
import { filterMedifExportValues, type MedifPreferences } from '../domain/medifPreferences';
import { MEDIF_TEXT_SIZE, clinicalFormGlyphBounds } from './clinicalFormTypography';

export type MedifPdfMode = 'print' | 'editable';
export const MEDIF_TEMPLATE_URL = '/docs/biblioteca/medif-latam-rellenable.pdf';
const textPadding = (field: MedifField): number => (field.kind === 'mark' ? 0.1 : 0.5);
const MARK_FONT_SIZE = 7.5;
// Helvetica's full FontBBox includes uppercase accents above its usual 718 ascent.
// Text must reserve that space; an X has neither accents nor descenders.
const glyphBounds = (field: MedifField, text: string, size: number, font: PDFFont) =>
  field.kind === 'mark'
    ? { ascent: font.heightAtSize(size, { descender: false }), descent: 0 }
    : clinicalFormGlyphBounds(text, size, font);

const layoutText = async (
  field: MedifField,
  text: string,
  font: PDFFont,
  size: number
): Promise<TextPosition[]> => {
  const { layoutMultilineText, layoutSinglelineText, TextAlignment } =
    await loadPdfLibGenerationRuntime();
  const padding = textPadding(field);
  const bounds = {
    x: padding,
    y: padding,
    width: field.rect[2] - field.rect[0] - padding * 2,
    height: field.rect[3] - field.rect[1] - padding * 2,
  };
  const alignment = field.kind === 'mark' ? TextAlignment.Center : TextAlignment.Left;
  const options = { font, fontSize: size, alignment, bounds };
  const { ascent, descent } = glyphBounds(field, text, size, font);
  if (field.multiline) {
    return layoutMultilineText(text, options).lines.map((line, index) => ({
      ...line,
      y: bounds.y + bounds.height - ascent - index * (ascent + descent) * 1.05,
    }));
  }
  const line = layoutSinglelineText(text, options).line;
  // Center the full glyph height, including descenders, in the narrow original cells.
  return [{ ...line, y: bounds.y + (bounds.height - ascent - descent) / 2 + descent }];
};

const textForPdf = (field: MedifField, value: string, font: PDFFont): string => {
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n');
  if (!field.multiline && text.includes('\n')) {
    throw new Error(`«${field.shortLabel}» admite una sola línea.`);
  }
  try {
    for (const line of text.split('\n')) font.encodeText(line);
  } catch {
    throw new Error(
      `«${field.shortLabel}» contiene caracteres no compatibles con el PDF. Revisa ese campo.`
    );
  }
  return text;
};

/** No truncation: reject values that cannot fit at the smallest legible size. */
const fittingFontSize = async (field: MedifField, text: string, font: PDFFont): Promise<number> => {
  if (!text) return field.kind === 'mark' ? MARK_FONT_SIZE : MEDIF_TEXT_SIZE;
  const width = field.rect[2] - field.rect[0];
  const height = field.rect[3] - field.rect[1];
  const padding = textPadding(field);
  const bounds = {
    x: padding,
    y: padding,
    width: width - padding * 2,
    height: height - padding * 2,
  };
  const overflow = () =>
    new Error(
      `El texto de «${field.shortLabel}» no cabe en el casillero original. Abre esa sección y abrevia el texto antes de generar el PDF.`
    );
  // A generous capacity bound avoids the PDF library's expensive word wrapping
  // for clearly oversized pasted/imported text. Actual layout remains authoritative.
  const maxLines = Math.ceil(bounds.height / font.heightAtSize(4)) + 3;
  if (font.widthOfTextAtSize(text.replace(/\s+/g, ' '), 4) > bounds.width * maxLines) {
    throw overflow();
  }
  for (
    let size = field.kind === 'mark' ? MARK_FONT_SIZE : MEDIF_TEXT_SIZE;
    size >= 4;
    size -= 0.25
  ) {
    const lines = await layoutText(field, text, font, size);
    const { ascent, descent } = glyphBounds(field, text, size, font);
    if (
      lines.every(
        line =>
          line.width <= bounds.width &&
          line.y - descent >= bounds.y &&
          line.y + ascent <= bounds.y + bounds.height
      )
    ) {
      return size;
    }
  }
  throw overflow();
};

export const createMedifPdf = async (
  template: ArrayBuffer | Uint8Array,
  input: MedifValues,
  preferences: MedifPreferences,
  mode: MedifPdfMode
): Promise<Uint8Array> => {
  const values = filterMedifExportValues(validateMedifValues(input), preferences);
  const { PDFDocument, StandardFonts, drawTextField, rgb } = await loadPdfLibGenerationRuntime();
  const pdf = await PDFDocument.load(template);
  const form = pdf.getForm();
  if (
    pdf.getPageCount() !== 3 ||
    form.getFields().length !== MEDIF_FIELDS.length ||
    MEDIF_FIELDS.some(field => !form.getFieldMaybe(field.id))
  ) {
    throw new Error('La plantilla MEDIF no coincide con la versión de campos del editor.');
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const field of MEDIF_FIELDS) {
    const text = textForPdf(field, values[field.id] ?? '', font);
    const fontSize = await fittingFontSize(field, text, font);
    const pdfField = form.getTextField(field.id);
    pdfField.setText(text);
    // The reviewed pypdf template encodes '/' as octal in DA strings. pdf-lib's
    // font-size parser reads the literal bytes, so normalize both field and widget DA.
    const appearance = `0 g\n/${font.name} ${fontSize} Tf`;
    pdfField.acroField.setDefaultAppearance(appearance);
    for (const widget of pdfField.acroField.getWidgets()) {
      widget.setDefaultAppearance(appearance);
    }
    const textLines = await layoutText(field, text, font, fontSize);
    pdfField.updateAppearances(font, () =>
      drawTextField({
        x: 0,
        y: 0,
        width: field.rect[2] - field.rect[0],
        height: field.rect[3] - field.rect[1],
        borderWidth: 0,
        borderColor: undefined,
        color: undefined,
        textColor: rgb(0, 0, 0),
        font: font.name,
        fontSize,
        textLines,
        padding: textPadding(field),
      })
    );
  }
  if (mode === 'print') form.flatten({ updateFieldAppearances: false });
  pdf.setTitle('MEDIF LATAM');
  return pdf.save({ updateFieldAppearances: false });
};
