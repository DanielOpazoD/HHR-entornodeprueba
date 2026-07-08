import { BEDS } from '@/constants/beds';
import { EVACUATION_METHOD_AEROCARDAL } from '@/constants/clinicalMovementConstants';
import { PatientTraceability, SpecialtyTraceabilityType } from '@/types/minsalTypes';
import { normalizeSpecialty, isFachEvacuationMethod } from './normalization';
import { createEpisodeAdmissionTracker } from './episodeTracker';
import type { MinsalDailyRecord } from './minsalRecordContracts';
import { normalizeMovementReportingSnapshot } from './movementCompatibility';
import {
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

const resolveTraceabilityDiagnosis = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const diagnosis = value.trim();
  return diagnosis || undefined;
};

const resolveMovementSpecialty = (movement: { specialty?: string }): string =>
  normalizeSpecialty(movement.specialty);

const resolveMovementAdmissionDate = (
  movement: {
    clinicalEpisodeId?: string;
    rut?: string;
    admissionDate?: string;
  },
  episodeTracker: ReturnType<typeof createEpisodeAdmissionTracker>
): string | undefined => episodeTracker.resolveAdmissionDate(movement, movement.admissionDate);

const resolveMovementDiagnosis = (movement: { diagnosis?: string }): string | undefined =>
  resolveTraceabilityDiagnosis(movement.diagnosis);

/**
 * Build traceability list lazily for a specialty + indicator type.
 */
export function buildSpecialtyTraceability(
  records: MinsalDailyRecord[],
  specialty: string,
  type: SpecialtyTraceabilityType
): PatientTraceability[] {
  if (records.length === 0) return [];

  const normalizedSpecialty = normalizeSpecialty(specialty);
  const orderedRecords = records.slice().sort((a, b) => a.date.localeCompare(b.date));
  const episodeTracker = createEpisodeAdmissionTracker();

  orderedRecords.forEach(record => {
    Object.values(record.beds || {}).forEach(bed => {
      episodeTracker.observeBed(bed, record.date);
    });
  });

  const traceability: PatientTraceability[] = [];

  orderedRecords.forEach(record => {
    const closedEpisodes: Array<{
      clinicalEpisodeId?: string;
      rut?: string;
      admissionDate?: string;
    }> = [];

    if (type === 'dias-cama') {
      BEDS.forEach(bed => {
        const patient = record.beds[bed.id];
        if (!patient || patient.isBlocked) return;

        if (
          patient.patientName?.trim() &&
          normalizeSpecialty(patient.specialty) === normalizedSpecialty
        ) {
          traceability.push({
            name: patient.patientName,
            rut: patient.rut,
            diagnosis: resolveTraceabilityDiagnosis(patient.pathology),
            date: record.date,
            bedName: patient.bedName,
            admissionDate: episodeTracker.resolveAdmissionDate(patient, patient.admissionDate),
          });
        }
      });
    }

    if (type === 'egresos' || type === 'fallecidos') {
      getActiveDischarges(record.discharges).forEach(discharge => {
        const normalizedDischarge = normalizeMovementReportingSnapshot(discharge);
        if (resolveMovementSpecialty(normalizedDischarge) !== normalizedSpecialty) return;
        if (type === 'fallecidos' && discharge.status !== 'Fallecido') return;

        const admissionDate = resolveMovementAdmissionDate(normalizedDischarge, episodeTracker);

        traceability.push({
          name: discharge.patientName,
          rut: discharge.rut,
          diagnosis: resolveMovementDiagnosis(normalizedDischarge),
          date: record.date,
          bedName: discharge.bedName,
          admissionDate,
          dischargeDate: record.date,
        });
        if (discharge.rut) {
          closedEpisodes.push(discharge);
        }
      });
    }

    getActiveTransfers(record.transfers).forEach(transfer => {
      const normalizedTransfer = normalizeMovementReportingSnapshot(transfer);
      if (resolveMovementSpecialty(normalizedTransfer) !== normalizedSpecialty) return;
      if (type === 'aerocardal' && transfer.evacuationMethod !== EVACUATION_METHOD_AEROCARDAL)
        return;
      if (type === 'fach' && !isFachEvacuationMethod(transfer.evacuationMethod)) return;

      const admissionDate = resolveMovementAdmissionDate(normalizedTransfer, episodeTracker);

      traceability.push({
        name: transfer.patientName,
        rut: transfer.rut,
        diagnosis: resolveMovementDiagnosis(normalizedTransfer),
        date: record.date,
        bedName: transfer.bedName,
        admissionDate,
        dischargeDate: record.date,
      });
      if (transfer.rut) {
        closedEpisodes.push(transfer);
      }
    });

    closedEpisodes.forEach(episode => episodeTracker.closeEpisode(episode));
  });

  return traceability;
}
