import type { PatientData } from '@/types/domain/patient';

import type { Worksheet } from 'exceljs';
import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';

import { BEDS } from '@/constants/beds';
import { getBedTypeForRecord } from '@/utils/bedTypeUtils';
import { TITLE_STYLE, HEADER_FILL, BORDER_THIN, FREE_FILL, BLOCKED_FILL } from '../styles';
import { mapBedType, formatAge, formatDateDDMMYYYY } from '../formatters';
import { resolveUpcExportLabel } from '@/shared/census/upcBedPolicy';

export function addCensusTable(
  sheet: Worksheet,
  record: CensusExportRecord,
  startRow: number
): number {
  const titleRow = sheet.getRow(startRow);
  titleRow.getCell(1).value = 'TABLA DE PACIENTES HOSPITALIZADOS';
  titleRow.getCell(1).font = TITLE_STYLE;
  startRow += 1;

  const headers = [
    '#',
    'Cama',
    'Tipo',
    'Paciente',
    'RUT',
    'Edad',
    'Diagnóstico',
    'Especialidad',
    'F. Ingreso',
    'Estado',
    'Braz',
    'C.QX',
    'UPC',
    'Disp.',
  ];
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
    const shouldRenderExtra = !bed.isExtra || Boolean(patient?.patientName?.trim());
    if (!shouldRenderExtra) return;

    const hasClinicalCrib = Boolean(patient?.clinicalCrib?.patientName?.trim());
    const realBedType = getBedTypeForRecord(bed, record);

    currentRow = addCensusRow(sheet, currentRow, index++, bed.id, realBedType, patient);

    if (hasClinicalCrib && patient?.clinicalCrib) {
      currentRow = addCensusRow(
        sheet,
        currentRow,
        index++,
        `${bed.id}-C`,
        'Cuna',
        patient.clinicalCrib,
        patient.location
      );
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
    patient?.secondarySpecialty
      ? `${patient.specialty} / ${patient.secondarySpecialty}`
      : patient?.specialty || '',
    formatDateDDMMYYYY(patient?.admissionDate),
    isBlocked ? 'Bloqueada' : patient?.status || (isFree ? 'Libre' : ''),
    patient ? (patient.hasWristband ? 'Sí' : 'No') : 'No',
    patient ? (patient.surgicalComplication ? 'Sí' : 'No') : 'No',
    patient
      ? resolveUpcExportLabel({
          bedId,
          isUPC: patient.isUPC,
          checklist: patient.upcChecklist,
        })
      : 'No UPC',
    patient?.devices?.join(', ') || '',
  ];

  values.forEach((value, idx) => {
    const cell = row.getCell(idx + 1);
    cell.value = value;
    const alignCenter = idx <= 2 || (idx >= 10 && idx <= 12);
    cell.alignment = {
      vertical: 'middle',
      wrapText: true,
      horizontal: alignCenter ? 'center' : 'left',
    };
    cell.border = BORDER_THIN;
    if (isBlocked) cell.fill = BLOCKED_FILL;
  });

  if (isFree || isBlocked) {
    const label = isBlocked ? `Bloqueada${blockedDetail ? ` - ${blockedDetail}` : ''}` : 'Libre';
    row.getCell(4).value = label;
    row.getCell(4).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    row.getCell(4).font = { bold: true };
    row.getCell(4).border = BORDER_THIN;
    row.getCell(4).fill = isBlocked ? BLOCKED_FILL : FREE_FILL;
    sheet.mergeCells(rowNumber, 4, rowNumber, 14);
  }

  return rowNumber + 1;
}
