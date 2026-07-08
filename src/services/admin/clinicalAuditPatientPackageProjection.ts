import type { AuditLogEntry } from '@/types/auditLogTypes';
import {
  buildClinicalAuditPresentation,
  type ClinicalAuditPresentation,
} from '@/services/admin/clinicalAuditPresentation';
import type {
  ClinicalAuditPackageChange,
  ClinicalAuditPatientPackageActor,
} from '@/services/admin/clinicalAuditPatientPackageTypes';

export interface LogPackageProjection {
  log: AuditLogEntry;
  presentation: ClinicalAuditPresentation;
  changes: ClinicalAuditPackageChange[];
  modules: string[];
}

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const buildLogPackageProjection = (
  log: AuditLogEntry,
  inferModules: (log: AuditLogEntry, changes: ClinicalAuditPackageChange[]) => string[]
): LogPackageProjection => {
  const presentation = buildClinicalAuditPresentation(log);
  const changes = presentation.importantChanges.map(change => ({
    ...change,
    sourceLogId: log.id,
  }));

  return {
    log,
    presentation,
    changes,
    modules: inferModules(log, changes),
  };
};

export const buildActorsFromLogProjections = (
  projections: LogPackageProjection[]
): ClinicalAuditPatientPackageActor[] => {
  const actors = new Map<string, ClinicalAuditPatientPackageActor>();

  projections.forEach(({ log, presentation }) => {
    const key = asText(log.userUid) || asText(log.userId) || presentation.actorLabel;
    if (!actors.has(key)) {
      actors.set(key, {
        label: presentation.actorLabel,
        secondary: presentation.actorSecondary,
        userId: asText(log.userId) || undefined,
        uid: asText(log.userUid) || undefined,
      });
    }
  });

  return [...actors.values()];
};
