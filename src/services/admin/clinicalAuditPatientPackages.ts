import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import {
  buildActorsFromLogProjections,
  buildLogPackageProjection,
} from '@/services/admin/clinicalAuditPatientPackageProjection';
import {
  PATIENT_PACKAGE_WINDOW_MS,
  type ClinicalAuditPackageChange,
  type ClinicalAuditPackageFlags,
  type ClinicalAuditPatientPackage,
} from '@/services/admin/clinicalAuditPatientPackageTypes';
import {
  asAuditText,
  getAuditLogDetails,
  getBedLabelParts,
  getClinicalAuditPatientRut,
  getClinicalAuditRecordDate,
  getPatientNameFromPresentation,
  getPrimaryBedLabelForLog,
  parseAuditTimestampMs,
  resolveClinicalAuditPackageKey,
} from '@/services/admin/clinicalAuditPatientPackageKey';
import {
  DOCUMENT_AUDIT_ACTIONS,
  MEDICATION_AUDIT_ACTIONS,
  VIEW_AUDIT_ACTIONS,
} from '@/services/admin/clinicalAuditPatientPackageActionGroups';

export type {
  ClinicalAuditPackageChange,
  ClinicalAuditPackageFlags,
  ClinicalAuditPatientPackage,
  ClinicalAuditPatientPackageActor,
} from '@/services/admin/clinicalAuditPatientPackageTypes';

export { resolveClinicalAuditPackageKey } from '@/services/admin/clinicalAuditPatientPackageKey';

interface PackageDraft {
  baseKey: string;
  firstTimestampMs: number;
  lastTimestampMs: number;
  logs: AuditLogEntry[];
}

const hasAction = (log: AuditLogEntry, action: AuditAction): boolean => log.action === action;

const logHasConflictEvidence = (log: AuditLogEntry): boolean => log.action.includes('CONFLICT');

const valueMentionsCma = (value: unknown): boolean => {
  if (typeof value === 'string') return value.trim().toUpperCase() === 'CMA';
  if (Array.isArray(value)) return value.some(valueMentionsCma);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(valueMentionsCma);
  }
  return false;
};

const pushUnique = <T>(target: T[], value: T): void => {
  if (!target.includes(value)) target.push(value);
};

const inferModulesForLog = (
  log: AuditLogEntry,
  changes: ClinicalAuditPackageChange[]
): string[] => {
  const details = getAuditLogDetails(log);
  const modules: string[] = [];

  if (hasAction(log, 'PATIENT_ADMITTED')) pushUnique(modules, 'Ingreso');
  if (hasAction(log, 'PATIENT_DISCHARGED')) pushUnique(modules, 'Alta');
  if (hasAction(log, 'PATIENT_TRANSFERRED')) pushUnique(modules, 'Traslado');
  if (hasAction(log, 'PATIENT_BED_CHANGED') || details.movementKind === 'move') {
    pushUnique(modules, 'Movimiento interno');
  }
  if (logHasConflictEvidence(log)) pushUnique(modules, 'Conflicto');
  if (VIEW_AUDIT_ACTIONS.has(log.action)) pushUnique(modules, 'Visualización');
  if (DOCUMENT_AUDIT_ACTIONS.has(log.action)) pushUnique(modules, 'Documentos');
  if (MEDICATION_AUDIT_ACTIONS.has(log.action)) pushUnique(modules, 'Indicaciones y recetas');

  changes.forEach(change => pushUnique(modules, change.fieldLabel));

  if (valueMentionsCma(details)) pushUnique(modules, 'CMA');

  return modules;
};

const buildFlags = (
  logs: AuditLogEntry[],
  changes: ClinicalAuditPackageChange[]
): ClinicalAuditPackageFlags => {
  const discharge = logs.some(log => hasAction(log, 'PATIENT_DISCHARGED'));
  const transfer = logs.some(log => hasAction(log, 'PATIENT_TRANSFERRED'));
  const internalMovement = logs.some(log => {
    const details = getAuditLogDetails(log);
    return hasAction(log, 'PATIENT_BED_CHANGED') || details.movementKind === 'move';
  });
  const conflict = logs.some(logHasConflictEvidence);
  const admission = logs.some(log => hasAction(log, 'PATIENT_ADMITTED'));
  const diagnosis =
    logs.some(log => log.action.includes('DIAGNOSIS')) ||
    changes.some(change => change.fieldLabel === 'Diagnóstico');
  const status = changes.some(change => change.fieldLabel === 'Estado');
  const cma = logs.some(log => valueMentionsCma(getAuditLogDetails(log)));

  return {
    admission,
    discharge,
    transfer,
    internalMovement,
    cma,
    conflict,
    diagnosis,
    status,
    risk: discharge || transfer || internalMovement || cma || conflict,
  };
};

