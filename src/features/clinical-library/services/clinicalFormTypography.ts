import type { PDFFont } from 'pdf-lib';

/** Preferred inserted text is 50% larger. Original cells remain the hard layout limit. */
export const CLINICAL_FORM_TEXT_SCALE = 1.5;
export const CLINICAL_FORM_TEXT_SIZE = 9 * CLINICAL_FORM_TEXT_SCALE;
export const MEDIF_TEXT_SIZE = 8 * CLINICAL_FORM_TEXT_SCALE;
/** Keep accents and descenders safe without reserving them for a date or uppercase identifier. */
export const clinicalFormGlyphBounds = (text: string, size: number, font: PDFFont) => {
  const plain = text
    .normalize('NFD')
    .replace(/\p{Mark}/gu, '')
    .replace(/\s/g, ' ');
  return {
    ascent: /^[A-Za-z0-9 .,:;?!@&%+*/()-]*$/.test(text.replace(/\s/g, ' '))
      ? font.heightAtSize(size, { descender: false })
      : size * 0.931,
    // Q and lower-case/other glyphs retain the full conservative descent allowance.
    descent: /^[A-PR-Z0-9 .:-]*$/.test(plain) ? 0 : size * 0.225,
  };
};
