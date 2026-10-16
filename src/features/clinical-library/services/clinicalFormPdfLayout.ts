import type { PDFFont } from 'pdf-lib';
import type { ClinicalFormField, ClinicalFormTarget } from '../domain/forms/clinicalFormTypes';

export interface FormPrintLine {
  text: string;
  x: number;
  y: number;
  size: number;
}

const wrapText = (text: string, width: number, size: number, font: PDFFont): string[] => {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > width && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
};

/** No clipping or silent truncation: every glyph must fit in the original rectangle. */
export const layoutClinicalFormText = (
  field: ClinicalFormField,
  target: ClinicalFormTarget,
  text: string,
  font: PDFFont,
  pageHeight: number,
  mark: boolean
): FormPrintLine[] => {
  const [x, top, width, height] = target.rect;
  const padding = mark ? 0.05 : 0.7;
  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 2;
  const value = text.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  try {
    for (const line of value.split('\n')) font.encodeText(line);
  } catch {
    throw new Error(
      `«${field.label}» contiene caracteres que no admite esta plantilla. Revisa el texto.`
    );
  }
  // Bounding work for large imported texts before expensive wrapping at each candidate size.
  const tooLong = () =>
    new Error(
      `El texto de «${field.row ? `Registro ${field.row} · ` : ''}${field.label}» no cabe en su casillero original. Abrevia ese campo.`
    );
  if (
    value.length > 12_000 ||
    font.widthOfTextAtSize(value.replace(/\s+/g, ' '), 6) >
      availableWidth * Math.max(1, Math.ceil(availableHeight / 6))
  )
    throw tooLong();
  for (let size = target.fontSize ?? (mark ? 7.5 : 9); size >= (mark ? 5 : 6); size -= 0.25) {
    const ascent = mark ? font.heightAtSize(size, { descender: false }) : size * 0.931;
    const descent = mark ? 0 : size * 0.225;
    const lineHeight = (ascent + descent) * 1.05;
    const lines = field.multiline && !mark ? wrapText(value, availableWidth, size, font) : [value];
    const blockHeight = ascent + descent + (lines.length - 1) * lineHeight;
    if (
      blockHeight > availableHeight ||
      lines.some(line => font.widthOfTextAtSize(line, size) > availableWidth)
    )
      continue;
    const centered = mark || target.align === 'center';
    const firstBaseline =
      field.multiline && !mark
        ? pageHeight - top - padding - ascent
        : pageHeight - top - padding - (availableHeight - blockHeight) / 2 - ascent;
    return lines.map((line, index) => ({
      text: line,
      size,
      x: x + padding + (centered ? (availableWidth - font.widthOfTextAtSize(line, size)) / 2 : 0),
      y: firstBaseline - index * lineHeight,
    }));
  }
  throw tooLong();
};
