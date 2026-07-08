import type { Workbook } from 'exceljs';

import { getForDate as getRecordForDate } from '@/services/repositories/dailyRecordRepositoryReadService';
import { getAllRecords } from '@/services/storage/indexeddb/indexedDbRecordService';
import {
  applyCensusRawFormatting,
  buildCensusDailyRawWorkbook,
  extractRowsFromRecord,
  getCensusRawHeader,
} from './censusRawWorkbook';
import { BEDS } from '@/constants/beds';
import { createWorkbook } from './excelUtils';
import { getCategorization } from '@/services/cudyr/CudyrScoreUtils';
import { isCudyrPatientEligible } from '@/domain/cudyr/cudyrEligibility';
import type { PatientData } from '@/types/domain/patient';

const createRecordRangeSheet = async (
  sheetName: string,
  dates: string[],
  allRecords: Awaited<ReturnType<typeof getAllRecords>>
): Promise<Workbook> => {
  const workbook = await createWorkbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(getCensusRawHeader());

  dates.forEach(date => {
    const rows = extractRowsFromRecord(allRecords[date]);
    rows.forEach(row => sheet.addRow(row));
  });

  return workbook;
};

export const getRecordOrAlert = async (
  date: string,
  message = 'No hay datos para la fecha seleccionada.'
) => {
  const record = await getRecordForDate(date);
  if (!record) {
    alert(message);
    return null;
  }
  return record;
};

export const getRangeDatesOrAlert = async (
  startDate: string,
  endDate: string,
  message = 'No hay registros en el rango de fechas seleccionado.'
) => {
  const allRecords = await getAllRecords();
  const dates = Object.keys(allRecords)
    .filter(date => date >= startDate && date <= endDate)
    .sort();

  if (dates.length === 0) {
    alert(message);
    return null;
  }

  return { allRecords, dates };
};

export const buildDailyRawWorkbookOrNull = async (date: string) => {
  const record = await getRecordOrAlert(date);
  if (!record) return null;
  return buildCensusDailyRawWorkbook(record);
};

export const buildRangeRawWorkbookOrNull = async (startDate: string, endDate: string) => {
  const rangeData = await getRangeDatesOrAlert(startDate, endDate);
  if (!rangeData) return null;
  return createRecordRangeSheet('Censo Bruto del Rango', rangeData.dates, rangeData.allRecords);
};

export const buildDailyFormattedWorkbookOrNull = async (date: string) => {
  const record = await getRecordOrAlert(date);
  if (!record) return null;

  const workbook = await createWorkbook();
  const sheet = workbook.addWorksheet('Censo Formateado');
  sheet.addRow(getCensusRawHeader());
  extractRowsFromRecord(record).forEach(row => sheet.addRow(row));
  applyCensusRawFormatting(sheet);
  return workbook;
};

export const buildRangeFormattedWorkbookOrNull = async (startDate: string, endDate: string) => {
  const rangeData = await getRangeDatesOrAlert(startDate, endDate);
  if (!rangeData) return null;

  const workbook = await createRecordRangeSheet(
    'Censo Formateado del Rango',
    rangeData.dates,
    rangeData.allRecords
  );
  const worksheet = workbook.getWorksheet('Censo Formateado del Rango');
  if (worksheet) {
    applyCensusRawFormatting(worksheet);
  }
  return workbook;
};

export const buildCudyrDailyWorkbookOrNull = async (date: string) => {
  const record = await getRecordOrAlert(date, 'Sin datos');
  if (!record) return null;

  const workbook = await createWorkbook();
  const sheet = workbook.addWorksheet('CUDYR Diario del Registro');

  const appendCudyrDailyRow = (bedName: string, patient?: PatientData) => {
    if (!patient || !isCudyrPatientEligible(record.date, patient)) {
      return;
    }

    const { depScore, riskScore, finalCat, isCategorized } = getCategorization(patient.cudyr);
    if (!isCategorized) {
      return;
    }

    const total = depScore + riskScore;
    sheet.addRow([
      date,
      bedName,
      patient.patientName,
      patient.rut,
      total,
      finalCat,
      depScore,
      riskScore,
    ]);
  };

  sheet.addRow([
    'FECHA',
    'CAMA',
    'PACIENTE',
    'RUT',
    'PUNTAJE_TOTAL',
    'CATEGORIA',
    'DEPENDENCIA',
    'RIESGO',
  ]);

  BEDS.forEach(bed => {
    const patient = record.beds[bed.id];
    appendCudyrDailyRow(bed.name, patient);
    appendCudyrDailyRow(`${bed.name} (CC)`, patient?.clinicalCrib);
  });

  return workbook;
};
