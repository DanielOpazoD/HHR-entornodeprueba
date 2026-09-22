import { BEDS } from '@/constants/beds';
import type { HistoricalRecoveryDay } from '../contracts/censusImportDiff';
import type { DailyRecord } from '../contracts/rayenDomainContracts';
import { applyCrossDayDiff } from './applyCrossDayDiff';
import { reportEgresoEntry, reportEgresoPatient } from './applyCensusImportDiff';
import {
  applyHistoricalAdmissions,
  type HistoricalAdmissionSubject,
} from './previousDayAdmissionCorrections';

const movementKinds = ['discharges', 'transfers', 'cma'] as const;

const recoveryEntries = (plan: HistoricalRecoveryDay) =>
  plan.reportEgresos.map(row => ({
    entry: reportEgresoEntry(row),
    patient: reportEgresoPatient(row),
    isNested: row.fromClinicalCrib === true,
  }));

export const historicalRecoveryAdmissionSubjects = (
  plan: HistoricalRecoveryDay
): HistoricalAdmissionSubject[] =>
  plan.admissions.flatMap(({ bedId, patient }) => {
    const subjects: HistoricalAdmissionSubject[] = [
      { day: plan.day, kind: 'principal', bedId, patient, principal: patient },
    ];
    if (patient.clinicalCrib) {
      subjects.push({
        day: plan.day,
        kind: 'clinical-crib',
        bedId,
        patient: patient.clinicalCrib,
        principal: patient,
      });
    }
    return subjects;
  });

const hasClosedRecoveryDay = (record: DailyRecord): boolean =>
  Boolean(
    record.medicalSignature ||
    record.rayenSync ||
    record.rayenSyncHistory?.length ||
    Object.values(record.medicalSignatureByScope ?? {}).some(Boolean)
  );

const hasEmptyRecoveryBeds = (record: DailyRecord): boolean =>
  Object.values(record.beds).every(
    bed =>
      !bed.patientName?.trim() &&
      !bed.clinicalCrib?.patientName?.trim() &&
      !bed.isBlocked &&
      !bed.clinicalCrib?.isBlocked
  );

const allMovements = (record: DailyRecord) => [
  ...record.discharges,
  ...record.transfers,
  ...record.cma,
];

const hasRecoveryMovementIdentity = (
  movement: ReturnType<typeof allMovements>[number],
  day: string
): boolean => {
  const provenance = movement.movementProvenance;
  const movementDay = 'movementDate' in movement ? movement.movementDate : undefined;
  return Boolean(
    movement.id.startsWith('rayen-egreso:') &&
    movement.id.endsWith(`:${day}`) &&
    !movement.deletedAt &&
    (!movementDay || movementDay === day) &&
    provenance?.source === 'gestion_camas' &&
    provenance.lineageId === movement.id &&
    provenance.syncRunId?.trim() &&
    provenance.classifiedAt?.trim()
  );
};

/** Durable state left only when movements won their CAS and the structural CAS did not. */
export const isHistoricalRecoveryPartialCandidate = (record: DailyRecord | null): boolean => {
  if (!record || hasClosedRecoveryDay(record) || !hasEmptyRecoveryBeds(record)) {
    return false;
  }
  const movements = allMovements(record);
  return (
    movements.length > 0 &&
    movements.every(movement => hasRecoveryMovementIdentity(movement, record.date))
  );
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  );
};

const comparableMovement = (movement: ReturnType<typeof allMovements>[number]): unknown => {
  const {
    movementProvenance: _provenance,
    timestamp: _timestamp,
    ...stable
  } = movement as ReturnType<typeof allMovements>[number] & { timestamp?: string };
  return stableValue(stable);
};

const expectedMovementRecord = (record: DailyRecord, plan: HistoricalRecoveryDay): DailyRecord =>
  applyCrossDayDiff({ ...record, discharges: [], transfers: [], cma: [] }, recoveryEntries(plan), {
    syncRunId: 'historical-recovery-comparison',
    idFactory: () => 'unused',
  }).record;

/** Accepts authentic output from an earlier run, while rejecting manual or modified census data. */
export const assertHistoricalRecoveryCompatible = (
  record: DailyRecord,
  plan: HistoricalRecoveryDay
): void => {
  if (record.date !== plan.day || hasClosedRecoveryDay(record)) {
    throw new Error(
      `El censo del ${plan.day} cambió o fue firmado. Vuelve a revisar la recuperación.`
    );
  }
  const expected = expectedMovementRecord(record, plan);
  for (const kind of movementKinds) {
    for (const movement of record[kind]) {
      const planned = expected[kind].find(item => item.id === movement.id);
      if (
        !planned ||
        !hasRecoveryMovementIdentity(movement, plan.day) ||
        JSON.stringify(comparableMovement(movement)) !== JSON.stringify(comparableMovement(planned))
      ) {
        throw new Error(`El historial del ${plan.day} cambió. Vuelve a revisar la recuperación.`);
      }
    }
  }
  for (const [bedId, patient] of Object.entries(record.beds)) {
    const planned = plan.admissions.find(item => item.bedId === bedId)?.patient;
    if (
      patient.isBlocked ||
      patient.clinicalCrib?.isBlocked ||
      (patient.patientName?.trim() &&
        (!planned?.clinicalEpisodeId || patient.clinicalEpisodeId !== planned.clinicalEpisodeId)) ||
      (patient.clinicalCrib?.patientName?.trim() &&
        (!planned?.clinicalCrib?.clinicalEpisodeId ||
          patient.clinicalCrib.clinicalEpisodeId !== planned.clinicalCrib.clinicalEpisodeId))
    ) {
      throw new Error(`La ocupación del ${plan.day} cambió. Vuelve a revisar la recuperación.`);
    }
  }
};

export const historicalRecoveryActiveExtraBeds = (record: DailyRecord): string[] => {
  const occupiedExtras = BEDS.filter(
    bed => bed.isExtra && record.beds[bed.id]?.patientName?.trim()
  ).map(bed => bed.id);
  return [...new Set([...(record.activeExtraBeds ?? []), ...occupiedExtras])];
};

/** Suppresses a fully completed movement-only day while retaining true resumable partials. */
export const hasMissingHistoricalRecoveryWork = (
  record: DailyRecord,
  plan: HistoricalRecoveryDay
): boolean => {
  assertHistoricalRecoveryCompatible(record, plan);
  const movements = applyCrossDayDiff(record, recoveryEntries(plan), {
    syncRunId: 'historical-recovery-comparison',
    idFactory: () => 'unused',
  });
  const admissions = applyHistoricalAdmissions(record, historicalRecoveryAdmissionSubjects(plan));
  const extras = historicalRecoveryActiveExtraBeds(admissions.record);
  return (
    movements.applied > 0 ||
    admissions.applied > 0 ||
    extras.length !== (record.activeExtraBeds ?? []).length
  );
};
