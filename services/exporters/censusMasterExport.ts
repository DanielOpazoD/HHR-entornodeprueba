/**
 * Census Master Export Service
 * Generates a multi-sheet Excel file with one sheet per day of the month.
 * Uses the shared workbook builder to keep the email attachment and manual download in sync.
 * 
 * NOTE: Password encryption only works for email attachments (server-side via Netlify Function).
 * Manual downloads are NOT encrypted because xlsx-populate doesn't work in browsers.
 */

import { saveAs } from 'file-saver';
import { DailyRecord } from '../../types';
import { MONTH_NAMES } from '../../constants';
import { getMonthRecordsFromFirestore } from '../storage/firestoreService';
import { getStoredRecords } from '../storage/localStorageService';
import { isFirestoreEnabled } from '../repositories/DailyRecordRepository';
import { buildCensusMasterWorkbook, getCensusMasterFilename } from './censusMasterWorkbook';
import { validateExcelExport, XLSX_MIME_TYPE } from './excelValidation';

/**
 * Generate and download the Census Master Excel file for a given month.
 * Fetches data from Firestore if available, otherwise falls back to localStorage.
 * Creates one worksheet per day that has data, from the first day up to the selected day.
 * 
 * NOTE: This download is NOT password-protected. Only email attachments are encrypted.
 * 
 * @param year - Year (e.g., 2025)
 * @param month - Month (0-indexed, e.g., 11 for December)
 * @param selectedDay - Day of the month to use as the limit (e.g., 10 means include days 1-10)
 * @throws Error if the generated Excel file is invalid
 */
export const generateCensusMasterExcel = async (year: number, month: number, selectedDay: number): Promise<void> => {
    const limitDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(selectedDay).padStart(2, '0')}`;
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

    let allMonthRecords: DailyRecord[] = [];

    try {
        if (isFirestoreEnabled()) {
            console.info(`📊 Cargando datos del mes ${MONTH_NAMES[month]} ${year} desde Firestore...`);
            allMonthRecords = await getMonthRecordsFromFirestore(year, month);
        } else {
            console.info(`📊 Cargando datos del mes ${MONTH_NAMES[month]} ${year} desde almacenamiento local...`);
            const localRecords = getStoredRecords();
            allMonthRecords = Object.values(localRecords).filter(r => r.date.startsWith(monthPrefix));
        }

        const monthRecords = allMonthRecords
            .filter(record => record.date <= limitDateStr)
            .sort((a, b) => a.date.localeCompare(b.date));

        if (monthRecords.length === 0) {
            console.warn(`No hay datos para ${MONTH_NAMES[month]} ${year}`);
            alert(`No hay datos registrados para las fechas seleccionadas en ${MONTH_NAMES[month]} ${year}`);
            return;
        }

        console.info(`✅ Se encontraron ${monthRecords.length} días con datos`);

        // Generate the workbook (without encryption - xlsx-populate doesn't work in browsers)
        const workbook = await buildCensusMasterWorkbook(monthRecords);
        const buffer = await workbook.xlsx.writeBuffer();
        const filename = getCensusMasterFilename(limitDateStr);

        // Validate before creating blob and downloading
        const validation = validateExcelExport(buffer, filename);
        if (!validation.valid) {
            console.error(`❌ Validación de Excel fallida: ${validation.error}`);
            alert(`Error al generar el archivo Excel:\n${validation.error}\n\nPor favor, recarga la página e intenta de nuevo.`);
            return;
        }

        const blob = new Blob([buffer], { type: XLSX_MIME_TYPE });
        saveAs(blob, filename);

        console.info(`📥 Archivo descargado: ${filename} (${buffer.byteLength} bytes)`);
    } catch (error) {
        console.error('❌ Error generando Excel:', error);
        const message = error instanceof Error ? error.message : 'Error desconocido';
        alert(`Error al generar el archivo Excel:\n${message}\n\nPor favor, recarga la página e intenta de nuevo.`);
        throw error;
    }
};
