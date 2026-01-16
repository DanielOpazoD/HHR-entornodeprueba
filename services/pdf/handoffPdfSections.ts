import type { jsPDF } from 'jspdf';
// import autoTable from 'jspdf-autotable'; // Removed static import
import { DailyRecord, PatientData, ShiftType, CudyrScore, DeviceDetails } from '../../types';
import { BEDS } from '../../constants';
import { formatDateDDMMYYYY } from '../dataService';
import { calculateHospitalizedDays } from './handoffPdfUtils';

// ============================================================================
// Section: Patient Table
// ============================================================================

export const addPatientTable = (
    doc: jsPDF,
    record: DailyRecord,
    isMedical: boolean,
    selectedShift: ShiftType,
    currentY: number,
    autoTable: any
) => {
    const tableHeaders = [['Cama', 'Paciente', 'Diagnóstico', 'Est', 'DMI', 'Observaciones']];
    type TableRow = (string | { content: string; colSpan?: number; styles?: any; } | { content: string; styles: any })[] & { _daysStr?: string };
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

        let observation = isMedical
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
        (row as any)._daysStr = daysStr;
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
        didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 3) {
                const status = (data.cell.raw as string || '').toLowerCase();
                if (status === 'grave') { data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold'; }
                else if (status === 'de cuidado') { data.cell.styles.textColor = [194, 65, 12]; }
                else if (status === 'estable') { data.cell.styles.textColor = [21, 128, 61]; }
            }
        },
        didDrawCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 0) {
                const rowData = tableBody[data.row.index];
                const daysStr = (rowData as any)._daysStr;
                if (daysStr) {
                    doc.setFontSize(7);
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(120, 120, 120);
                    doc.text(daysStr, data.cell.x + data.cell.width / 2, data.cell.y + data.cell.height - 2, { align: 'center' });
                    doc.setTextColor(0, 0, 0);
                }
            }
        }
    });

    return (doc as any).lastAutoTable.finalY || currentY;
};

// ============================================================================
// Section: Summary of Movements
// ============================================================================

export const addMovementsSummary = (doc: jsPDF, record: DailyRecord, margin: number, startY: number, autoTable: any) => {
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
        currentY = (doc as any).lastAutoTable.finalY + 4;
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
        currentY = (doc as any).lastAutoTable.finalY + 4;
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
        currentY = (doc as any).lastAutoTable.finalY + 4;
    } else {
        doc.setFont('helvetica', 'italic');
        doc.text(' Sin hospitalizaciones diurnas', margin + 55, currentY);
        currentY += 5;
    }

    return currentY;
};

// ============================================================================
// Section: CUDYR (Nursing Night only)
// ============================================================================

export const addCudyrTable = (doc: jsPDF, record: DailyRecord, margin: number, autoTable: any) => {
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

        let depCat = depScore >= 13 ? '1' : (depScore >= 7 ? '2' : '3');
        let riskCat = riskScore >= 19 ? 'A' : (riskScore >= 12 ? 'B' : (riskScore >= 6 ? 'C' : 'D'));

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
        didParseCell: (data: any) => {
            if (data.section === 'body' && data.column.index === 16) {
                const val = data.cell.raw as string;
                if (val.startsWith('A')) { data.cell.styles.fillColor = [220, 38, 38]; data.cell.styles.textColor = 255; }
                else if (val.startsWith('B')) { data.cell.styles.fillColor = [249, 115, 22]; data.cell.styles.textColor = 255; }
                else if (val.startsWith('C')) { data.cell.styles.fillColor = [250, 204, 21]; data.cell.styles.textColor = 0; }
                else if (val.startsWith('D')) { data.cell.styles.fillColor = [22, 163, 74]; data.cell.styles.textColor = 255; }
            }
        }
    });

    return (doc as any).lastAutoTable.finalY || currentY;
};
