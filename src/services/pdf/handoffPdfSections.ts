import type { jsPDF } from 'jspdf';

export { addCudyrTable } from './handoffPdfCudyrSection';
export {
  addHandoffHeader,
  addNovedadesSection,
  addPageFooter,
  addStaffAndChecklist,
} from './handoffPdfLayoutSections';
export type { AutoTableFunction, JsPDFWithAutoTable } from './handoffPdfTypes';
export type {
  HandoffPdfCell,
  HandoffPdfMovementSummaryTable,
  HandoffPdfTableRow,
} from './handoffPdfSectionTypes';
export { addPatientTable } from './handoffPdfPatientTableSection';
export { addMovementsSummary } from './handoffPdfMovementsSummarySection';
import type { AutoTableFunction } from './handoffPdfTypes';

// Keep the public facade signatures discoverable here.
export type HandoffPdfSectionAutoTable = AutoTableFunction;

export type HandoffPdfSectionDoc = jsPDF;
