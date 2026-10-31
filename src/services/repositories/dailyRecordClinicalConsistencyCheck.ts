import type { DailyRecord } from '@/types/domain/dailyRecord';
import type { PatientData } from '@/types/domain/patient';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import { normalizeMovementBedConsistency } from '@/services/repositories/clinicalMovementBedConsistencyPolicy';

export type DailyRecordClinicalConsistencyPhase =
  | 'read_publish'
  | 'sync_publish'
  | 'local_hydration'
  | 'persistence';

export type DailyRecordClinicalConsistencyViolationType =
  | 'bed_discharge_violation'
  | 'duplicate_active_patient';

export interface DailyRecordClinicalConsistencyViolation {
  type: DailyRecordClinicalConsistencyViolationType;
  path: string;
  bedId?: string;
  message: string;
  repaired: boolean;
}

export interface DailyRecordClinicalConsistencyContext {
  date: string;
  phase: DailyRecordClinicalConsistencyPhase;
}

export interface DailyRecordClinicalConsistencyResult extends DailyRecordClinicalConsistencyContext {
  record: DailyRecord;
  status: 'ok' | 'repaired' | 'blocked';
  violations: DailyRecordClinicalConsistencyViolation[];
  repairedPaths: string[];
}

const normalizeIdentity = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const resolveActivePatientKey = (patient: PatientData | undefined): string => {
  const rut = normalizeIdentity(patient?.rut);
  if (rut) return `rut:${rut}`;
  const name = normalizeIdentity(patient?.patientName);
  return name ? `name:${name}` : '';
};

const collectDuplicateActivePatientViolations = (
  record: DailyRecord
): DailyRecordClinicalConsistencyViolation[] => {
  const seen = new Map<string, string>();
  const violations: DailyRecordClinicalConsistencyViolation[] = [];

  Object.entries(record.beds || {}).forEach(([bedId, patient]) => {
    const key = resolveActivePatientKey(patient);
    if (!key) return;

    const previousBedId = seen.get(key);
    if (!previousBedId) {
      seen.set(key, bedId);
      return;
    }

    violations.push({
      type: 'duplicate_active_patient',
      path: `beds.${bedId}`,
      bedId,
      message: `Paciente activo duplicado en ${previousBedId} y ${bedId}.`,
      repaired: false,
    });
  });

  return violations;
};

export const applyDailyRecordClinicalConsistencyCheck = (
  record: DailyRecord,
  context: DailyRecordClinicalConsistencyContext
): DailyRecordClinicalConsistencyResult => {
  const movementConsistency = normalizeMovementBedConsistency(record);
  const repairedPaths = Object.keys(movementConsistency.patches);
  const movementViolations = repairedPaths.map(path => ({
    type: 'bed_discharge_violation' as const,
    path,
    bedId: path.split('.')[1],
    message: 'Movimiento confirmado contradice la ocupacion activa de cama.',
    repaired: true,
  }));
  const duplicateViolations = collectDuplicateActivePatientViolations(movementConsistency.record);
  const violations = [...movementViolations, ...duplicateViolations];

  return {
    ...context,
    record: movementConsistency.record,
    status:
      violations.length === 0 ? 'ok' : duplicateViolations.length > 0 ? 'blocked' : 'repaired',
    violations,
    repairedPaths,
  };
};

export const recordClinicalConsistencyTelemetry = (
  result: DailyRecordClinicalConsistencyResult
): void => {
  if (result.violations.length === 0) {
    return;
  }

  recordOperationalTelemetry({
    category: 'sync',
    operation: 'daily_record_clinical_consistency',
    status: result.status === 'blocked' ? 'failed' : 'degraded',
    runtimeState: result.status === 'blocked' ? 'blocked' : 'recoverable',
    issues: result.violations.map(violation => violation.message),
    context: {
      date: result.date,
      phase: result.phase,
      violationTypes: Array.from(new Set(result.violations.map(violation => violation.type))),
      violationPaths: result.violations.map(violation => violation.path),
      repairedPaths: result.repairedPaths,
    },
  });
};
