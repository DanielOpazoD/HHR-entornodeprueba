import { recordOperationalTelemetry } from '@/services/observability/operationalTelemetryRecorder';
import type { DailyRecord } from '@/types/domain/dailyRecord';
import {
  collectClinicalEpisodeCoverage,
  evaluateDailyRecordClinicalAuthorityCore,
  type DailyRecordClinicalAuthorityViolation,
  type DailyRecordClinicalAuthorityViolationType,
} from './dailyRecordClinicalAuthorityCore';

export type { DailyRecordClinicalAuthorityViolation, DailyRecordClinicalAuthorityViolationType };

export type DailyRecordClinicalAuthorityPhase = 'sync_publish' | 'persistence';

export interface DailyRecordClinicalAuthorityContext {
  date: string;
  phase: DailyRecordClinicalAuthorityPhase;
}

export interface DailyRecordClinicalAuthorityResult extends DailyRecordClinicalAuthorityContext {
  status: 'ok' | 'blocked';
  violations: DailyRecordClinicalAuthorityViolation[];
}

export const evaluateDailyRecordClinicalAuthority = (
  record: DailyRecord,
  context: DailyRecordClinicalAuthorityContext
): DailyRecordClinicalAuthorityResult => {
  const result = evaluateDailyRecordClinicalAuthorityCore(record);
  return {
    ...context,
    status: result.status,
    violations: result.violations,
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

export const recordClinicalEpisodeIdCoverageTelemetry = (
  record: DailyRecord,
  context: DailyRecordClinicalAuthorityContext
): void => {
  const snapshot = collectClinicalEpisodeCoverage(record);
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
