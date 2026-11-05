import type { CensusExportRecord } from '@/services/contracts/censusExportServiceContracts';
import type { PatientData } from '@/types/domain/patient';

export const RESERVED_DIAGNOSIS = '[Diagnostico reservado]';

const isPsychiatry = (value?: string): boolean =>
  Boolean(
    value
      ?.normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .includes('psiquiatr')
  );

const hasPsychiatry = (patient?: Pick<PatientData, 'specialty' | 'secondarySpecialty'>): boolean =>
  isPsychiatry(patient?.specialty) || isPsychiatry(patient?.secondarySpecialty);

const reservePatient = (patient: PatientData): PatientData => ({
  ...patient,
  ...(hasPsychiatry(patient)
    ? { pathology: RESERVED_DIAGNOSIS, cie10Code: '', cie10Description: '', diagnosisComments: '' }
    : {}),
  ...(patient.clinicalCrib ? { clinicalCrib: reservePatient(patient.clinicalCrib) } : {}),
});

const reserveMovement = <
  T extends {
    diagnosis: string;
    specialty?: string;
    originalData?: PatientData;
  },
>(
  movement: T
): T => ({
  ...movement,
  ...(isPsychiatry(movement.specialty) || hasPsychiatry(movement.originalData)
    ? { diagnosis: RESERVED_DIAGNOSIS, cie10Code: '', cie10Description: '' }
    : {}),
  ...(movement.originalData ? { originalData: reservePatient(movement.originalData) } : {}),
});

/** Copy only for the email attachment, before rendering visible and hidden workbook sheets. */
export const reserveCensusEmailDiagnoses = (record: CensusExportRecord): CensusExportRecord => ({
  ...record,
  beds: Object.fromEntries(
    Object.entries(record.beds).map(([id, patient]) => [id, reservePatient(patient)])
  ),
  discharges: record.discharges?.map(reserveMovement) ?? [],
  transfers: record.transfers?.map(reserveMovement) ?? [],
  cma: record.cma?.map(reserveMovement) ?? [],
});
