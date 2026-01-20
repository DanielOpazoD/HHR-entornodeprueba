import type { Workbook, Worksheet, Fill, Font } from 'exceljs';
import { DailyRecord, PatientData, DischargeData, TransferData, CMAData } from '../../types';
import { BEDS } from '../../constants';
import { calculateStats, CensusStatistics } from '../calculations/statsCalculator';
import { createWorkbook, BORDER_THIN, HEADER_FILL } from './excelUtils';

// Local styles specific to this workbook
const FREE_FILL: Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF7F7F7' }
};

const TITLE_STYLE = { bold: true, size: 11 } satisfies Partial<Font>;

/**
 * Build the formatted "Censo Maestro" workbook from an array of daily records.
 * The records should contain one entry per day of the month (up to the selected day),
 * sorted ascending by date.
 */
export const buildCensusMasterWorkbook = async (records: DailyRecord[]): Promise<Workbook> => {
    if (!records || records.length === 0) {
        throw new Error('No hay registros disponibles para generar el Excel maestro.');
    }

    const sortedRecords = [...records].sort((a, b) => a.date.localeCompare(b.date));
    const workbook = await createWorkbook();
    workbook.creator = 'Hospital Hanga Roa';
    workbook.created = new Date();

    sortedRecords.forEach(record => {
        createDaySheet(workbook, record);
    });

    return workbook;
};

/**
 * Return a Node-friendly buffer for the workbook.
 */
export const buildCensusMasterBuffer = async (records: DailyRecord[]): Promise<Buffer> => {
    const workbook = await buildCensusMasterWorkbook(records);
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
};

/**
 * Helper to build the canonical filename for the master census export.
 * Format: "Censo diario HHR DD-MM-YYYY.xlsx"
 */
export const getCensusMasterFilename = (date: string): string => {
    const [year, month, day] = date.split('-');
    const formattedDate = `${day}-${month}-${year}`;
    return `Censo diario HHR ${formattedDate}.xlsx`;
};

// ============================================================================
// SHEET CREATION
// ============================================================================

/**
 * Create a worksheet for a single day's record
 */
function createDaySheet(workbook: Workbook, record: DailyRecord): void {
    // Sheet name: "DD-MM-YYYY" format (e.g., 15-12-2025)
    const [year, month, day] = record.date.split('-');
    const sheetName = `${day}-${month}-${year}`;

    const sheet = workbook.addWorksheet(sheetName, {
        pageSetup: { paperSize: 9, orientation: 'landscape' }
    });

    let currentRow = 1;

    // 1. Header Section
    currentRow = addHeaderSection(sheet, record, currentRow);
    currentRow += 1; // blank row

    // 2. Summary Section
    const stats = calculateStats(record.beds);
    currentRow = addSummarySection(sheet, record, stats, currentRow);
    currentRow += 1; // blank row

    // 3. Census Table
    currentRow = addCensusTable(sheet, record, currentRow);
    currentRow += 1; // blank row

    // 4. Discharges Table (always show, even if empty)
    currentRow = addDischargesTable(sheet, record.discharges || [], currentRow);
    currentRow += 1;

    // 5. Transfers Table (always show, even if empty)
    currentRow = addTransfersTable(sheet, record.transfers || [], currentRow);
    currentRow += 1;

    // 6. CMA Table (always show, even if empty)
    addCMATable(sheet, record.cma || [], currentRow);

    // Column widths tailored for a compact, legible layout
    const widths = [4, 10, 9, 24, 16, 8, 28, 16, 12, 12, 7, 7, 7, 7, 18];
    widths.forEach((width, idx) => {
        if (sheet.columns[idx]) {
            sheet.columns[idx].width = width;
        }
    });
}

// ============================================================================
// HEADER SECTION
// ============================================================================

function addHeaderSection(sheet: Worksheet, record: DailyRecord, startRow: number): number {
    const [year, month, day] = record.date.split('-');
    const formattedDate = `${day}-${month}-${year}`;

    // Title
    const titleRow = sheet.getRow(startRow);
    titleRow.getCell(1).value = 'CENSO CAMAS DIARIO - HOSPITAL HANGA ROA';
    titleRow.getCell(1).font = { bold: true, size: 14 };
    sheet.mergeCells(startRow, 1, startRow, 6);

    // Date
    const dateRow = sheet.getRow(startRow + 1);
    dateRow.getCell(1).value = `Fecha: ${formattedDate}`;
    dateRow.getCell(1).font = { bold: true };

    // Nurses (Night Shift only as per requirement)
    const nurses = record.nursesNightShift?.filter(n => n && n.trim()) || [];
    const nurseText = nurses.length > 0 ? nurses.join(', ') : 'Sin asignar';
    const nurseRow = sheet.getRow(startRow + 2);
    nurseRow.getCell(1).value = `Enfermeros/as Turno Noche: ${nurseText}`;
    nurseRow.getCell(1).font = { italic: true };

    return startRow + 3;
}

