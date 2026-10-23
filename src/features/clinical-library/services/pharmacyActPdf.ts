import type { PDFPage } from 'pdf-lib';
import { loadPdfLibGenerationRuntime } from '@/services/pdf/pdfLibRuntime';
import { formatFormDate } from '../domain/forms/clinicalFormDates';
import { validatePharmacyDraft } from '../domain/pharmacy/pharmacyDraft';
import type {
  PharmacyActDraft,
  PharmacyActLine,
  PharmacyPaperSize,
} from '../domain/pharmacy/pharmacyTypes';
import { pharmacyPdfText, wrapPharmacyPdfText } from './pharmacyActPdfLayout';

const PAPER_DIMENSIONS: Record<PharmacyPaperSize, { width: number; height: number }> = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
};
const MARGIN = 36;
const BOTTOM = 60;
const FONT_SIZE = 9;
const LINE_HEIGHT = 12;

const assertDraft = (draft: PharmacyActDraft): void => {
  const errors = validatePharmacyDraft(draft);
  if (errors.length) throw new Error(errors.join('\n'));
};

const returnCells = (line: PharmacyActLine): string[] => [
  line.patient,
  `${line.name}\n${line.presentation}`,
  line.quantity,
  line.reason,
  formatFormDate(line.expiry),
];

const disposalCells = (line: PharmacyActLine): string[] => [
  [line.name, line.patient ? `Paciente: ${line.patient}` : '', line.reason]
    .filter(Boolean)
    .join('\n'),
  line.quantity,
  line.presentation,
  line.disposalCause === 'expired' ? `X\n${formatFormDate(line.expiry)}` : '',
  line.disposalCause === 'damaged' ? 'X' : '',
  line.disposalCause === 'unlabelled' ? 'X' : '',
];

