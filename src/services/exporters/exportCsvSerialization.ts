import type { PatientData } from '@/types/domain/patient';

import { DischargeData, TransferData } from '@/types/domain/movements';

import type { DailyRecordCsvExportState } from '@/types/domain/dailyRecordSlices';
import { BEDS } from '@/constants/beds';
import { CSV_HEADERS } from '@/constants/export';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { resolveExportableNursesText } from '@/services/staff/dailyRecordStaffingPresentation';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';
import {
  getActiveDischarges,
  getActiveTransfers,
} from '@/domain/movements/movementTombstonePolicy';

const escapeCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (
    stringValue.includes(',') ||
    stringValue.includes('"') ||
    stringValue.includes('\n') ||
    stringValue.includes('\r')
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const resolveNurseField = (record: DailyRecordCsvExportState): string =>
  resolveExportableNursesText(record);

const generatePatientRow = (
  nurseField: string,
  bedId: string,
  bedName: string,
  bedType: string,
  patient: PatientData,
  locationOverride?: string
): string => {
  return [
    escapeCsvValue(bedId),
    escapeCsvValue(bedName),
    escapeCsvValue(locationOverride || patient.location || ''),
    escapeCsvValue(bedType),
    escapeCsvValue(patient.bedMode || 'Cama'),
    escapeCsvValue(patient.hasCompanionCrib ? 'SI' : 'NO'),
    escapeCsvValue(patient.isBlocked ? 'SI' : 'NO'),
    escapeCsvValue(patient.blockedReason || ''),
    escapeCsvValue(patient.patientName),
    escapeCsvValue(patient.documentType || 'RUT'),
    escapeCsvValue(patient.rut),
    escapeCsvValue(formatDateDDMMYYYY(patient.birthDate)),
    escapeCsvValue(patient.age),
    escapeCsvValue(patient.biologicalSex || ''),
    escapeCsvValue(patient.insurance || ''),
    escapeCsvValue(patient.admissionOrigin || ''),
    escapeCsvValue(patient.admissionOriginDetails || ''),
    escapeCsvValue(patient.origin || ''),
    escapeCsvValue(patient.isRapanui ? 'SI' : 'NO'),
    escapeCsvValue(patient.pathology),
    escapeCsvValue(patient.diagnosisComments || ''),
    escapeCsvValue(patient.specialty),
    escapeCsvValue(patient.status),
    escapeCsvValue(formatDateDDMMYYYY(patient.admissionDate)),
    escapeCsvValue(patient.hasWristband ? 'SI' : 'NO'),
    escapeCsvValue(patient.devices.join('|')),
    escapeCsvValue(formatDateDDMMYYYY(patient.deviceDetails?.CUP?.installationDate)),
    escapeCsvValue(formatDateDDMMYYYY(patient.deviceDetails?.CUP?.removalDate)),
    escapeCsvValue(formatDateDDMMYYYY(patient.deviceDetails?.CVC?.installationDate)),
    escapeCsvValue(formatDateDDMMYYYY(patient.deviceDetails?.CVC?.removalDate)),
    escapeCsvValue(formatDateDDMMYYYY(patient.deviceDetails?.VMI?.installationDate)),
    escapeCsvValue(formatDateDDMMYYYY(patient.deviceDetails?.VMI?.removalDate)),
    escapeCsvValue(patient.surgicalComplication ? 'SI' : 'NO'),
    escapeCsvValue(
      resolveEffectiveUpcState({
        bedId,
        isUPC: patient.isUPC,
        checklist: patient.upcChecklist,
      }).isUpc
        ? 'SI'
        : 'NO'
    ),
    escapeCsvValue(patient.handoffNote || ''),
    escapeCsvValue(nurseField),
  ].join(',');
};

const generateDischargeRows = (discharges: DischargeData[]): string[] => {
  if (!discharges?.length) return [];

  return [
    '',
    '--- ALTAS ---',
    'Cama,Tipo,Paciente,RUT,Diagnóstico,Estado,Edad,Previsión',
    ...discharges.map(discharge =>
      [
        escapeCsvValue(discharge.bedName),
        escapeCsvValue(discharge.bedType),
        escapeCsvValue(discharge.patientName),
        escapeCsvValue(discharge.rut),
        escapeCsvValue(discharge.diagnosis),
        escapeCsvValue(discharge.status),
        escapeCsvValue(discharge.age || ''),
        escapeCsvValue(discharge.insurance || ''),
      ].join(',')
    ),
  ];
};

const generateTransferRows = (transfers: TransferData[]): string[] => {
  if (!transfers?.length) return [];

  return [
    '',
    '--- TRASLADOS ---',
    'Cama,Tipo,Paciente,RUT,Diagnóstico,Medio,Centro,Acompañante,Edad,Previsión',
    ...transfers.map(transfer => {
      const center =
        transfer.receivingCenter === 'Otro'
          ? transfer.receivingCenterOther
          : transfer.receivingCenter;
      const escort =
        transfer.evacuationMethod === 'Aerocardal' ? '' : transfer.transferEscort || '';

      return [
        escapeCsvValue(transfer.bedName),
        escapeCsvValue(transfer.bedType),
        escapeCsvValue(transfer.patientName),
        escapeCsvValue(transfer.rut),
        escapeCsvValue(transfer.diagnosis),
        escapeCsvValue(transfer.evacuationMethod),
        escapeCsvValue(center),
        escapeCsvValue(escort),
        escapeCsvValue(transfer.age || ''),
        escapeCsvValue(transfer.insurance || ''),
      ].join(',');
    }),
  ];
};

export const buildDailyRecordCsv = (record: DailyRecordCsvExportState): string => {
  const rows = [CSV_HEADERS.join(',')];
  const nurseField = resolveNurseField(record);

  BEDS.forEach(bed => {
    const patient = record.beds[bed.id];
    if (!patient) {
      return;
    }
    const isMainOccupied = patient.patientName && patient.patientName.trim() !== '';
    const isClinicalCribOccupied = patient.clinicalCrib?.patientName;

    if (!patient.isBlocked && !isMainOccupied && !isClinicalCribOccupied) {
      return;
    }

    if (patient.isBlocked || isMainOccupied) {
      rows.push(generatePatientRow(nurseField, bed.id, bed.name, bed.type, patient));
    }

    if (patient.clinicalCrib?.patientName) {
      rows.push(
        generatePatientRow(
          nurseField,
          `${bed.id}-C`,
          `${bed.name} (Cuna RN)`,
          'Cuna',
          patient.clinicalCrib,
          patient.location
        )
      );
    }
  });

  rows.push(...generateDischargeRows(getActiveDischarges(record.discharges)));
  rows.push(...generateTransferRows(getActiveTransfers(record.transfers)));

  return rows.join('\n');
};
