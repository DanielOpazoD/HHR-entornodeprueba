import type { jsPDF } from 'jspdf';
// import autoTable from 'jspdf-autotable'; // Removed static import
import { DailyRecord, PatientData, ShiftType, CudyrScore, DeviceDetails } from '../../types';
import { BEDS } from '../../constants';
import { formatDateDDMMYYYY } from '../dataService';
import { calculateHospitalizedDays, Schedule, getHandoffStaffInfo, getBase64ImageFromURL } from './handoffPdfUtils';

// ============================================================================
// Section: Patient Table
// ============================================================================

// Local interfaces for jsPDF-AutoTable to avoid 'any'
interface CellHookData {
    section: 'head' | 'body' | 'foot';
    column: { index: number };
    cell: {
        raw: string | number;
        x: number;
        y: number;
        width: number;
        height: number;
        styles: {
            textColor?: number | number[];
            fontStyle?: string;
            fillColor?: number | number[];
        };
    };
    row: { index: number };
}

type AutoTableFunction = (doc: jsPDF, options: any) => void;

// Augmented jsPDF type for AutoTable plugin
type JsPDFWithAutoTable = jsPDF & { lastAutoTable: { finalY: number } };

export const addPatientTable = (
    doc: jsPDF,
    record: DailyRecord,
    isMedical: boolean,
    selectedShift: ShiftType,
    currentY: number,
    autoTable: AutoTableFunction
) => {
    const tableHeaders = [['Cama', 'Paciente', 'Diagnóstico', 'Est', 'DMI', 'Observaciones']];
    type TableRow = (string | { content: string; colSpan?: number; styles?: Record<string, unknown>; } | { content: string; styles: Record<string, unknown> })[] & { _daysStr?: string };
    const tableBody: TableRow[] = [];

    const formatDevices = (p: PatientData): string => {
        if (!p.devices || !Array.isArray(p.devices) || p.devices.length === 0) return '';
        return p.devices.map((d: string) => {
            const detail = p.deviceDetails?.[d as keyof DeviceDetails];
            let daysStr = '';
            if (detail?.installationDate) {
                const diffDays = calculateHospitalizedDays(detail.installationDate, record.date);
                if (diffDays && diffDays > 0) daysStr = ` (${diffDays}d)`;
            }
            return `${d}${daysStr}`;
        }).join(', ');
    };

    BEDS.forEach(bedDef => {
        const patient = record.beds[bedDef.id];
        if (!patient || !patient.patientName) return;

        const admission = patient.admissionDate ? formatDateDDMMYYYY(patient.admissionDate) : '';
        const daysHosp = calculateHospitalizedDays(patient.admissionDate, record.date);
        const daysStr = daysHosp ? `${daysHosp}d` : '';

        const observation = isMedical
            ? (patient.medicalHandoffNote || '')
            : (selectedShift === 'day' ? (patient.handoffNoteDayShift || '') : (patient.handoffNoteNightShift || ''));

        const devicesStr = formatDevices(patient);

        const row: TableRow = [
            { content: bedDef.name, styles: { halign: 'center', fontStyle: 'bold', valign: 'top' } },
            { content: `${patient.patientName}\n${patient.rut || ''} ${patient.age ? `(${patient.age})` : ''}\nFI: ${admission}`, styles: { fontStyle: 'normal' } },
            patient.pathology || '',
            patient.status || '',
            devicesStr,
            observation
        ];
        (row as unknown as { _daysStr: string })._daysStr = daysStr;
        tableBody.push(row);

        if (patient.clinicalCrib && patient.clinicalCrib.patientName) {
            const crib = patient.clinicalCrib;
            const cribObservation = isMedical
                ? (crib.medicalHandoffNote || '')
                : (selectedShift === 'day' ? (crib.handoffNoteDayShift || '') : (crib.handoffNoteNightShift || ''));
            const cribDevices = formatDevices(crib);
            const cribAdmission = crib.admissionDate ? formatDateDDMMYYYY(crib.admissionDate) : '';

            tableBody.push([
                { content: 'Cuna', styles: { halign: 'center', textColor: [236, 72, 153] } },
                { content: `${crib.patientName} (RN)\nFI: ${cribAdmission}`, styles: { textColor: [236, 72, 153], fontStyle: 'normal' } },
                crib.pathology || '',
                crib.status || '',
                cribDevices,
                cribObservation
            ]);
        }
    });

    if (tableBody.length === 0) {
        tableBody.push([{ content: 'No hay pacientes registrados.', colSpan: 6, styles: { halign: 'center' } }]);
    }

    autoTable(doc, {
        startY: currentY,
        head: tableHeaders,
        body: tableBody,
        theme: 'plain',
        styles: { fontSize: 8, cellPadding: 1, lineColor: [200, 200, 200], lineWidth: 0.1, overflow: 'linebreak' },
        headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', lineWidth: 0.1, lineColor: [180, 180, 180] },
        columnStyles: { 0: { cellWidth: 15 }, 1: { cellWidth: 35 }, 2: { cellWidth: 40 }, 3: { cellWidth: 15 }, 4: { cellWidth: 25 }, 5: { cellWidth: 'auto' } },
        didParseCell: (data: unknown) => {
            const hookData = data as CellHookData;
            if (hookData.section === 'body' && hookData.column.index === 3) {
                const status = (hookData.cell.raw as string || '').toLowerCase();
                if (status === 'grave') { hookData.cell.styles.textColor = [185, 28, 28]; hookData.cell.styles.fontStyle = 'bold'; }
                else if (status === 'de cuidado') { hookData.cell.styles.textColor = [194, 65, 12]; }
                else if (status === 'estable') { hookData.cell.styles.textColor = [21, 128, 61]; }
            }
        },
        didDrawCell: (data: unknown) => {
            const hookData = data as CellHookData;
            if (hookData.section === 'body' && hookData.column.index === 0) {
                const rowData = tableBody[hookData.row.index];
                const daysStr = (rowData as unknown as { _daysStr: string })._daysStr;
                if (daysStr) {
                    doc.setFontSize(7);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(120, 120, 120);
                    doc.text(daysStr, hookData.cell.x + hookData.cell.width / 2, hookData.cell.y + hookData.cell.height - 2, { align: 'center' });
                    doc.setTextColor(0, 0, 0);
                }
            }
        }
    });

    return (doc as JsPDFWithAutoTable).lastAutoTable.finalY || currentY;
};

