import type { Workbook } from 'exceljs';
import { PatientData } from '@/services/contracts/patientServiceContracts';
import { BEDS } from '@/constants/beds';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { createWorkbook } from './excelUtils';
import { getBedTypeForRecord } from '../../utils/bedTypeUtils';
import { resolvePresentedDayShiftNurses } from '@/services/staff/dailyRecordStaffing';
import { formatCensusDateTime } from '@/shared/census/censusPresentation';
import type { DailyRecordRawExportState } from '@/services/contracts/dailyRecordServiceContracts';
import { resolveUpcExportLabel } from '@/shared/census/upcBedPolicy';

const getRawHeader = () => [
  'FECHA',
  'CAMA',
  'TIPO_CAMA',
  'UBICACION',
  'MODO_CAMA',
  'BLOQUEADA',
  'MOTIVO_BLOQUEO',
  'PACIENTE',
  'RUT',
  'EDAD',
  'SEXO',
  'PREVISION',
  'ORIGEN',
  'ORIGEN_INGRESO',
  'ES_RAPANUI',
  'DIAGNOSTICO',
  'ESPECIALIDAD',
  'ESTADO',
  'FECHA_INGRESO',
  'BRAZALETE',
  'DISPOSITIVOS',
  'COMP_QUIRURGICA',
  'UPC',
  'ENFERMEROS',
  'ULTIMA_ACTUALIZACION',
];

const generateRawRow = (
  date: string,
  bedId: string,
  bedType: string,
  p: PatientData,
  nurses: string[],
  lastUpdated: string,
  locationOverride?: string
) => {
  return [
    date,
    bedId,
    bedType,
    locationOverride || p.location || '',
    p.bedMode || 'Cama',
    p.isBlocked ? 'SI' : 'NO',
    p.blockedReason || '',
    p.patientName || '',
    p.rut || '',
    p.age || '',
    p.biologicalSex || '',
    p.insurance || '',
    p.origin || '',
    p.admissionOrigin || '',
    p.isRapanui ? 'SI' : 'NO',
    p.pathology || '',
    p.specialty || '',
    p.status || '',
    formatDateDDMMYYYY(p.admissionDate),
    p.hasWristband ? 'SI' : 'NO',
    p.devices?.join(', ') || '',
    p.surgicalComplication ? 'SI' : 'NO',
    resolveUpcExportLabel({
      bedId,
      isUPC: p.isUPC,
      checklist: p.upcChecklist,
    }),
    nurses.join(' & '),
    formatCensusDateTime(lastUpdated),
  ];
};

/** Type for a single row of census data */
type CensusRawRow = (string | boolean | number)[];

export const extractRowsFromRecord = (record: DailyRecordRawExportState): CensusRawRow[] => {
  const rows: CensusRawRow[] = [];
  const nurses = resolvePresentedDayShiftNurses(record);
  const date = record.date;
  const activeExtras = record.activeExtraBeds || [];

  BEDS.forEach(bed => {
    if (bed.isExtra && !activeExtras.includes(bed.id)) return;

    const p = record.beds[bed.id];
    if (!p) return;

    const isOccupied = p.patientName && p.patientName.trim() !== '';
    const isBlocked = p.isBlocked;
    const hasClinicalCrib = p.clinicalCrib && p.clinicalCrib.patientName;

    const realBedType = getBedTypeForRecord(bed, record);

    if (isOccupied || isBlocked) {
      rows.push(generateRawRow(date, bed.id, realBedType, p, nurses, record.lastUpdated));
    }

    if (hasClinicalCrib && p.clinicalCrib) {
      rows.push(
        generateRawRow(
          date,
          bed.id + '-C',
          'Cuna',
          p.clinicalCrib,
          nurses,
          record.lastUpdated,
          p.location
        )
      );
    }
  });

  return rows;
};

export const buildCensusDailyRawWorkbook = async (
  record: DailyRecordRawExportState
): Promise<Workbook> => {
  const workbook = await createWorkbook();
  const sheet = workbook.addWorksheet('Censo Diario');

  sheet.addRow(getRawHeader());

  const rows = extractRowsFromRecord(record);
  rows.forEach(r => sheet.addRow(r));

  applyCensusRawFormatting(sheet);

  return workbook;
};

export const applyCensusRawFormatting = (worksheet: ReturnType<Workbook['addWorksheet']>) => {
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF0F4C81' },
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.height = 22;

  worksheet.columns.forEach(column => {
    column.width = 20;
  });
};

export const buildCensusDailyRawBuffer = async (record: DailyRecordRawExportState) => {
  const workbook = await buildCensusDailyRawWorkbook(record);
  return workbook.xlsx.writeBuffer();
};

export const getCensusRawHeader = getRawHeader;
