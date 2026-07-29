import { DischargeData, TransferData } from '@/types/domain/movements';
import { PatientData } from '@/services/contracts/patientServiceContracts';
import type { DailyRecordCsvExportState } from '@/services/contracts/dailyRecordServiceContracts';
import { BEDS } from '@/constants/beds';
import { CSV_HEADERS } from '@/constants/export';
import { formatDateDDMMYYYY } from '@/utils/dateDisplayUtils';
import { resolveExportableNursesText } from '@/services/staff/dailyRecordStaffing';
import { resolveEffectiveUpcState } from '@/shared/census/upcBedPolicy';
import {
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

const escapeCsvValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
};

const resolveNurseField = (record: DailyRecordCsvExportState): string =>
  resolveExportableNursesText(record);

const generatePatientRow = (
  record: DailyRecordCsvExportState,
  bedId: string,
  bedName: string,
  bedType: string,
  patient: PatientData,
  locationOverride?: string
): string => {
  const nurseField = resolveNurseField(record);

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
        discharge.bedName,
        discharge.bedType,
        escapeCsvValue(discharge.patientName),
        discharge.rut,
        escapeCsvValue(discharge.diagnosis),
        discharge.status,
        discharge.age || '',
        discharge.insurance || '',
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
        transfer.bedName,
        transfer.bedType,
        escapeCsvValue(transfer.patientName),
        transfer.rut,
        escapeCsvValue(transfer.diagnosis),
        transfer.evacuationMethod,
        escapeCsvValue(center),
        escapeCsvValue(escort),
        transfer.age || '',
        transfer.insurance || '',
      ].join(',');
    }),
  ];
};

export const buildDailyRecordCsv = (record: DailyRecordCsvExportState): string => {
  const rows = [CSV_HEADERS.join(',')];

  BEDS.forEach(bed => {
    const patient = record.beds[bed.id];
    const isMainOccupied = patient.patientName && patient.patientName.trim() !== '';
    const isClinicalCribOccupied = patient.clinicalCrib?.patientName;

    if (!patient.isBlocked && !isMainOccupied && !isClinicalCribOccupied) {
      return;
    }

    if (patient.isBlocked || isMainOccupied) {
      rows.push(generatePatientRow(record, bed.id, bed.name, bed.type, patient));
    }

    if (patient.clinicalCrib?.patientName) {
      rows.push(
        generatePatientRow(
          record,
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
