import {
  buildClinicalEpisodeKey,
  normalizeClinicalEpisodeId,
  resolveClinicalEpisodeIdentifier,
} from '@/application/patient-flow/clinicalEpisode';
import {
  getActiveCma,
  getActiveDischarges,
  getActiveTransfers,
} from '@/application/census/movementTombstonePolicy';
import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  resolveMovementHistoricalAdmissionDate,
  resolveMovementHistoricalAdmissionTime,
  type CMAData,
  type DischargeData,
  type TransferData,
} from '@/types/domain/movements';
import type { PatientData } from '@/types/domain/patient';

export type DailyRecordClinicalAuthorityPhase = 'sync_publish' | 'persistence';

export type DailyRecordClinicalAuthorityViolationType =
  | 'duplicate_active_episode'
  | 'closed_episode_active_in_bed';

export interface DailyRecordClinicalAuthorityViolation {
  type: DailyRecordClinicalAuthorityViolationType;
  path: string;
  bedId?: string;
  episodeKey: string;
  message: string;
}

export interface DailyRecordClinicalAuthorityContext {
  date: string;
  phase: DailyRecordClinicalAuthorityPhase;
}

export interface DailyRecordClinicalAuthorityResult extends DailyRecordClinicalAuthorityContext {
  status: 'ok' | 'blocked';
  violations: DailyRecordClinicalAuthorityViolation[];
}

interface ActiveEpisodeEntry {
  bedId: string;
  path: string;
  episodeKey: string;
}

interface EpisodeCoverageSnapshot {
  activePatients: number;
  canonicalEpisodeIds: number;
  fallbackEpisodeKeys: number;
  degenerateFallbackEpisodeKeys: number;
}

const normalizeText = (value: unknown): string => String(value || '').trim();

const hasActivePatientIdentity = (patient: PatientData | undefined): patient is PatientData =>
  Boolean(
    patient &&
    !patient.isBlocked &&
    (normalizeText(patient.clinicalEpisodeId) ||
      normalizeText(patient.rut) ||
      normalizeText(patient.patientName) ||
      normalizeText(patient.admissionDate))
  );

const resolvePatientEpisodeKey = (patient: PatientData): string =>
  resolveClinicalEpisodeIdentifier(patient);

const collectActiveEpisodeEntries = (record: DailyRecord): ActiveEpisodeEntry[] => {
  const entries: ActiveEpisodeEntry[] = [];

  Object.entries(record.beds || {}).forEach(([bedId, patient]) => {
    if (hasActivePatientIdentity(patient)) {
      entries.push({
        bedId,
        path: `beds.${bedId}`,
        episodeKey: resolvePatientEpisodeKey(patient),
      });
    }

    if (hasActivePatientIdentity(patient?.clinicalCrib)) {
      entries.push({
        bedId,
        path: `beds.${bedId}.clinicalCrib`,
        episodeKey: resolvePatientEpisodeKey(patient.clinicalCrib),
      });
    }
  });

  return entries.filter(entry => Boolean(entry.episodeKey));
};

const resolveMovementEpisodeKey = (movement: DischargeData | TransferData | CMAData): string => {
  const persistedEpisodeId = normalizeClinicalEpisodeId(movement.clinicalEpisodeId);
  if (persistedEpisodeId) {
    return persistedEpisodeId;
  }

  return buildClinicalEpisodeKey(
    movement.rut || movement.patientName || '',
    resolveMovementHistoricalAdmissionDate(movement),
    resolveMovementHistoricalAdmissionTime(movement)
  );
};

const collectClosedMovementEpisodeKeys = (record: DailyRecord): Set<string> => {
  const keys = new Set<string>();
  const append = (movement: DischargeData | TransferData | CMAData) => {
    const key = resolveMovementEpisodeKey(movement);
    if (key) keys.add(key);
  };

  getActiveDischarges(record.discharges).forEach(append);
  getActiveTransfers(record.transfers).forEach(append);
  getActiveCma(record.cma).forEach(append);
  return keys;
};

