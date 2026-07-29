import type { DailyRecordIntegrityState } from '@/types/domain/dailyRecordSlices';
import type { PatientData } from '@/types/domain/patient';
import { buildMedicalHandoffSummary } from '@/domain/handoff/specialty';

/**
 * Error thrown when a significant loss of data is detected during a save operation.
 */
export class DataRegressionError extends Error {
  constructor(
    message: string,
    public localDensity: number,
    public remoteDensity: number
  ) {
    super(message);
    this.name = 'DataRegressionError';
  }
}

/**
 * Error thrown when a record in the cloud has a newer schema version than the local app.
 */
export class VersionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VersionMismatchError';
  }
}

const calculatePatientDensity = (patient: PatientData | undefined): number => {
  if (!patient || (!patient.patientName && !patient.isBlocked)) return 0;

  let score = 10;
  if (patient.diagnosisComments) score += 2;
  if (patient.handoffNote) score += 5;
  if (patient.handoffNoteDayShift) score += 3;
  if (patient.handoffNoteNightShift) score += 3;
  if (patient.cudyr) score += 5;
  if (patient.clinicalCrib?.patientName || patient.clinicalCrib?.isBlocked) score += 10;
  return score;
};

const calculateMovementSnapshotDensity = (
  movements: ReadonlyArray<{ originalData?: PatientData }>
): number =>
  movements.reduce((total, movement) => total + calculatePatientDensity(movement.originalData), 0);

type DensityMovement = {
  id?: string;
  clinicalEpisodeId?: string;
  rut?: string;
  patientName?: string;
  bedId?: string;
  bedName?: string;
  movementDate?: string;
  time?: string;
  dischargeTime?: string;
  timestamp?: string;
  originalData?: PatientData;
};

type VacatedOccupant = {
  key: string;
  bedId: string;
  patient: PatientData;
};

const normalizedIdentityText = (value?: string): string =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();

const samePatientIdentity = (
  left: Pick<PatientData, 'clinicalEpisodeId' | 'rut' | 'patientName'>,
  right: Pick<PatientData, 'clinicalEpisodeId' | 'rut' | 'patientName'>
): boolean => {
  const leftEpisode = String(left.clinicalEpisodeId ?? '').trim();
  const rightEpisode = String(right.clinicalEpisodeId ?? '').trim();
  if (leftEpisode && rightEpisode) return leftEpisode === rightEpisode;
  const leftRut = normalizedIdentityText(left.rut);
  const rightRut = normalizedIdentityText(right.rut);
  if (leftRut && rightRut) return leftRut === rightRut;
  const leftName = normalizedIdentityText(left.patientName);
  const rightName = normalizedIdentityText(right.patientName);
  return Boolean(leftName && rightName && leftName === rightName);
};

const recordOccupants = (record: DailyRecordIntegrityState): VacatedOccupant[] =>
  Object.entries(record.beds || {}).flatMap(([bedId, patient]) => {
    if (!patient || (!patient.patientName && !patient.isBlocked)) return [];
    const occupants: VacatedOccupant[] = [{ key: `${bedId}:primary`, bedId, patient }];
    if (patient.clinicalCrib?.patientName || patient.clinicalCrib?.isBlocked) {
      occupants.push({ key: `${bedId}:crib`, bedId, patient: patient.clinicalCrib });
    }
    return occupants;
  });

const vacatedOccupants = (
  oldRecord: DailyRecordIntegrityState,
  newRecord: DailyRecordIntegrityState
): VacatedOccupant[] => {
  const nextBySlot = new Map(recordOccupants(newRecord).map(occupant => [occupant.key, occupant]));
  return recordOccupants(oldRecord).filter(oldOccupant => {
    const nextOccupant = nextBySlot.get(oldOccupant.key);
    return !nextOccupant || !samePatientIdentity(oldOccupant.patient, nextOccupant.patient);
  });
};