// ============================================================================
// Section: Summary of Movements
// ============================================================================

export const addMovementsSummary = (doc: jsPDF, record: DailyRecord, margin: number, startY: number, autoTable: AutoTableFunction) => {
    let currentY = startY;
    const pageHeight = doc.internal.pageSize.height;

    if (currentY + 40 > pageHeight) {
        doc.addPage();
        currentY = margin;
    } else {
        currentY += 4;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('RESUMEN DE MOVIMIENTOS', margin, currentY);
    currentY += 6;

    // Altas
    doc.setFontSize(9);
    doc.text('ALTAS:', margin, currentY);
    if (record.discharges && record.discharges.length > 0) {
        currentY += 2;
        autoTable(doc, {
            startY: currentY,
            head: [['Cama', 'Paciente', 'Diagnóstico', 'Destino/Tipo']],
            body: record.discharges.map(d => [d.bedName, d.patientName + (d.rut ? ` - ${d.rut}` : ''), d.diagnosis, d.status === 'Fallecido' ? 'Fallecido' : (d.dischargeType || 'Domicilio')]),
            theme: 'plain',
            styles: { fontSize: 8, cellPadding: 1, lineColor: [200, 200, 200], lineWidth: 0.1 },
            headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' }
        });
        currentY = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 4;
    } else {
        doc.setFont('helvetica', 'italic');
        doc.text(' Sin altas', margin + 12, currentY);
        currentY += 5;
    }

    // Traslados
    doc.setFont('helvetica', 'bold');
    doc.text('TRASLADOS:', margin, currentY);
    if (record.transfers && record.transfers.length > 0) {
        currentY += 2;
        autoTable(doc, {
            startY: currentY,
            head: [['Origen', 'Paciente', 'Diagnóstico', 'Destino', 'Medio']],
            body: record.transfers.map(t => [t.bedName, t.patientName, t.diagnosis, t.receivingCenter, t.evacuationMethod]),
            theme: 'plain',
            styles: { fontSize: 8, cellPadding: 1, lineColor: [200, 200, 200], lineWidth: 0.1 },
            headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' }
        });
        currentY = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 4;
    } else {
        doc.setFont('helvetica', 'italic');
        doc.text(' Sin traslados', margin + 22, currentY);
        currentY += 5;
    }

    // CMA
    doc.setFont('helvetica', 'bold');
    doc.text('HOSPITALIZACIÓN DIURNA (CMA):', margin, currentY);
    if (record.cma && record.cma.length > 0) {
        currentY += 2;
        autoTable(doc, {
            startY: currentY,
            head: [['Paciente', 'RUT', 'Intervención', 'Tipo']],
            body: record.cma.map(c => [c.patientName, c.rut, c.diagnosis, c.interventionType]),
            theme: 'plain',
            styles: { fontSize: 8, cellPadding: 1, lineColor: [200, 200, 200], lineWidth: 0.1 },
            headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' }
        });
        currentY = (doc as JsPDFWithAutoTable).lastAutoTable.finalY + 4;
    } else {
        doc.setFont('helvetica', 'italic');
        doc.text(' Sin hospitalizaciones diurnas', margin + 55, currentY);
        currentY += 5;
    }

    return currentY;
};

// ============================================================================
// Section: Header
// ============================================================================

export const addHandoffHeader = async (
    doc: jsPDF,
    record: DailyRecord,
    isMedical: boolean,
    selectedShift: ShiftType,
    schedule: Schedule,
    margin: number,
    logoSize: number
) => {
    const pageWidth = doc.internal.pageSize.width;

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

    return margin + 18;
};

// ============================================================================
// Section: Staff and Checklist
// ============================================================================

export const addStaffAndChecklist = (
    doc: jsPDF,
    record: DailyRecord,
    selectedShift: ShiftType,
    margin: number,
    startY: number
) => {
    let currentY = startY;
    const { delivers, receives, tens } = getHandoffStaffInfo(record, selectedShift);
    const COLUMN_DELIVERS_X = margin;
    const COLUMN_RECEIVES_X = margin + 65;
    const COLUMN_TENS_X = margin + 125;
    const COLUMN_WIDTH = 55;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bolditalic');
    doc.text('ENFERMERO(A) ENTREGA:', COLUMN_DELIVERS_X, currentY);
    doc.text('ENFERMERO(A) RECIBE:', COLUMN_RECEIVES_X, currentY);
    doc.text('TENS DE TURNO:', COLUMN_TENS_X, currentY);

    currentY += 4;
    doc.setFont('helvetica', 'normal');

    const deliversText = delivers.filter(Boolean).join(', ') || '-';
    const receivesText = receives.filter(Boolean).join(', ') || '-';
    const tensText = tens.filter(Boolean).join(', ') || '-';

    const deliversWrapped = doc.splitTextToSize(deliversText, COLUMN_WIDTH);
    const receivesWrapped = doc.splitTextToSize(receivesText, COLUMN_WIDTH);
    const tensWrapped = doc.splitTextToSize(tensText, COLUMN_WIDTH + 15);

    doc.text(deliversWrapped, COLUMN_DELIVERS_X, currentY);
    doc.text(receivesWrapped, COLUMN_RECEIVES_X, currentY);
    doc.text(tensWrapped, COLUMN_TENS_X, currentY);

    const maxLines = Math.max(deliversWrapped.length, receivesWrapped.length, tensWrapped.length);
    currentY += (maxLines * 4) + 1;

    // Checklist
    const checklist = selectedShift === 'day' ? record.handoffDayChecklist : record.handoffNightChecklist;
    if (checklist) {
        const checklistItems: string[] = [];
        type FullChecklist = {
            escalaBraden?: boolean;
            escalaRiesgoCaidas?: boolean;
            escalaRiesgoLPP?: boolean;
            estadistica?: boolean;
            categorizacionCudyr?: boolean;
            encuestaUTI?: boolean;
            encuestaMedias?: boolean;
            conteoMedicamento?: boolean;
            conteoNoControlados?: boolean;
            conteoNoControladosProximaFecha?: string;
        };

        const cl = checklist as FullChecklist;
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

    return currentY;
};

// ============================================================================
// Section: Novedades
// ============================================================================

export const addNovedadesSection = (
    doc: jsPDF,
    novedadesText: string | undefined,
    margin: number,
    startY: number
) => {
    let currentY = startY;
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    if (!novedadesText) return currentY;

    if (currentY + 20 > pageHeight) {
        doc.addPage();
        currentY = margin;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('NOVEDADES DEL TURNO', margin, currentY);
    currentY += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    const lines = novedadesText.split(/\r?\n/);
    let novedadesY = currentY;
    for (const line of lines) {
        if (line.trim() === '') {
            novedadesY += 2;
        } else {
            const cleanLine = line.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
            const wrappedLines = doc.splitTextToSize(cleanLine, pageWidth - (margin * 2));
            doc.text(wrappedLines, margin, novedadesY);
            novedadesY += (wrappedLines.length * 4);
        }
        if (novedadesY > pageHeight - margin) {
            doc.addPage();
            novedadesY = margin;
        }
    }
    return novedadesY + 6;
};

// ============================================================================
// Section: CUDYR (Nursing Night only)
// ============================================================================

export const addCudyrTable = (doc: jsPDF, record: DailyRecord, margin: number, autoTable: AutoTableFunction) => {
    doc.addPage();
    let currentY = margin;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text('PUNTAJE CUDYR', margin, currentY);
    currentY += 10;

    const cudyrHeaders = ['Cama', 'Nombre', 'Ropa', 'Movil', 'Alim', 'Elim', 'Psico', 'Vigi', 'S.Vit', 'Bal', 'O2', 'Aere', 'Intv', 'Piel', 'Tto', 'Inv', 'Cat'];
    const cudyrBody: (string | number)[][] = [];

    BEDS.forEach(bedDef => {
        const patient = record.beds[bedDef.id];
        if (!patient || !patient.patientName) return;

        const c = (patient.cudyr || {}) as CudyrScore;
        const depScore = (c.changeClothes || 0) + (c.mobilization || 0) + (c.feeding || 0) + (c.elimination || 0) + (c.psychosocial || 0) + (c.surveillance || 0);
        const riskScore = (c.vitalSigns || 0) + (c.fluidBalance || 0) + (c.oxygenTherapy || 0) + (c.airway || 0) + (c.proInterventions || 0) + (c.skinCare || 0) + (c.pharmacology || 0) + (c.invasiveElements || 0);

        const depCat = depScore >= 13 ? '1' : (depScore >= 7 ? '2' : '3');
        const riskCat = riskScore >= 19 ? 'A' : (riskScore >= 12 ? 'B' : (riskScore >= 6 ? 'C' : 'D'));

        const nameParts = patient.patientName.split(' ');
        const shortName = nameParts.length > 1 ? `${nameParts[0]} ${nameParts[1].charAt(0)}.` : nameParts[0];

        cudyrBody.push([
            bedDef.name, shortName,
            c.changeClothes || 0, c.mobilization || 0, c.feeding || 0, c.elimination || 0, c.psychosocial || 0, c.surveillance || 0,
            c.vitalSigns || 0, c.fluidBalance || 0, c.oxygenTherapy || 0, c.airway || 0, c.proInterventions || 0, c.skinCare || 0, c.pharmacology || 0, c.invasiveElements || 0,
            (depScore > 0 || riskScore > 0) ? `${riskCat}${depCat}` : '-'
        ]);
    });

    autoTable(doc, {
        startY: currentY,
        head: [cudyrHeaders],
        body: cudyrBody,
        theme: 'grid',
        styles: { fontSize: 7, halign: 'center', cellPadding: 1, lineColor: [100, 100, 100], lineWidth: 0.1 },
        headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', lineWidth: 0.1 },
        columnStyles: { 0: { cellWidth: 12, halign: 'left', fontStyle: 'bold' }, 1: { cellWidth: 35, halign: 'left' } },
        didParseCell: (data: unknown) => {
            const hookData = data as CellHookData;
            if (hookData.section === 'body' && hookData.column.index === 16) {
                const val = hookData.cell.raw as string;
                if (val.startsWith('A')) { hookData.cell.styles.fillColor = [220, 38, 38]; hookData.cell.styles.textColor = 255; }
                else if (val.startsWith('B')) { hookData.cell.styles.fillColor = [249, 115, 22]; hookData.cell.styles.textColor = 255; }
                else if (val.startsWith('C')) { hookData.cell.styles.fillColor = [250, 204, 21]; hookData.cell.styles.textColor = 0; }
                else if (val.startsWith('D')) { hookData.cell.styles.fillColor = [22, 163, 74]; hookData.cell.styles.textColor = 255; }
            }
        }
    });

    return (doc as JsPDFWithAutoTable).lastAutoTable.finalY || currentY;
};

// ============================================================================
// Section: Page Numbers
// ============================================================================

export const addPageFooter = (doc: jsPDF, margin: number) => {
    const pageCount = doc.getNumberOfPages();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 100, 100);
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.text(`Página ${i} de ${pageCount}`, pageWidth - margin, pageHeight - margin + 4, { align: 'right' });
    }
};