const collectDuplicateEpisodeViolations = (
  activeEpisodes: ActiveEpisodeEntry[]
): DailyRecordClinicalAuthorityViolation[] => {
  const seen = new Map<string, ActiveEpisodeEntry>();
  const violations: DailyRecordClinicalAuthorityViolation[] = [];

  activeEpisodes.forEach(entry => {
    const previous = seen.get(entry.episodeKey);
    if (!previous) {
      seen.set(entry.episodeKey, entry);
      return;
    }

    violations.push({
      type: 'duplicate_active_episode',
      path: entry.path,
      bedId: entry.bedId,
      episodeKey: entry.episodeKey,
      message: `Episodio clinico activo duplicado en ${previous.path} y ${entry.path}.`,
    });
  });

  return violations;
};

const collectClosedEpisodeViolations = (
  activeEpisodes: ActiveEpisodeEntry[],
  closedMovementEpisodeKeys: Set<string>
): DailyRecordClinicalAuthorityViolation[] =>
  activeEpisodes
    .filter(entry => closedMovementEpisodeKeys.has(entry.episodeKey))
    .map(entry => ({
      type: 'closed_episode_active_in_bed',
      path: entry.path,
      bedId: entry.bedId,
      episodeKey: entry.episodeKey,
      message: `Episodio clinico ${entry.episodeKey} permanece activo en cama pese a movimiento de cierre.`,
    }));

export const evaluateDailyRecordClinicalAuthority = (
  record: DailyRecord,
  context: DailyRecordClinicalAuthorityContext
): DailyRecordClinicalAuthorityResult => {
  const activeEpisodes = collectActiveEpisodeEntries(record);
  const closedMovementEpisodeKeys = collectClosedMovementEpisodeKeys(record);
  const violations = [
    ...collectDuplicateEpisodeViolations(activeEpisodes),
    ...collectClosedEpisodeViolations(activeEpisodes, closedMovementEpisodeKeys),
  ];

  return {
    ...context,
    status: violations.length > 0 ? 'blocked' : 'ok',
    violations,
  };
};

export const recordClinicalAuthorityTelemetry = (
  result: DailyRecordClinicalAuthorityResult
): void => {
  if (result.violations.length === 0) {
    return;
  }

  recordOperationalTelemetry({
    category: 'sync',
    operation: 'daily_record_clinical_authority',
    status: 'failed',
    runtimeState: 'blocked',
    issues: result.violations.map(violation => violation.message),
    context: {
      date: result.date,
      phase: result.phase,
      violationTypes: Array.from(new Set(result.violations.map(violation => violation.type))),
      violationPaths: result.violations.map(violation => violation.path),
      episodeKeys: result.violations.map(violation => violation.episodeKey),
    },
  });
};

const collectEpisodeCoverageSnapshot = (record: DailyRecord): EpisodeCoverageSnapshot => {
  const snapshot: EpisodeCoverageSnapshot = {
    activePatients: 0,
    canonicalEpisodeIds: 0,
    fallbackEpisodeKeys: 0,
    degenerateFallbackEpisodeKeys: 0,
  };

  const visit = (patient: PatientData | undefined) => {
    if (!hasActivePatientIdentity(patient)) {
      return;
    }

    snapshot.activePatients += 1;
    if (normalizeClinicalEpisodeId(patient.clinicalEpisodeId)) {
      snapshot.canonicalEpisodeIds += 1;
      return;
    }

    snapshot.fallbackEpisodeKeys += 1;
    if (!normalizeText(patient.rut) || !normalizeText(patient.admissionTime)) {
      snapshot.degenerateFallbackEpisodeKeys += 1;
    }
  };

  Object.values(record.beds || {}).forEach(patient => {
    visit(patient);
    visit(patient?.clinicalCrib);
  });

  return snapshot;
};

export const recordClinicalEpisodeIdCoverageTelemetry = (
  record: DailyRecord,
  context: DailyRecordClinicalAuthorityContext
): void => {
  const snapshot = collectEpisodeCoverageSnapshot(record);
  if (snapshot.activePatients === 0 || snapshot.fallbackEpisodeKeys === 0) {
    return;
  }

  recordOperationalTelemetry({
    category: 'sync',
    operation: 'clinical_episode_id_coverage',
    status: snapshot.degenerateFallbackEpisodeKeys > 0 ? 'failed' : 'degraded',
    runtimeState: snapshot.degenerateFallbackEpisodeKeys > 0 ? 'blocked' : 'recoverable',
    issues: ['Pacientes activos usan fallback legacy de episodio clinico.'],
    context: {
      date: context.date,
      phase: context.phase,
      ...snapshot,
    },
  });
};