const movementMatchesVacatedOccupant = (
  movement: DensityMovement,
  occupant: VacatedOccupant
): boolean => {
  if (movement.bedId !== occupant.bedId) return false;
  return samePatientIdentity(
    {
      clinicalEpisodeId: movement.clinicalEpisodeId ?? movement.originalData?.clinicalEpisodeId,
      rut: movement.rut ?? movement.originalData?.rut ?? '',
      patientName: movement.patientName ?? movement.originalData?.patientName ?? '',
    },
    occupant.patient
  );
};

const calculateMovementDensity = (
  discharges: ReadonlyArray<DensityMovement>,
  transfers: ReadonlyArray<DensityMovement>,
  cma: ReadonlyArray<DensityMovement>
): number =>
  discharges.length * 8 +
  transfers.length * 8 +
  cma.length * 5 +
  calculateMovementSnapshotDensity(discharges) +
  calculateMovementSnapshotDensity(transfers) +
  calculateMovementSnapshotDensity(cma);

const calculateNewMovementDensity = (
  oldMovements: ReadonlyArray<DensityMovement>,
  newMovements: ReadonlyArray<DensityMovement>,
  baseWeight: number,
  vacated: ReadonlyArray<VacatedOccupant>,
  creditedOccupants: Set<string>
): number => {
  const existingIds = new Set(oldMovements.map(movement => movement.id).filter(Boolean));
  return newMovements.reduce((total, movement) => {
    // Legacy movements without ids cannot be proven new. Do not let retained legacy history
    // contribute evidence that could mask an unrelated loss of current occupants.
    if (!movement.id || existingIds.has(movement.id)) return total;
    const matchedOccupant = vacated.find(
      occupant =>
        !creditedOccupants.has(occupant.key) && movementMatchesVacatedOccupant(movement, occupant)
    );
    if (!matchedOccupant) return total;
    creditedOccupants.add(matchedOccupant.key);
    return total + baseWeight + calculatePatientDensity(movement.originalData);
  }, 0);
};

const movementHistoryKey = (kind: string, movement: DensityMovement): string => {
  if (movement.id) return `${kind}:id:${movement.id}`;
  // Old movements may predate stable ids. Episode is immutable enough to compare when present;
  // otherwise compare their count per kind. Editable row fields (name, bed, time) must not turn a
  // legitimate edit into an apparent deletion that blocks the whole record save.
  const episode = String(movement.clinicalEpisodeId ?? '').trim();
  return episode ? `${kind}:legacy-episode:${episode}` : `${kind}:legacy-unidentified`;
};

const hasMovementHistoryLoss = (
  oldRecord: DailyRecordIntegrityState,
  newRecord: DailyRecordIntegrityState
): boolean => {
  const counts = new Map<string, number>();
  const add = (kind: string, movements: ReadonlyArray<DensityMovement>, delta: number): void => {
    for (const movement of movements) {
      const key = movementHistoryKey(kind, movement);
      counts.set(key, (counts.get(key) ?? 0) + delta);
    }
  };
  add('discharge', oldRecord.discharges || [], 1);
  add('transfer', oldRecord.transfers || [], 1);
  add('cma', oldRecord.cma || [], 1);
  add('discharge', newRecord.discharges || [], -1);
  add('transfer', newRecord.transfers || [], -1);
  add('cma', newRecord.cma || [], -1);
  return [...counts.values()].some(count => count > 0);
};

/**
 * Calculates a "density score" for a daily record.
 * This is a heuristic metric representing how much clinical data the record contains.
 */
