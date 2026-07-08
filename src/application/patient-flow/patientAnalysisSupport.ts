import type { DailyRecordPatch } from '@/application/shared/dailyRecordCoreContracts';
import type {
  DailyRecordReadPort,
  DailyRecordWritePort,
} from '@/application/ports/dailyRecordPort';
import type { AuditPort } from '@/application/ports/auditPort';
import type { PatientAnalysisRecordContract } from '@/application/patient-flow/patientAnalysisContracts';
import type { MasterPatient } from '@/types/domain/patientMaster';
import {
  type Conflict,
  isPatientAnalysisOccupiedBedEntry,
  createAnalysisAccumulator,
  registerAdmissionPresence,
  registerDischargeEvent,
  registerTransferEvent,
  closePatientsMissingFromCensus,
} from './patientAnalysisEngine';
import {
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';

export interface AnalysisResult {
  totalRecords: number;
  uniquePatients: number;
  validPatients: MasterPatient[];
  conflicts: Conflict[];
}

export type PatientAnalysisDailyRecordRepository = Pick<DailyRecordReadPort, 'getAvailableDates'> &
  Pick<DailyRecordWritePort, 'updatePartial'> & {
    getForDate: (date: string) => Promise<PatientAnalysisRecordContract | null>;
  };

interface HarmonizeConflictHistoryInput {
  conflict: Conflict;
  dailyRecordRepository: PatientAnalysisDailyRecordRepository;
  auditPort: Pick<AuditPort, 'writeEvent'>;
  currentUserEmail: string;
  rut: string;
  correctName: string;
}

// Internal types re-exported from engine for backward compatibility
export type {
  ActivePatientEvent,
  AnalysisAccumulator,
  Conflict,
  PatientAnalysisOccupiedBedEntry,
} from './patientAnalysisEngine';

export const buildPatientAnalysis = async (
  dailyRecordRepository: Pick<
    PatientAnalysisDailyRecordRepository,
    'getAvailableDates' | 'getForDate'
  >,
  now: () => number = Date.now
): Promise<AnalysisResult> => {
  const dates = await dailyRecordRepository.getAvailableDates();
  const sortedDates = [...dates].sort();
  const accumulator = createAnalysisAccumulator();

  for (const date of sortedDates) {
    const record = await dailyRecordRepository.getForDate(date);
    if (!record) {
      continue;
    }

    const bedsWithPatients = Object.entries(record.beds || {}).filter(
      isPatientAnalysisOccupiedBedEntry
    );
    const rutsInCensusToday = new Set<string>();

    for (const [bedId, patient] of bedsWithPatients) {
      const normalizedRut = registerAdmissionPresence({
        accumulator,
        date,
        bedId,
        patient,
        now: now(),
      });
      rutsInCensusToday.add(normalizedRut);
    }

    const currentNow = now();
    for (const discharge of getActiveDischarges(record.discharges)) {
      registerDischargeEvent(accumulator, date, discharge, currentNow);
    }

    for (const transfer of getActiveTransfers(record.transfers)) {
      registerTransferEvent(accumulator, date, transfer, currentNow);
    }

    closePatientsMissingFromCensus(accumulator, rutsInCensusToday);
  }

  return {
    totalRecords: dates.length,
    uniquePatients: accumulator.patientsMap.size,
    validPatients: Array.from(accumulator.patientsMap.values()),
    conflicts: accumulator.conflicts,
  };
};

export const harmonizePatientConflictHistory = async ({
  conflict,
  dailyRecordRepository,
  auditPort,
  currentUserEmail,
  rut,
  correctName,
}: HarmonizeConflictHistoryInput): Promise<void> => {
  for (const date of conflict.records) {
    const bedId = conflict.bedMap[date];
    if (!bedId) {
      continue;
    }

    // Audit BEFORE mutating patient identity so the trail precedes the change. This audit path is
    // local-first (recorded locally; remote sync is best-effort and self-observed in auditCore), so
    // PATIENT_HARMONIZED is declared best-effort-observable in
    // scripts/clinical-mutation-audit-policy.json — true fail-closed would require routing this
    // batch through executeWriteAuditEvent (tracked as a follow-up, see the policy justification).
    await auditPort.writeEvent(
      currentUserEmail,
      'PATIENT_HARMONIZED',
      'dailyRecord',
      date,
      {
        rut,
        correctName,
        previousName: conflict.options.filter(option => option !== correctName).join(', '),
        bedId,
        automated: true,
      },
      rut,
      date
    );

    await dailyRecordRepository.updatePartial(date, {
      [`beds.${bedId}.patientName`]: correctName,
    } as DailyRecordPatch);
  }
};

export const resolveUpdatedAnalysisAfterConflict = ({
  analysis,
  rut,
  correctName,
  now = Date.now,
}: {
  analysis: AnalysisResult;
  rut: string;
  correctName: string;
  now?: () => number;
}): AnalysisResult => ({
  ...analysis,
  validPatients: analysis.validPatients.map(patient =>
    patient.rut === rut ? { ...patient, fullName: correctName, updatedAt: now() } : patient
  ),
  conflicts: analysis.conflicts.filter(conflict => conflict.rut !== rut),
});
