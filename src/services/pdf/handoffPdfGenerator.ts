import type { jsPDF } from 'jspdf';
import { DailyRecord, ShiftType } from '@/types';
import {
    Schedule,
} from './handoffPdfUtils';
import {
    addPatientTable,
    addMovementsSummary,
    addCudyrTable,
    addHandoffHeader,
    addStaffAndChecklist,
    addNovedadesSection,
    addPageFooter,
    AutoTableFunction
} from './handoffPdfSections';

/**
 * Generate a lightweight PDF for the Handoff report.
 * Supports both Medical and Nursing formats.
 */
export const generateHandoffPdf = async (
    record: DailyRecord,
    isMedical: boolean,
    selectedShift: ShiftType,
    schedule: Schedule
): Promise<void> => {
    // Dynamic imports to reduce bundle size
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
    ]);

    const doc = new jsPDF() as unknown as jsPDF;
    const margin = 14;
    const logoSize = 10;

    // 1. HEADER
    let currentY = await addHandoffHeader(doc, record, isMedical, selectedShift, schedule, margin, logoSize);

    // 2. STAFF & CHECKLIST (Nursing only)
    if (!isMedical) {
        currentY = addStaffAndChecklist(doc, record, selectedShift, margin, currentY);
    }

    // 3. PATIENT TABLE
    const typedAutoTable = autoTable as unknown as AutoTableFunction;
    currentY = addPatientTable(doc, record, isMedical, selectedShift, currentY, typedAutoTable);
    currentY += 8;

    // 4. MOVIMIENTOS DEL DÍA
    currentY = addMovementsSummary(doc, record, margin, currentY, typedAutoTable);
    currentY += 4;

    // 5. NOVEDADES
    const novedadesText = isMedical
        ? record.medicalHandoffNovedades
        : (selectedShift === 'day' ? record.handoffNovedadesDayShift : record.handoffNovedadesNightShift);

    addNovedadesSection(doc, novedadesText, margin, currentY);

    // 6. CUDYR (Only Nursing Night)
    if (!isMedical && selectedShift === 'night') {
        addCudyrTable(doc, record, margin, typedAutoTable);
    }

    // 7. PAGE NUMBERS
    addPageFooter(doc, margin);

    // Output: Trigger Print Dialog Directly (using hidden iframe)
    triggerIframePrint(doc);
};

/**
 * Helper to trigger print via a hidden iframe
 */
const triggerIframePrint = (doc: jsPDF) => {
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = url;

    document.body.appendChild(iframe);

    iframe.onload = () => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
        setTimeout(() => {
            URL.revokeObjectURL(url);
            document.body.removeChild(iframe);
        }, 10 * 60 * 1000); // Cleanup after 10 min
    };
};