export const calculateDensity = (record: DailyRecordIntegrityState | null | undefined): number => {
  if (!record) return 0;

  let score = 0;

  // 1. Bed Occupancy (major weight)
  const activeBeds = Object.values(record.beds || {}).filter(
    b => b && (b.patientName || b.isBlocked)
  );
  score += activeBeds.reduce((total, bed) => total + calculatePatientDensity(bed), 0);

  // 2. Documented movements. A discharge or transfer preserves the vacated patient's snapshot;
  // count that retained information so a legitimate multi-discharge sync is not mistaken for a
  // destructive overwrite. The exact patient/bed erasure guard remains the authoritative safety
  // check when a movement does not account for a removed occupant.
  score += calculateMovementDensity(
    record.discharges || [],
    record.transfers || [],
    record.cma || []
  );

  // 3. Staffing
  const staffArrays = [
    record.nursesDayShift,
    record.nursesNightShift,
    record.tensDayShift,
    record.tensNightShift,
  ];
  staffArrays.forEach(arr => {
    if (Array.isArray(arr)) {
      score += arr.filter(name => name && name.trim().length > 0).length * 2;
    }
  });

  // 4. Handoff context
  if (record.handoffNovedadesDayShift) score += 10;
  if (record.handoffNovedadesNightShift) score += 10;
  if (buildMedicalHandoffSummary(record)) score += 10;

  return score;
};

/**
 * Checks if a new record version is a suspicious regression compared to an old one.
 *
 * Logic:
 * If the old record was substantial (density > 20) and the new record is significantly
 * less dense (regression > 40%), it's considered suspicious.
 *
 * Exceptions:
 * - If the old record was nearly empty (density < 10).
 * - Total wipes are always suspicious if old record was full.
 */
export const checkRegression = (
  oldRecord: DailyRecordIntegrityState | null | undefined,
  newRecord: DailyRecordIntegrityState
): { isSuspicious: boolean; dropPercentage: number } => {
  if (!oldRecord) return { isSuspicious: false, dropPercentage: 0 };

  const oldMovementDensity = calculateMovementDensity(
    oldRecord.discharges || [],
    oldRecord.transfers || [],
    oldRecord.cma || []
  );
  const newMovementDensity = calculateMovementDensity(
    newRecord.discharges || [],
    newRecord.transfers || [],
    newRecord.cma || []
  );
  // Historical movements are shared archive data, not current occupancy. Remove them from both
  // sides and credit only movements added by this save, so a legitimate discharge is accepted
  // without allowing a large accumulated history to hide an unrelated destructive overwrite.
  const oldDensity = calculateDensity(oldRecord) - oldMovementDensity;
  const removedOccupants = vacatedOccupants(oldRecord, newRecord);
  const creditedOccupants = new Set<string>();
  const newDensity =
    calculateDensity(newRecord) -
    newMovementDensity +
    calculateNewMovementDensity(
      oldRecord.discharges || [],
      newRecord.discharges || [],
      8,
      removedOccupants,
      creditedOccupants
    ) +
    calculateNewMovementDensity(
      oldRecord.transfers || [],
      newRecord.transfers || [],
      8,
      removedOccupants,
      creditedOccupants
    ) +
    calculateNewMovementDensity(
      oldRecord.cma || [],
      newRecord.cma || [],
      5,
      removedOccupants,
      creditedOccupants
    );

  // Movement history is append-only evidence. Its loss is suspicious even when the occupancy
  // portion of the record is small enough to bypass the general density heuristic.
  if (hasMovementHistoryLoss(oldRecord, newRecord)) {
    const movementDropPercentage =
      oldMovementDensity > 0
        ? ((oldMovementDensity - newMovementDensity) / oldMovementDensity) * 100
        : 0;
    return { isSuspicious: true, dropPercentage: movementDropPercentage };
  }

  // If remote is basically empty, no risk of regression
  if (oldDensity < 10) return { isSuspicious: false, dropPercentage: 0 };

  const drop = oldDensity - newDensity;
  const dropPercentage = (drop / oldDensity) * 100;

  // Thresholds:
  // 1. If we lose more than 40% of data density, it's a regression
  // 2. If we lose more than 5 beds worth of data (50 density points)
  const isSuspicious = dropPercentage > 40 || drop > 50;

  return { isSuspicious, dropPercentage };
};
