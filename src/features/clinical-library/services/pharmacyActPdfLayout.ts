import type { PDFFont } from 'pdf-lib';

export const pharmacyPdfText = (text: string): string =>
  text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');

/** Split overlong words too: a catalog name or an identifier must never escape its cell. */
export const wrapPharmacyPdfText = (
  text: string,
  width: number,
  size: number,
  font: PDFFont
): string[] => {
  const lines: string[] = [];
  for (const paragraph of pharmacyPdfText(text).split('\n')) {
    if (!paragraph.trim()) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        if (font.widthOfTextAtSize(line + character, size) > width && line) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
};
