import type { jsPDF } from 'jspdf';
import { DailyRecord, ShiftType } from '../../types';
import { formatDateDDMMYYYY } from '../dataService';
import {
    getBase64ImageFromURL,
    Schedule,
    getHandoffStaffInfo
} from './handoffPdfUtils';
import {
    addPatientTable,
    addMovementsSummary,
    addCudyrTable
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
) => {
    // Dynamic imports to reduce bundle size
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
    ]);

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const margin = 14;
    const logoSize = 10;

    // 1. HEADER
    try {
        const logoData = await getBase64ImageFromURL('/images/logos/logo_HHR.png');
        doc.addImage(logoData, 'PNG', margin, margin, logoSize, logoSize);
    } catch (e) {
        console.warn("Could not load logo for PDF", e);
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    const title = isMedical
        ? 'ENTREGA DE TURNO MÉDICO'
        : `ENTREGA TURNO ENFERMERÍA - ${selectedShift === 'day' ? 'LARGO' : 'NOCHE'}`;
    doc.text(title, margin + logoSize + 4, margin + 4);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('HOSPITAL HANGA ROA', margin + logoSize + 4, margin + 9);

    // Date & Shift Info (Right aligned)
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    const dateStr = formatDateDDMMYYYY(record.date);
    doc.text(dateStr, pageWidth - margin, margin + 4, { align: 'right' });

    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    const shiftLabel = selectedShift === 'day' ? 'TURNO LARGO' : 'TURNO NOCHE';
    const shiftHours = selectedShift === 'day'
        ? `(${schedule?.dayStart || '08:00'} - ${schedule?.dayEnd || '20:00'})`
        : `(${schedule?.nightStart || '20:00'} - ${schedule?.nightEnd || '08:00'})`;

    if (!isMedical) {
        doc.text(`${shiftLabel} ${shiftHours}`, pageWidth - margin, margin + 9, { align: 'right' });
    }

    // Nurse/Staff Info
    let currentY = margin + 18;
    if (!isMedical) {
        const { delivers, receives, tens } = getHandoffStaffInfo(record, selectedShift);
        const COLUMN_DELIVERS_X = margin;
        const COLUMN_RECEIVES_X = margin + 65;
        const COLUMN_TENS_X = margin + 125;
        const COLUMN_WIDTH = 55; // For wrapping

        doc.setFontSize(8);
        doc.setFont('helvetica', 'bolditalic');
        doc.text('ENFERMERO(A) ENTREGA:', COLUMN_DELIVERS_X, currentY);
        doc.text('ENFERMERO(A) RECIBE:', COLUMN_RECEIVES_X, currentY);
        doc.text('TENS DE TURNO:', COLUMN_TENS_X, currentY);

        currentY += 4;
        doc.setFont('helvetica', 'normal');

        // Wrap names to avoid truncation
        const deliversText = delivers.filter(Boolean).join(', ') || '-';
        const receivesText = receives.filter(Boolean).join(', ') || '-';
        const tensText = tens.filter(Boolean).join(', ') || '-';

        const deliversWrapped = doc.splitTextToSize(deliversText, COLUMN_WIDTH);
        const receivesWrapped = doc.splitTextToSize(receivesText, COLUMN_WIDTH);
        const tensWrapped = doc.splitTextToSize(tensText, COLUMN_WIDTH + 15); // Extra space for TENS

        doc.text(deliversWrapped, COLUMN_DELIVERS_X, currentY);
        doc.text(receivesWrapped, COLUMN_RECEIVES_X, currentY);
        doc.text(tensWrapped, COLUMN_TENS_X, currentY);

        // Max lines to calculate Y spacing
        const maxLines = Math.max(deliversWrapped.length, receivesWrapped.length, tensWrapped.length);
        currentY += (maxLines * 4) + 1;

        // 2. CHECKLIST (Only Nursing)
        const checklist = selectedShift === 'day' ? record.handoffDayChecklist : record.handoffNightChecklist;
        if (checklist) {
            const checklistItems: string[] = [];
            const cl = checklist as any;
            if (selectedShift === 'day') {
                if (cl.escalaBraden) checklistItems.push('Escala Braden: OK');
                if (cl.escalaRiesgoCaidas) checklistItems.push('Riesgo Caidas: OK');
                if (cl.escalaRiesgoLPP) checklistItems.push('Evaluacion LPP: OK');
            } else {
                if (cl.estadistica) checklistItems.push('Estadistica: OK');
                if (cl.categorizacionCudyr) checklistItems.push('Categorizacion CUDYR: OK');
                if (cl.encuestaUTI) checklistItems.push('Encuesta UTI: OK');
                if (cl.encuestaMedias) checklistItems.push('Encuesta Medias: OK');
                if (cl.conteoMedicamento) checklistItems.push('Farmacos Controlados: OK');
                if (cl.conteoNoControlados) {
                    const proxDate = cl.conteoNoControladosProximaFecha;
                    checklistItems.push(`Farmacos No-Controlados: OK${proxDate ? ` (PROX: ${formatDateDDMMYYYY(proxDate)})` : ''}`);
                }
            }
            doc.setFontSize(6);
            doc.setFont('helvetica', 'bold');
            doc.text(checklistItems.length > 0 ? `CHECKLIST: ${checklistItems.join(' | ')}` : 'CHECKLIST: Sin items completados', margin, currentY);
            currentY += 4;
        }
    }

    // 3. PATIENT TABLE
    currentY = addPatientTable(doc, record, isMedical, selectedShift, currentY, autoTable);
    currentY += 8;

    // 4. MOVIMIENTOS DEL DÍA
    currentY = addMovementsSummary(doc, record, margin, currentY, autoTable);
    currentY += 4;

    // 5. NOVEDADES
    const novedadesText = isMedical
        ? record.medicalHandoffNovedades
        : (selectedShift === 'day' ? record.handoffNovedadesDayShift : record.handoffNovedadesNightShift);

    if (novedadesText) {
        if (currentY + 30 > pageHeight) { doc.addPage(); currentY = margin; }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('NOVEDADES DEL TURNO', margin, currentY);
        currentY += 4;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);

        const lines = novedadesText.split(/\r?\n/);
        let novedadesY = currentY;
        for (const line of lines) {
            if (line.trim() === '') { novedadesY += 2; }
            else {
                const cleanLine = line.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
                const wrappedLines = doc.splitTextToSize(cleanLine, pageWidth - (margin * 2));
                doc.text(wrappedLines, margin, novedadesY);
                novedadesY += (wrappedLines.length * 4);
            }
            if (novedadesY > pageHeight - margin) { doc.addPage(); novedadesY = margin; }
        }
        currentY = novedadesY + 6;
    }

    // 6. CUDYR (Only Nursing Night)
    if (!isMedical && selectedShift === 'night') {
        addCudyrTable(doc, record, margin, autoTable);
    }

    // 7. PAGE NUMBERS
    const pageCount = doc.getNumberOfPages();
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 100, 100);
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.text(`Página ${i} de ${pageCount}`, pageWidth - margin, pageHeight - margin + 4, { align: 'right' });
    }

    // Output: Trigger Print Dialog Directly (using hidden iframe)
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
        // Note: We don't remove the iframe immediately to allow print to finish
        setTimeout(() => {
            URL.revokeObjectURL(url);
            document.body.removeChild(iframe);
        }, 10 * 60 * 1000); // Wait 10 min or next refresh
    };
};