// ============================================================================
// SUMMARY SECTION
// ============================================================================

function addSummarySection(
    sheet: Worksheet,
    record: DailyRecord,
    stats: CensusStatistics,
    startRow: number
): number {
    // Calculate movement counts
    const discharges = record.discharges || [];
    const transfers = record.transfers || [];
    const cma = record.cma || [];
    const deceased = discharges.filter(d => d.status === 'Fallecido').length;
    const altas = discharges.filter(d => d.status === 'Vivo').length;

    // Row 1: Section headers
    const headerRow = sheet.getRow(startRow);
    headerRow.getCell(1).value = 'CENSO CAMAS';
    headerRow.getCell(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    sheet.mergeCells(startRow, 1, startRow, 4);

    headerRow.getCell(5).value = 'MOVIMIENTOS';
    headerRow.getCell(5).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF70AD47' } };
    sheet.mergeCells(startRow, 5, startRow, 8);

    // Row 2: Labels
    const labelRow = sheet.getRow(startRow + 1);
    labelRow.getCell(1).value = 'Ocupadas';
    labelRow.getCell(2).value = 'Libres';
    labelRow.getCell(3).value = 'Bloqueadas';
    labelRow.getCell(4).value = 'Cunas';
    labelRow.getCell(5).value = 'Altas';
    labelRow.getCell(6).value = 'Traslados';
    labelRow.getCell(7).value = 'Hosp. Diurna';
    labelRow.getCell(8).value = 'Fallecidos';
    labelRow.eachCell(cell => {
        cell.font = { bold: true, size: 9 };
        cell.alignment = { horizontal: 'center' };
    });

    // Row 3: Values
    const valueRow = sheet.getRow(startRow + 2);
    valueRow.getCell(1).value = stats.occupiedBeds;
    valueRow.getCell(2).value = stats.availableCapacity;
    valueRow.getCell(3).value = stats.blockedBeds;
    valueRow.getCell(4).value = stats.clinicalCribsCount + stats.companionCribs;
    valueRow.getCell(5).value = altas;
    valueRow.getCell(6).value = transfers.length;
    valueRow.getCell(7).value = cma.length;
    valueRow.getCell(8).value = deceased;
    valueRow.eachCell(cell => {
        cell.alignment = { horizontal: 'center' };
    });

    return startRow + 3;
}

// ============================================================================
// CENSUS TABLE
// ============================================================================

function addCensusTable(sheet: Worksheet, record: DailyRecord, startRow: number): number {
    const titleRow = sheet.getRow(startRow);
    titleRow.getCell(1).value = 'TABLA DE PACIENTES HOSPITALIZADOS';
    titleRow.getCell(1).font = TITLE_STYLE;
    startRow += 1;

    const headers = ['#', 'Cama', 'Tipo', 'Paciente', 'RUT', 'Edad', 'Diagnóstico', 'Especialidad', 'F. Ingreso', 'Estado', 'Braz', 'C.QX', 'UPC', 'Disp.'];
    const headerRow = sheet.getRow(startRow);
    headers.forEach((h, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = h;
        cell.font = { bold: true, size: 10 };
        cell.fill = HEADER_FILL;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = BORDER_THIN;
    });

    let currentRow = startRow + 1;
    let index = 1;


    BEDS.forEach(bed => {
        const patient = record.beds[bed.id];
        // Only include extra beds if they are occupied (have a patient name)
        const shouldRenderExtra = !bed.isExtra || Boolean(patient?.patientName?.trim());
        if (!shouldRenderExtra) return;

        const hasClinicalCrib = Boolean(patient?.clinicalCrib?.patientName?.trim());
        currentRow = addCensusRow(sheet, currentRow, index++, bed.id, bed.type, patient);

        if (hasClinicalCrib && patient?.clinicalCrib) {
            currentRow = addCensusRow(sheet, currentRow, index++, `${bed.id}-C`, 'Cuna', patient.clinicalCrib, patient.location);
        }
    });

    return currentRow;
}

function addCensusRow(
    sheet: Worksheet,
    rowNumber: number,
    index: number,
    bedId: string,
    bedType: string,
    patient?: PatientData,
    locationOverride?: string
): number {
    const row = sheet.getRow(rowNumber);
    const patientName = patient?.patientName?.trim();
    const isBlocked = Boolean(patient?.isBlocked);
    const isFree = !isBlocked && (!patient || !patientName);
    const blockedDetail = patient?.blockedReason?.trim();

    const values = [
        index,
        locationOverride ? `${bedId} (${locationOverride})` : bedId,
        mapBedType(bedType),
        isBlocked ? 'BLOQUEADA' : patient?.patientName || (isFree ? 'Libre' : ''),
        patient?.rut || '',
        formatAge(patient?.age),
        patient?.pathology || '',
        patient?.specialty || '',
        formatDateDDMMYYYY(patient?.admissionDate),
        isBlocked ? 'Bloqueada' : patient?.status || (isFree ? 'Libre' : ''),
        patient ? (patient.hasWristband ? 'Sí' : 'No') : 'No',
        patient ? (patient.surgicalComplication ? 'Sí' : 'No') : 'No',
        patient ? (patient.isUPC ? 'Sí' : 'No') : 'No',
        patient?.devices?.join(', ') || ''
    ];

    values.forEach((value, idx) => {
        const cell = row.getCell(idx + 1);
        cell.value = value;
        const alignCenter = idx <= 2 || (idx >= 10 && idx <= 12);
        cell.alignment = {
            vertical: 'middle',
            wrapText: true,
            horizontal: alignCenter ? 'center' : 'left'
        };
        cell.border = BORDER_THIN;

        if (isBlocked) {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE5D6' } };
        }
    });

    if (isFree || isBlocked) {
        const label = isBlocked
            ? `Bloqueada${blockedDetail ? ` - ${blockedDetail}` : ''}`
            : 'Libre';

        row.getCell(4).value = label;
        row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        row.getCell(4).font = { bold: true };
        row.getCell(4).border = BORDER_THIN;
        row.getCell(4).fill = isBlocked
            ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE5D6' } }
            : FREE_FILL;

        sheet.mergeCells(rowNumber, 4, rowNumber, 14);
    }

    return rowNumber + 1;
}

// ============================================================================
// DISCHARGES TABLE
// ============================================================================

function addDischargesTable(sheet: Worksheet, discharges: DischargeData[], startRow: number): number {
    const titleRow = sheet.getRow(startRow);
    titleRow.getCell(1).value = 'ALTAS DEL DÍA';
    titleRow.getCell(1).font = TITLE_STYLE;
    startRow += 1;

    const headers = ['#', 'Cama', 'Tipo', 'Paciente', 'RUT', 'Edad', 'Diagnóstico', 'Estado', 'Tipo Alta'];
    const headerRow = sheet.getRow(startRow);
    headers.forEach((h, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = h;
        cell.font = { bold: true, size: 10 };
        cell.fill = HEADER_FILL;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = BORDER_THIN;
    });

    let currentRow = startRow + 1;
    if (discharges.length === 0) {
        const row = sheet.getRow(currentRow);
        row.getCell(1).value = 'Sin altas registradas';
        row.getCell(1).font = { italic: true };
        sheet.mergeCells(currentRow, 1, currentRow, headers.length);
        return currentRow + 1;
    }

    discharges.forEach((d, idx) => {
        const row = sheet.getRow(currentRow);
        const values = [
            idx + 1,
            d.bedName || d.bedId || '',
            d.bedType || '',
            d.patientName || '',
            d.rut || '',
            formatAge(d.age),
            d.diagnosis || '',
            d.status || '',
            d.dischargeTypeOther || d.dischargeType || 'N/A'
        ];

        values.forEach((value, cellIdx) => {
            const cell = row.getCell(cellIdx + 1);
            cell.value = value;
            cell.alignment = { vertical: 'middle', wrapText: true, horizontal: cellIdx <= 2 ? 'center' : 'left' };
            cell.border = BORDER_THIN;
        });

        currentRow++;
    });

    return currentRow;
}

// ============================================================================
// TRANSFERS TABLE
// ============================================================================

function addTransfersTable(sheet: Worksheet, transfers: TransferData[], startRow: number): number {
    const titleRow = sheet.getRow(startRow);
    titleRow.getCell(1).value = 'TRASLADOS DEL DÍA';
    titleRow.getCell(1).font = TITLE_STYLE;
    startRow += 1;

    const headers = ['#', 'Cama', 'Tipo', 'Paciente', 'RUT', 'Edad', 'Diagnóstico', 'Centro Destino', 'Evacuación'];
    const headerRow = sheet.getRow(startRow);
    headers.forEach((h, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = h;
        cell.font = { bold: true, size: 10 };
        cell.fill = HEADER_FILL;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = BORDER_THIN;
    });

    let currentRow = startRow + 1;
    if (transfers.length === 0) {
        const row = sheet.getRow(currentRow);
        row.getCell(1).value = 'Sin traslados registrados';
        row.getCell(1).font = { italic: true };
        sheet.mergeCells(currentRow, 1, currentRow, headers.length);
        return currentRow + 1;
    }

    transfers.forEach((t, idx) => {
        const destination = t.receivingCenterOther || t.receivingCenter || '';
        const row = sheet.getRow(currentRow);
        const values = [
            idx + 1,
            t.bedName || t.bedId || '',
            t.bedType || '',
            t.patientName || '',
            t.rut || '',
            formatAge(t.age),
            t.diagnosis || '',
            destination,
            t.evacuationMethod || ''
        ];

        values.forEach((value, cellIdx) => {
            const cell = row.getCell(cellIdx + 1);
            cell.value = value;
            cell.alignment = { vertical: 'middle', wrapText: true, horizontal: cellIdx <= 2 ? 'center' : 'left' };
            cell.border = BORDER_THIN;
        });

        currentRow++;
    });

    return currentRow;
}

// ============================================================================
// CMA TABLE
// ============================================================================

function addCMATable(sheet: Worksheet, cma: CMAData[], startRow: number): number {
    const titleRow = sheet.getRow(startRow);
    titleRow.getCell(1).value = 'HOSPITALIZACIÓN DIURNA (CMA)';
    titleRow.getCell(1).font = TITLE_STYLE;
    startRow += 1;

    const headers = ['#', 'Cama', 'Tipo', 'Paciente', 'RUT', 'Edad', 'Diagnóstico', 'Especialidad', 'Tipo'];
    const headerRow = sheet.getRow(startRow);
    headers.forEach((h, idx) => {
        const cell = headerRow.getCell(idx + 1);
        cell.value = h;
        cell.font = { bold: true, size: 10 };
        cell.fill = HEADER_FILL;
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.border = BORDER_THIN;
    });

    let currentRow = startRow + 1;
    if (cma.length === 0) {
        const row = sheet.getRow(currentRow);
        row.getCell(1).value = 'Sin hospitalización diurna';
        row.getCell(1).font = { italic: true };
        sheet.mergeCells(currentRow, 1, currentRow, headers.length);
        return currentRow + 1;
    }

    cma.forEach((c, idx) => {
        const row = sheet.getRow(currentRow);
        const values = [
            idx + 1,
            c.bedName || '',
            'MEDIA',
            c.patientName || '',
            c.rut || '',
            formatAge(c.age),
            c.diagnosis || '',
            c.specialty || '',
            c.interventionType || ''
        ];

        values.forEach((value, cellIdx) => {
            const cell = row.getCell(cellIdx + 1);
            cell.value = value;
            cell.alignment = { vertical: 'middle', wrapText: true, horizontal: cellIdx <= 2 ? 'center' : 'left' };
            cell.border = BORDER_THIN;
        });

        currentRow++;
    });

    return currentRow;
}

/**
 * Format a date string from YYYY-MM-DD to DD-MM-YYYY
 * 
 * IMPORTANT: We parse the date string directly instead of using new Date()
 * because new Date("YYYY-MM-DD") interprets the date as UTC midnight,
 * which can shift to the previous day in timezones behind UTC (like Chile).
 * 
 * @param date - Date string in YYYY-MM-DD format
 * @returns Date string in DD-MM-YYYY format
 */
function formatDateDDMMYYYY(date?: string): string {
    if (!date) return '';

    // Parse YYYY-MM-DD format directly without Date object to avoid timezone issues
    const parts = date.split('-');
    if (parts.length !== 3) return date; // Return original if not expected format

    const [year, month, day] = parts;

    // Validate parts are numeric
    if (!year || !month || !day) return date;
    if (!/^\d{4}$/.test(year) || !/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) {
        return date;
    }

    // Return in DD-MM-YYYY format
    return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`;
}

function formatAge(age?: string): string {
    if (!age) return '';
    const trimmed = age.trim();
    if (/^\d+$/.test(trimmed)) {
        return `${trimmed}a`;
    }
    if (/^\d+\s*a$/i.test(trimmed)) {
        return trimmed.replace(/\s+/g, '');
    }
    return trimmed;
}

function mapBedType(type: string): string {
    if (type.toLowerCase() === 'cuna') return 'MEDIA';
    return type.toUpperCase();
}
