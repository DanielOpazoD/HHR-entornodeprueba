import type { jsPDF } from 'jspdf';
import type { UserOptions } from 'jspdf-autotable';
import { DailyRecord, PatientData, PatientStatus, HandoffData, ShiftType } from '../../types';
import { BEDS } from '../../constants';
import { formatDateDDMMYYYY } from '../dataService';

// Force autotable types augmentation
declare module 'jspdf' {
    interface jsPDF {
        lastAutoTable: { finalY: number };
    }
}

// Helper to convert image to DataURI
const getBase64ImageFromURL = (url: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.src = url;
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d");
            ctx?.drawImage(img, 0, 0);
            const dataURL = canvas.toDataURL("image/png");
            resolve(dataURL);
        };
        img.onerror = (error) => reject(error);
    });
};

/**
 * Generate a lightweight PDF for the Handoff report
 */
export const generateHandoffPdf = async (
    record: DailyRecord,
    isMedical: boolean,
    selectedShift: ShiftType,
    schedule: any
) => {
    // Dynamic imports
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
        import('jspdf'),
        import('jspdf-autotable')
    ]);

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;

    // Config
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

    // Nurse/Staff Info (Below Header)
    let currentY = margin + 18;

    if (!isMedical) {
        // Get nurses who deliver and receive based on shift
        // Logic aligned with useHandoffLogic.ts for Single Source of Truth
        const delivers = selectedShift === 'day'
            ? (record.nursesDayShift || [])
            : (record.nursesNightShift || []);
        const receives = selectedShift === 'day'
            ? (record.nursesNightShift || [])
            : (record.handoffNightReceives || []);
        const tens = selectedShift === 'day'
            ? (record.tensDayShift || [])
            : (record.tensNightShift || []);

        // Line 1: Labels
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bolditalic');
        doc.text('ENFERMERO(A) ENTREGA:', margin, currentY);
        doc.text('ENFERMERO(A) RECIBE:', margin + 70, currentY);
        doc.text('TENS:', margin + 140, currentY);

        // Line 2: Names
        currentY += 4;
        doc.setFont('helvetica', 'normal');
        doc.text(delivers.filter(Boolean).join(', ') || '-', margin, currentY);
        doc.text(receives.filter(Boolean).join(', ') || '-', margin + 70, currentY);
        doc.text(tens.filter(Boolean).join(', ') || '-', margin + 140, currentY);

        currentY += 5;
    }

    // 2. CHECKLIST (Only Nursing) - All in one line with full names
    if (!isMedical) {
        const checklist = selectedShift === 'day' ? record.handoffDayChecklist : record.handoffNightChecklist;
        if (checklist) {
            const cl = checklist as any;
            const checklistItems: string[] = [];

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
                    if (proxDate) {
                        checklistItems.push(`Farmacos No-Controlados: OK (PROX: ${formatDateDDMMYYYY(proxDate)})`);
                    } else {
                        checklistItems.push('Farmacos No-Controlados: OK');
                    }
                }
            }

            // Display all in one line with smaller font
            doc.setFontSize(6);
            doc.setFont('helvetica', 'bold');
            const checklistText = checklistItems.length > 0
                ? `CHECKLIST: ${checklistItems.join(' | ')}`
                : 'CHECKLIST: Sin items completados';
            doc.text(checklistText, margin, currentY);
            doc.setFont('helvetica', 'normal');
            currentY += 4;
        }
    }

    // 3. PATIENT TABLE
    const tableHeaders = [['Cama', 'Paciente', 'Diagnóstico', 'Est', 'DMI', 'Observaciones']];

    const tableBody: any[] = [];

    // Helper to format devices
    const formatDevices = (p: any): string => {
        if (!p.devices || !Array.isArray(p.devices) || p.devices.length === 0) return '';
        // Map common device codes to cleaner text if needed, or join with days installed
        return p.devices.map((d: string) => {
            const detail = p.deviceDetails?.[d];
            let daysStr = '';
            if (detail?.installationDate) {
                // Calculate days since installation
                const installDate = new Date(detail.installationDate);
                const today = new Date(record.date);
                installDate.setHours(0, 0, 0, 0);
                today.setHours(0, 0, 0, 0);
                const diffTime = today.getTime() - installDate.getTime();
                const diffDays = Math.floor(diffTime / (1000 * 3600 * 24)) + 1; // +1 because day of install counts as day 1
                if (diffDays > 0) {
                    daysStr = ` (${diffDays}d)`;
                }
            }
            return `${d}${daysStr}`;
        }).join(', ');
    };

    // Beds processing
    // Iterate over BEDS constant to match system configuration
    BEDS.forEach(bedDef => {
        const bedId = bedDef.id;
        const patient = record.beds[bedId];

        // Skip purely empty beds if desired, or show empty row
        // Showing empty row maintains structure.
        if (!patient || !patient.patientName) return;

        // Bed Name Logic
        const bedName = bedDef.name;

        // Calculate days and admission date
        const admission = patient.admissionDate ? formatDateDDMMYYYY(patient.admissionDate) : '';
        const daysHosp = calculateHospitalizedDays(patient.admissionDate, record.date);
        const daysStr = daysHosp ? `${daysHosp}d` : '';

        // Row Data
        // Use correct field names: handoffNoteDayShift / handoffNoteNightShift
        const observationKey = isMedical ? 'medicalHandoffNote' : (selectedShift === 'day' ? 'handoffNoteDayShift' : 'handoffNoteNightShift');
        const observation = (patient as any)[observationKey] || '';

        const devicesStr = formatDevices(patient);

        tableBody.push(Object.assign([
            { content: bedName, styles: { halign: 'center', fontStyle: 'bold', valign: 'top' } },
            { content: `${patient.patientName}\n${patient.rut || ''} ${patient.age ? `(${patient.age})` : ''}\nFI: ${admission}`, styles: { fontStyle: 'normal' } }, // Name bold requires custom draw, setting normal for now to distinguish from header
            patient.pathology || '',
            patient.status || '',
            devicesStr,
            observation
        ], { _daysStr: daysStr }));

        // Clinical Crib (Sub-row)
        if (patient.clinicalCrib && patient.clinicalCrib.patientName) {
            const crib = patient.clinicalCrib;
            const cribObservation = (crib as any)[observationKey] || '';
            const cribDevices = formatDevices(crib);
            const cribAdmission = crib.admissionDate ? formatDateDDMMYYYY(crib.admissionDate) : '';

            tableBody.push([
                { content: 'Cuna', styles: { halign: 'center', textColor: [236, 72, 153] } }, // Pinkish
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
        styles: {
            fontSize: 8,
            cellPadding: 1,
            lineColor: [200, 200, 200],
            lineWidth: 0.1,
            overflow: 'linebreak'
        },
        headStyles: {
            fillColor: [240, 240, 240],
            textColor: 0,
            fontStyle: 'bold',
            lineWidth: 0.1,
            lineColor: [180, 180, 180]
        },
        columnStyles: {
            0: { cellWidth: 15 }, // Cama
            1: { cellWidth: 35 }, // Paciente
            2: { cellWidth: 40 }, // Diagnóstico
            3: { cellWidth: 15 }, // Estado
            4: { cellWidth: 25 }, // DMI
            5: { cellWidth: 'auto' } // Observaciones
        },
        didParseCell: (data) => {
            // Apply status colors logic - using actual PatientStatus enum values
            if (data.section === 'body' && data.column.index === 3) {
                const status = (data.cell.raw as string || '').toLowerCase();
                if (status === 'grave') {
                    data.cell.styles.textColor = [185, 28, 28]; // Red
                    data.cell.styles.fontStyle = 'bold';
                } else if (status === 'de cuidado') {
                    data.cell.styles.textColor = [194, 65, 12]; // Orange
                } else if (status === 'estable') {
                    data.cell.styles.textColor = [21, 128, 61]; // Green
                }
            }
        },
        didDrawCell: (data) => {
            // Draw days hospitalized below bed name in smaller gray font
            if (data.section === 'body' && data.column.index === 0) {
                const cellContent = data.cell.raw as string;
                // Look up days from our stored map
                const bedId = cellContent; // bedName like 'R2', 'NEO 1', etc
                const rowData = tableBody[data.row.index];
                if (rowData && rowData._daysStr) {
                    doc.setFontSize(7);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(120, 120, 120); // Gray color
                    const x = data.cell.x + data.cell.width / 2;
                    const y = data.cell.y + data.cell.height - 2;
                    doc.text(rowData._daysStr, x, y, { align: 'center' });
                    // Reset text color
                    doc.setTextColor(0, 0, 0);
                }
            }
        }
    });

    currentY = doc.lastAutoTable.finalY + 8;

    // 4. MOVIMIENTOS DEL DÍA (Discharges & Transfers) - ALWAYS SHOWN
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

    const hasDischarges = record.discharges && record.discharges.length > 0;
    const hasTransfers = record.transfers && record.transfers.length > 0;
    const hasCMA = record.cma && record.cma.length > 0;

    // A. Altas - Always show
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('ALTAS:', margin, currentY);
    if (hasDischarges) {
        currentY += 2;
        autoTable(doc, {
            startY: currentY,
            head: [['Cama', 'Paciente', 'Diagnóstico', 'Destino/Tipo']],
            body: record.discharges.map(d => [
                d.bedName,
                d.patientName + (d.rut ? ` - ${d.rut}` : ''),
                d.diagnosis,
                d.status === 'Fallecido' ? 'Fallecido' : (d.dischargeType || 'Domicilio')
            ]),
            theme: 'plain',
            styles: { fontSize: 8, cellPadding: 1, lineColor: [200, 200, 200], lineWidth: 0.1 },
            headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' }
        });
        currentY = doc.lastAutoTable.finalY + 4;
    } else {
        doc.setFont('helvetica', 'italic');
        doc.text(' Sin altas', margin + 12, currentY);
        currentY += 5;
    }

    // B. Traslados - Always show
    doc.setFont('helvetica', 'bold');
    doc.text('TRASLADOS:', margin, currentY);
    if (hasTransfers) {
        currentY += 2;
        autoTable(doc, {
            startY: currentY,
            head: [['Origen', 'Paciente', 'Diagnóstico', 'Destino', 'Medio']],
            body: record.transfers.map(t => [
                t.bedName,
                t.patientName,
                t.diagnosis,
                t.receivingCenter,
                t.evacuationMethod
            ]),
            theme: 'plain',
            styles: { fontSize: 8, cellPadding: 1, lineColor: [200, 200, 200], lineWidth: 0.1 },
            headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' }
        });
        currentY = doc.lastAutoTable.finalY + 4;
    } else {
        doc.setFont('helvetica', 'italic');
        doc.text(' Sin traslados', margin + 22, currentY);
        currentY += 5;
    }

    // C. CMA - Always show
    doc.setFont('helvetica', 'bold');
    doc.text('HOSPITALIZACIÓN DIURNA (CMA):', margin, currentY);
    if (hasCMA) {
        currentY += 2;
        autoTable(doc, {
            startY: currentY,
            head: [['Paciente', 'RUT', 'Intervención', 'Tipo']],
            body: record.cma.map(c => [
                c.patientName,
                c.rut,
                c.diagnosis,
                c.interventionType
            ]),
            theme: 'plain',
            styles: { fontSize: 8, cellPadding: 1, lineColor: [200, 200, 200], lineWidth: 0.1 },
            headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold' }
        });
        currentY = doc.lastAutoTable.finalY + 4;
    } else {
        doc.setFont('helvetica', 'italic');
        doc.text(' Sin hospitalizaciones diurnas', margin + 55, currentY);
        currentY += 5;
    }

    currentY += 4;

    // 5. NOVEDADES (at the end)
    const novedadesText = isMedical
        ? record.medicalHandoffNovedades
        : (selectedShift === 'day' ? record.handoffNovedadesDayShift : record.handoffNovedadesNightShift);

    if (novedadesText) {
        // Build block
        // Check for page break space
        if (currentY + 30 > pageHeight) {
            doc.addPage();
            currentY = margin;
        }

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text('NOVEDADES DEL TURNO', margin, currentY);
        currentY += 4;

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);

        // Preserve line breaks from original text
        // First, normalize line endings and split by newlines
        const lines = novedadesText.split(/\r?\n/);

        let novedadesY = currentY;
        for (const line of lines) {
            if (line.trim() === '') {
                // Empty line - add small spacing
                novedadesY += 2;
            } else {
                // Non-empty line - wrap if needed
                const cleanLine = line.replace(/[\u0000-\u001F\u007F-\u009F]/g, ""); // Remove control chars
                const wrappedLines = doc.splitTextToSize(cleanLine, pageWidth - (margin * 2));
                doc.text(wrappedLines, margin, novedadesY);
                novedadesY += (wrappedLines.length * 4);
            }

            // Check for page break
            if (novedadesY > pageHeight - margin) {
                doc.addPage();
                novedadesY = margin;
            }
        }
        currentY = novedadesY + 6;
    }

    // 5. CUDYR (Only Nursing Night)
    if (!isMedical && selectedShift === 'night') {
        doc.addPage();
        currentY = margin;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('PUNTAJE CUDYR', margin, currentY);
        currentY += 10;

        // CUDYR Table
        const cudyrHeaders = [
            'Cama',
            'Nombre',
            'Ropa', 'Movil', 'Alim', 'Elim', 'Psico', 'Vigi', // Dependencia
            'S.Vit', 'Bal', 'O2', 'Aere', 'Intv', 'Piel', 'Tto', 'Inv', // Riesgo
            'Cat' // Result
        ];

        const cudyrBody: any[] = [];

        BEDS.forEach(bedDef => {
            const bedId = bedDef.id;
            const patient = record.beds[bedId];
            if (!patient || !patient.patientName) return;

            const c = patient.cudyr || {};

            // Calculate Scores based on CudyrScoreUtils logic
            const depScore = (c.changeClothes || 0) + (c.mobilization || 0) + (c.feeding || 0) +
                (c.elimination || 0) + (c.psychosocial || 0) + (c.surveillance || 0);

            const riskScore = (c.vitalSigns || 0) + (c.fluidBalance || 0) + (c.oxygenTherapy || 0) +
                (c.airway || 0) + (c.proInterventions || 0) + (c.skinCare || 0) +
                (c.pharmacology || 0) + (c.invasiveElements || 0);

            let depCat = '3';
            if (depScore >= 13) depCat = '1';
            else if (depScore >= 7) depCat = '2';

            let riskCat = 'D';
            if (riskScore >= 19) riskCat = 'A';
            else if (riskScore >= 12) riskCat = 'B';
            else if (riskScore >= 6) riskCat = 'C';

            const finalCat = `${riskCat}${depCat}`;
            const isFilled = depScore > 0 || riskScore > 0;

            // Name format for Cudyr (Short)
            const nameParts = patient.patientName.split(' ');
            const shortName = nameParts.length > 1 ? `${nameParts[0]} ${nameParts[1].charAt(0)}.` : nameParts[0];

            // Use type assertion for cudyr props
            const cp = c as any;

            cudyrBody.push([
                bedDef.name,
                shortName,
                cp.changeClothes || 0,
                cp.mobilization || 0,
                cp.feeding || 0,
                cp.elimination || 0,
                cp.psychosocial || 0,
                cp.surveillance || 0,
                cp.vitalSigns || 0,
                cp.fluidBalance || 0,
                cp.oxygenTherapy || 0,
                cp.airway || 0,
                cp.proInterventions || 0,
                cp.skinCare || 0,
                cp.pharmacology || 0,
                cp.invasiveElements || 0,
                isFilled ? finalCat : '-'
            ]);
        });

        autoTable(doc, {
            startY: currentY,
            head: [cudyrHeaders],
            body: cudyrBody,
            theme: 'grid',
            styles: { fontSize: 7, halign: 'center', cellPadding: 1, lineColor: [100, 100, 100], lineWidth: 0.1 },
            headStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', lineWidth: 0.1 },
            columnStyles: {
                0: { cellWidth: 12, halign: 'left', fontStyle: 'bold' },
                1: { cellWidth: 35, halign: 'left' }
            },
            didParseCell: (data) => {
                // Colorize Category Cell
                if (data.section === 'body' && data.column.index === 16) {
                    const val = data.cell.raw as string;
                    if (val.startsWith('A')) { data.cell.styles.fillColor = [220, 38, 38]; data.cell.styles.textColor = 255; }
                    else if (val.startsWith('B')) { data.cell.styles.fillColor = [249, 115, 22]; data.cell.styles.textColor = 255; }
                    else if (val.startsWith('C')) { data.cell.styles.fillColor = [250, 204, 21]; data.cell.styles.textColor = 0; }
                    else if (val.startsWith('D')) { data.cell.styles.fillColor = [22, 163, 74]; data.cell.styles.textColor = 255; }
                }
            }
        });
    }

    // Output - Try to show "Save As" dialog if supported
    const fileName = isMedical
        ? `Entrega_Medica_${dateStr}.pdf`
        : `Entrega_${selectedShift === 'day' ? 'TL' : 'TN'}_${dateStr}.pdf`;

    // Use File System Access API if available (allows "Save As" dialog)
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await (window as any).showSaveFilePicker({
                suggestedName: fileName,
                types: [{
                    description: 'PDF Document',
                    accept: { 'application/pdf': ['.pdf'] }
                }]
            });
            const writable = await handle.createWritable();
            const pdfBlob = doc.output('blob');
            await writable.write(pdfBlob);
            await writable.close();
        } catch (err) {
            // User cancelled or API failed, fallback to regular download
            if ((err as Error).name !== 'AbortError') {
                doc.save(fileName);
            }
        }
    } else {
        // Fallback: direct download
        doc.save(fileName);
    }
};

// Utils (Duplicated to avoid import spiraling, lightweight version)
const calculateHospitalizedDays = (admissionDate?: string, currentDate?: string): number | null => {
    if (!admissionDate || !currentDate) return null;
    const start = new Date(admissionDate);
    const end = new Date(currentDate);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const diff = end.getTime() - start.getTime();
    const days = Math.floor(diff / (1000 * 3600 * 24));
    const totalDays = days + 1;
    return totalDays >= 1 ? totalDays : 1;
};