/** Generate from reviewed values only. No persistence, account access or electronic signature. */
export const createPharmacyActPdf = async (
  draft: PharmacyActDraft,
  logoBytes: Uint8Array
): Promise<Uint8Array> => {
  assertDraft(draft);
  const { width: pageWidth, height: pageHeight } = PAPER_DIMENSIONS[draft.paperSize];
  const contentWidth = pageWidth - MARGIN * 2;
  const { PDFDocument, StandardFonts, rgb } = await loadPdfLibGenerationRuntime();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const title =
    draft.kind === 'return'
      ? 'ACTA DE DEVOLUCIÓN DE FÁRMACOS'
      : 'ACTA DE ENTREGA DE FÁRMACOS Y/O INSUMOS ELIMINADOS';
  const allValues = [
    draft.number,
    draft.recipient,
    ...Object.values(draft.professional),
    ...draft.lines.flatMap(line => [
      line.name,
      line.presentation,
      line.quantity,
      line.patient,
      line.reason,
    ]),
  ];
  try {
    for (const value of allValues)
      for (const line of pharmacyPdfText(value).split('\n')) font.encodeText(line);
  } catch {
    throw new Error('El acta contiene caracteres que no admite el PDF. Revisa el texto.');
  }
  const logo = await pdf.embedPng(logoBytes);
  const ink = rgb(0.12, 0.18, 0.23);
  const muted = rgb(0.32, 0.37, 0.4);
  const rule = rgb(0.68, 0.74, 0.77);
  const fill = rgb(0.93, 0.95, 0.96);
  const widths =
    draft.kind === 'return'
      ? [80, 157, 47, 152, contentWidth - 436]
      : [167, 47, 94, 83, 62, contentWidth - 453];
  const headers =
    draft.kind === 'return'
      ? ['Paciente', 'Fármaco / presentación', 'Cantidad', 'Fundamento', 'Fecha vencimiento']
      : [
          'Medicamento / insumo',
          'Cantidad',
          'Presentación',
          'Expirado\nIndique fecha',
          'Mal estado',
          'Sin rotulación adecuada',
        ];
  let y = 0;

  const addPage = (): PDFPage => {
    const newPage = pdf.addPage([pageWidth, pageHeight]);
    const dimensions = logo.scaleToFit(48, 52);
    newPage.drawImage(logo, {
      x: MARGIN,
      y: pageHeight - 34 - dimensions.height,
      ...dimensions,
    });
    newPage.drawText('HOSPITAL HANGA ROA', {
      x: MARGIN + 62,
      y: pageHeight - 48,
      font: bold,
      size: 14,
      color: ink,
    });
    newPage.drawText('Farmacia · Actas de devolución y eliminación', {
      x: MARGIN + 62,
      y: pageHeight - 65,
      font,
      size: 9,
      color: muted,
    });
    newPage.drawLine({
      start: { x: MARGIN, y: pageHeight - 96 },
      end: { x: pageWidth - MARGIN, y: pageHeight - 96 },
      color: rule,
      thickness: 0.8,
    });
    y = pageHeight - 118;
    for (const line of wrapPharmacyPdfText(title, contentWidth, 12, bold)) {
      newPage.drawText(line, { x: MARGIN, y, size: 12, font: bold, color: ink });
      y -= 16;
    }
    y -= 4;
    const reference = `${draft.kind === 'disposal' ? 'Isla de Pascua, ' : 'Fecha: '}${formatFormDate(draft.date)}${draft.number.trim() ? `    N° ${draft.number.trim()}` : ''}`;
    for (const line of wrapPharmacyPdfText(reference, contentWidth, 9, font)) {
      newPage.drawText(line, { x: MARGIN, y, size: 9, font, color: muted });
      y -= LINE_HEIGHT;
    }
    y -= 12;
    return newPage;
  };

  let page = addPage();

  const paragraph = (text: string, size = FONT_SIZE, strong = false): void => {
    const textFont = strong ? bold : font;
    for (const line of wrapPharmacyPdfText(text, contentWidth, size, textFont)) {
      if (y - LINE_HEIGHT < BOTTOM) page = addPage();
      page.drawText(line, { x: MARGIN, y, font: textFont, size, color: ink });
      y -= LINE_HEIGHT;
    }
    y -= 6;
  };

  const tableHeader = (): void => {
    const headLines = headers.map((text, index) =>
      wrapPharmacyPdfText(text, widths[index] - 10, 8, bold)
    );
    const groupHeight = draft.kind === 'disposal' ? 18 : 0;
    const height = Math.max(...headLines.map(lines => lines.length)) * 10 + 12;
    if (y - height - groupHeight - 24 < BOTTOM) page = addPage();
    if (groupHeight) {
      const causeX = MARGIN + widths[0] + widths[1] + widths[2];
      page.drawRectangle({
        x: MARGIN,
        y: y - groupHeight,
        width: contentWidth,
        height: groupHeight,
        color: fill,
      });
      page.drawText('CAUSA DE ELIMINACIÓN', {
        x: causeX + 5,
        y: y - 12,
        font: bold,
        size: 8,
        color: ink,
      });
      y -= groupHeight;
    }
    page.drawRectangle({ x: MARGIN, y: y - height, width: contentWidth, height, color: fill });
    let x = MARGIN;
    headLines.forEach((lines, index) => {
      lines.forEach((line, offset) =>
        page.drawText(line, { x: x + 5, y: y - 12 - offset * 10, font: bold, size: 8, color: ink })
      );
      page.drawRectangle({
        x,
        y: y - height,
        width: widths[index],
        height,
        borderColor: rule,
        borderWidth: 0.5,
      });
      x += widths[index];
    });
    y -= height;
  };

  paragraph(`De: ${draft.professional.name.trim()}`, 10, true);
  paragraph(
    `RUT: ${draft.professional.rut.trim() || '____________________'}    Cargo: ${draft.professional.role.trim()}`
  );
  paragraph(`Unidad / servicio: ${draft.professional.unit.trim()}`);
  paragraph(`A: ${draft.recipient.trim()}`);
  paragraph(
    draft.kind === 'return'
      ? 'Acta de devolución de fármacos de sobre stock en servicio de hospitalizados.'
      : 'Informa el estado de fármacos y/o insumos eliminados que más abajo se detallan, los que en este acto son entregados a Bodega de Fármacos para su resguardo y posterior destrucción.'
  );
  tableHeader();
  draft.lines.forEach((line, rowIndex) => {
    const cells = (draft.kind === 'return' ? returnCells(line) : disposalCells(line)).map(
      (text, index) => wrapPharmacyPdfText(text, widths[index] - 10, FONT_SIZE, font)
    );
    const totalLines = Math.max(...cells.map(cell => cell.length));
    let offset = 0;
    while (offset < totalLines) {
      let capacity = Math.floor((y - BOTTOM - 12) / LINE_HEIGHT);
      if (capacity < 1 || y - BOTTOM < 30) {
        page = addPage();
        paragraph(
          `Registros del acta · continuación${offset ? ` del registro ${rowIndex + 1}` : ''}`,
          9,
          true
        );
        tableHeader();
        capacity = Math.floor((y - BOTTOM - 12) / LINE_HEIGHT);
      }
      const count = Math.min(totalLines - offset, capacity);
      const height = Math.max(30, count * LINE_HEIGHT + 12);
      let x = MARGIN;
      cells.forEach((cell, index) => {
        cell.slice(offset, offset + count).forEach((text, row) => {
          page.drawText(text, {
            x: x + 5,
            y: y - 13 - row * LINE_HEIGHT,
            font,
            size: FONT_SIZE,
            color: ink,
          });
        });
        page.drawRectangle({
          x,
          y: y - height,
          width: widths[index],
          height,
          borderColor: rule,
          borderWidth: 0.5,
        });
        x += widths[index];
      });
      y -= height;
      offset += count;
    }
  });
  if (y - 140 < BOTTOM) page = addPage();
  y -= 34;
  const signatureWidth = (contentWidth - 42) / 2;
  [MARGIN, MARGIN + signatureWidth + 42].forEach(x => {
    page.drawLine({
      start: { x, y },
      end: { x: x + signatureWidth, y },
      thickness: 0.7,
      color: rule,
    });
  });
  page.drawText('Firma de quien entrega', {
    x: MARGIN,
    y: y - 14,
    font: bold,
    size: 9,
    color: ink,
  });
  page.drawText('Recibe conforme · firma', {
    x: MARGIN + signatureWidth + 42,
    y: y - 14,
    font: bold,
    size: 9,
    color: ink,
  });
  y -= 29;
  page.drawText('Hospital Hanga Roa', { x: MARGIN, y, font, size: 9, color: ink });
  page.drawText('Bodega de Fármacos HHR', {
    x: MARGIN + signatureWidth + 42,
    y,
    font,
    size: 9,
    color: ink,
  });
  y -= 19;
  page.drawText('Fecha: ____________________', { x: MARGIN, y, font, size: 9, color: ink });
  page.drawText('Nombre: __________________________', {
    x: MARGIN + signatureWidth + 42,
    y,
    font,
    size: 9,
    color: ink,
  });
  page.drawText('RUT: _____________________________', {
    x: MARGIN + signatureWidth + 42,
    y: y - 19,
    font,
    size: 9,
    color: ink,
  });
  pdf.getPages().forEach((printedPage, index) => {
    printedPage.drawLine({
      start: { x: MARGIN, y: 46 },
      end: { x: pageWidth - MARGIN, y: 46 },
      thickness: 0.5,
      color: rule,
    });
    printedPage.drawText('Hospital Hanga Roa · Farmacia', {
      x: MARGIN,
      y: 32,
      font,
      size: 8,
      color: muted,
    });
    const pagination = `Página ${index + 1} de ${pdf.getPageCount()}`;
    printedPage.drawText(pagination, {
      x: pageWidth - MARGIN - font.widthOfTextAtSize(pagination, 8),
      y: 32,
      font,
      size: 8,
      color: muted,
    });
  });
  pdf.setTitle(title);
  pdf.setAuthor('Hospital Hanga Roa');
  pdf.setSubject('Acta de farmacia');
  return pdf.save();
};

export const generatePharmacyActPdf = async (draft: PharmacyActDraft): Promise<Uint8Array> => {
  assertDraft(draft);
  const response = await fetch('/images/logos/logo_HHR.png');
  if (!response.ok) throw new Error('No se pudo cargar el logo institucional. Vuelve a intentar.');
  return createPharmacyActPdf(draft, new Uint8Array(await response.arrayBuffer()));
};
