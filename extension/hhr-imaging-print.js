/** Draw the selected fields and marks on the packaged official form. */
(() => {
  'use strict';
  const fill = async (template, buffer, view, physician, marks) => {
    const physicianName = String(physician || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const safeMarks = (Array.isArray(marks) ? marks : [])
      .slice(0, 80)
      .map(mark => ({
        x: Number(mark && mark.x),
        y: Number(mark && mark.y),
        text: mark && mark.text ? String(mark.text).slice(0, 80) : '',
      }))
      .filter(mark =>
        Number.isFinite(mark.x) && Number.isFinite(mark.y) &&
        mark.x >= 0 && mark.x <= 100 && mark.y >= 0 && mark.y <= 100
      );
    const library = self.PDFLib;
    const pdfDoc = await library.PDFDocument.load(buffer);
    const font = await pdfDoc.embedFont(library.StandardFonts.Helvetica);
    const page = pdfDoc.getPage(0);
    const drawField = ({ coord, text }) => {
      const value = String(text || '').toUpperCase();
      if (!value || !coord) return;
      let size = 10;
      if (coord.maxWidth) {
        while (size > 5 && font.widthOfTextAtSize(value, size) > coord.maxWidth) size -= 0.5;
      }
      page.drawText(value, { x: coord.x, y: coord.y, size, font });
    };
    template.pdfFields(view, physicianName).forEach(drawField);
    const pageWidth = page.getWidth();
    const pageHeight = page.getHeight();
    for (const mark of safeMarks) {
      const xPos = pageWidth * (mark.x / 100);
      const yPos = pageHeight * (1 - mark.y / 100);
      if (mark.text) page.drawText(mark.text.toUpperCase(), { x: xPos, y: yPos - 3, size: 10, font });
      else page.drawText('X', { x: xPos - 4, y: yPos - 4, size: 14, font });
    }
    return pdfDoc.save();
  };
  self.HhrImagingPrint = Object.freeze({ fill });
})();