const buildSummary = (params: {
  patientName: string;
  eventCount: number;
  modules: string[];
  primaryBedLabel?: string;
}): string => {
  const moduleText = params.modules.length > 0 ? params.modules.join(', ') : 'actividad auditada';
  const bedText = params.primaryBedLabel ? ` · ${params.primaryBedLabel}` : '';
  return `${params.patientName}${bedText} · ${params.eventCount} evento${
    params.eventCount === 1 ? '' : 's'
  }: ${moduleText}`;
};

const buildPackageFromLogs = (
  baseKey: string,
  logs: AuditLogEntry[]
): ClinicalAuditPatientPackage => {
  const chronologicalLogs = [...logs].sort(
    (a, b) => parseAuditTimestampMs(a.timestamp) - parseAuditTimestampMs(b.timestamp)
  );
  const rawLogs = [...chronologicalLogs].sort(
    (a, b) => parseAuditTimestampMs(b.timestamp) - parseAuditTimestampMs(a.timestamp)
  );
  const firstLog = chronologicalLogs[0];
  const lastLog = chronologicalLogs[chronologicalLogs.length - 1];
  const projections = chronologicalLogs.map(log =>
    buildLogPackageProjection(log, inferModulesForLog)
  );
  const allChanges = projections.flatMap(projection => projection.changes);
  const modules: string[] = [];

  projections.forEach(projection => {
    projection.modules.forEach(moduleName => pushUnique(modules, moduleName));
  });

  const actions: AuditAction[] = [];
  chronologicalLogs.forEach(log => pushUnique(actions, log.action));

  const movementBedLabel = [...chronologicalLogs]
    .reverse()
    .map(getPrimaryBedLabelForLog)
    .find(label => label?.includes(' -> '));
  const primaryBedLabel =
    movementBedLabel ||
    [...new Set(chronologicalLogs.flatMap(getBedLabelParts))]
      .filter(Boolean)
      .slice(0, 2)
      .join(', ') ||
    undefined;
  const patientName = getPatientNameFromPresentation(firstLog, projections[0].presentation);
  const patientRut = getClinicalAuditPatientRut(firstLog);
  const ipAddresses = [
    ...new Set(chronologicalLogs.map(log => asAuditText(log.ipAddress)).filter(Boolean)),
  ];

  return {
    id: `patient-package-${baseKey}-${parseAuditTimestampMs(firstLog.timestamp)}`,
    packageKey: baseKey,
    patientName,
    patientRut,
    patientIdentifier: asAuditText(firstLog.patientIdentifier) || patientRut,
    recordDate: getClinicalAuditRecordDate(firstLog),
    primaryBedLabel,
    startedAt: firstLog.timestamp,
    endedAt: lastLog.timestamp,
    actors: buildActorsFromLogProjections(projections),
    ipAddresses,
    actions,
    modules,
    changes: allChanges,
    flags: buildFlags(chronologicalLogs, allChanges),
    eventCount: chronologicalLogs.length,
    summary: buildSummary({
      patientName,
      eventCount: chronologicalLogs.length,
      modules,
      primaryBedLabel,
    }),
    rawLogs,
  };
};

export const buildClinicalAuditPatientPackages = (
  logs: AuditLogEntry[]
): ClinicalAuditPatientPackage[] => {
  const drafts: PackageDraft[] = [];
  const draftsByBaseKey = new Map<string, PackageDraft[]>();
  const sortedLogs = [...logs].sort(
    (a, b) => parseAuditTimestampMs(a.timestamp) - parseAuditTimestampMs(b.timestamp)
  );

  sortedLogs.forEach(log => {
    const baseKey = resolveClinicalAuditPackageKey(log);
    const logTime = parseAuditTimestampMs(log.timestamp);
    const keyDrafts = draftsByBaseKey.get(baseKey) || [];
    const existingDraft = keyDrafts.find(draft => {
      return (
        logTime - draft.firstTimestampMs < PATIENT_PACKAGE_WINDOW_MS &&
        logTime - draft.lastTimestampMs < PATIENT_PACKAGE_WINDOW_MS
      );
    });

    if (existingDraft) {
      existingDraft.logs.push(log);
      existingDraft.lastTimestampMs = Math.max(existingDraft.lastTimestampMs, logTime);
      return;
    }

    const newDraft = {
      baseKey,
      firstTimestampMs: logTime,
      lastTimestampMs: logTime,
      logs: [log],
    };

    drafts.push(newDraft);
    keyDrafts.push(newDraft);
    draftsByBaseKey.set(baseKey, keyDrafts);
  });

  return drafts
    .map(draft => buildPackageFromLogs(draft.baseKey, draft.logs))
    .sort((a, b) => parseAuditTimestampMs(b.endedAt) - parseAuditTimestampMs(a.endedAt));
};
