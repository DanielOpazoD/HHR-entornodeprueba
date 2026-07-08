import type { jsPDF } from 'jspdf';
import type { ShiftType } from '@/types/domain/shift';
import type { HandoffPdfRecord } from '@/services/pdf/contracts/handoffPdfContracts';
import { Schedule } from './handoffPdfUtils';
import { openPdfPrintDialog } from './pdfBase';
import { resolveNursingHandoffNovedadesText } from '@/shared/handoff/handoffNovedades';
import {
  addPatientTable,
  addMovementsSummary,
  addCudyrTable,
  addHandoffHeader,
  addStaffAndChecklist,
  addNovedadesSection,
  addPageFooter,
  AutoTableFunction,
} from './handoffPdfSections';
import { HANDOFF_PDF_PAGE_LAYOUT } from './handoffPdfPageLayout';

const buildHandoffPdfFileName = (date: string, selectedShift: ShiftType): string => {
  const [year, month, day] = date.split('-');
  const shiftLabel = selectedShift === 'day' ? 'Largo' : 'Noche';
  return `${day}-${month}-${year} - Turno ${shiftLabel}.pdf`;
};

/**
 * Generate a lightweight PDF for the Handoff report.
 * Supports both Medical and Nursing formats.
 */
export const generateHandoffPdf = async (
  record: HandoffPdfRecord,
  isMedical: boolean,
  selectedShift: ShiftType,
  schedule: Schedule
): Promise<void> => {
  // Dynamic imports to reduce bundle size
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({
    orientation: HANDOFF_PDF_PAGE_LAYOUT.orientation,
    unit: HANDOFF_PDF_PAGE_LAYOUT.unit,
    format: HANDOFF_PDF_PAGE_LAYOUT.format,
    compress: true,
  }) as unknown as jsPDF;
  const { margin, logoSize } = HANDOFF_PDF_PAGE_LAYOUT;

  // 1. HEADER
  let currentY = await addHandoffHeader(
    doc,
    record,
    isMedical,
    selectedShift,
    schedule,
    margin.left,
    logoSize
  );

  // 2. STAFF & CHECKLIST (Nursing only)
  if (!isMedical) {
    currentY = addStaffAndChecklist(doc, record, selectedShift, margin.left, currentY);
  }

  // 3. PATIENT TABLE
  const typedAutoTable = autoTable as unknown as AutoTableFunction;
  currentY = addPatientTable(
    doc,
    record,
    isMedical,
    selectedShift,
    currentY,
    typedAutoTable,
    margin
  );
  currentY += 8;

  // 4. MOVIMIENTOS DEL DÍA
  currentY = addMovementsSummary(doc, record, margin.left, currentY, typedAutoTable, margin);
  currentY += 4;

  // 5. NOVEDADES
  const novedadesText = isMedical
    ? ''
    : resolveNursingHandoffNovedadesText({
        selectedShift,
        handoffNovedadesDayShift: record.handoffNovedadesDayShift,
        handoffNovedadesNightShift: record.handoffNovedadesNightShift,
      });

  addNovedadesSection(doc, novedadesText, margin.left, currentY, margin);

  // 6. CUDYR (Only Nursing Night)
  if (!isMedical && selectedShift === 'night') {
    addCudyrTable(doc, record, margin.left, typedAutoTable, margin);
  }

  // 7. PAGE NUMBERS
  addPageFooter(doc, margin.left, margin);

  const pdfBytes = new Uint8Array(doc.output('arraybuffer') as ArrayBuffer);
  const fileName = buildHandoffPdfFileName(record.date, selectedShift);
  await openPdfPrintDialog(pdfBytes, fileName);
};
