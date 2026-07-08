import type {
  ClinicalAuditPackageChange,
  ClinicalAuditPatientPackage,
} from '@/services/admin/clinicalAuditPatientPackages';
import { formatTimestamp } from './auditUIUtils';

const INLINE_VALUE_PREVIEW_LENGTH = 96;
const VERBOSE_VALUE_THRESHOLD = 72;

export const formatAuditPackageValue = (value: unknown): string => {
  if (value === undefined || value === null || value === '') return '-';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

export const formatAuditPackageValuePreview = (value: unknown): string => {
  const text = formatAuditPackageValue(value).replace(/\s+/g, ' ').trim();
  if (text.length <= INLINE_VALUE_PREVIEW_LENGTH) return text;
  return `${text.slice(0, INLINE_VALUE_PREVIEW_LENGTH).trimEnd()}...`;
};

export const isVerboseAuditPackageValue = (value: unknown): boolean => {
  const text = formatAuditPackageValue(value);
  return text.length > VERBOSE_VALUE_THRESHOLD || /\n/.test(text);
};

export const displayTimestampParts = (timestamp: string): { date: string; time: string } => {
  const [date = '', time = ''] = formatTimestamp(timestamp).split(' ');
  return { date, time };
};

export const getAuditPackageActorSummary = (auditPackage: ClinicalAuditPatientPackage): string =>
  auditPackage.actors.map(actor => actor.label).join(', ') || 'Usuario no identificado';

const CHANGE_PRIORITY = [
  'Diagnóstico',
  'Diagnóstico de egreso',
  'Novedades',
  'Alta',
  'Traslado',
  'Movimiento interno',
  'CMA',
  'Especialidad',
  'Estado',
];

const getChangePriority = (change: ClinicalAuditPackageChange): number => {
  const index = CHANGE_PRIORITY.indexOf(change.fieldLabel);
  return index === -1 ? CHANGE_PRIORITY.length : index;
};

const shouldShowLatestVerboseTransition = (
  existing: ClinicalAuditPackageChange,
  next: ClinicalAuditPackageChange
): boolean => {
  return (
    isVerboseAuditPackageValue(existing.newValue) ||
    isVerboseAuditPackageValue(next.oldValue) ||
    isVerboseAuditPackageValue(next.newValue)
  );
};

export const buildAuditPackageDisplayChanges = (
  auditPackage: ClinicalAuditPatientPackage
): ClinicalAuditPackageChange[] => {
  const changesByField = new Map<string, ClinicalAuditPackageChange>();

  auditPackage.changes.forEach(change => {
    const existing = changesByField.get(change.fieldLabel);
    if (!existing) {
      changesByField.set(change.fieldLabel, change);
      return;
    }

    changesByField.set(change.fieldLabel, {
      ...change,
      oldValue: shouldShowLatestVerboseTransition(existing, change)
        ? existing.newValue
        : existing.oldValue,
    });
  });

  return Array.from(changesByField.values()).sort(
    (left, right) => getChangePriority(left) - getChangePriority(right)
  );
};

const pickNarrativeChange = (auditPackage: ClinicalAuditPatientPackage) => {
  return buildAuditPackageDisplayChanges(auditPackage)[0];
};

const resolveActionVerb = (auditPackage: ClinicalAuditPatientPackage): string => {
  if (auditPackage.flags.admission) return 'registró ingreso';
  if (auditPackage.flags.discharge) return 'registró alta';
  if (auditPackage.flags.transfer) return 'registró traslado';
  if (auditPackage.flags.internalMovement) return 'registró movimiento interno';
  if (auditPackage.flags.cma) return 'marcó CMA';
  if (auditPackage.flags.conflict) return 'resolvió conflicto';
  return 'cambió';
};

export const buildClinicalAuditPackageNarrative = (
  auditPackage: ClinicalAuditPatientPackage
): string => {
  const actor = getAuditPackageActorSummary(auditPackage);
  const bed = auditPackage.primaryBedLabel ? ` en cama ${auditPackage.primaryBedLabel}` : '';
  const change = pickNarrativeChange(auditPackage);

  if (change) {
    const hasVerboseValue =
      isVerboseAuditPackageValue(change.oldValue) || isVerboseAuditPackageValue(change.newValue);
    if (hasVerboseValue) {
      const eventText =
        auditPackage.eventCount > 1 ? ` (${auditPackage.eventCount} eventos integrados)` : '';
      return `${actor} actualizó ${change.fieldLabel}${bed}${eventText}`;
    }

    return `${actor} cambió ${change.fieldLabel} de ${formatAuditPackageValue(
      change.oldValue
    )} a ${formatAuditPackageValue(change.newValue)}${bed}`;
  }

  return `${actor} ${resolveActionVerb(auditPackage)} de ${auditPackage.patientName}${bed}`;
};

const VIEW_ACTIONS = new Set([
  'VIEW_PATIENT',
  'PATIENT_VIEWED',
  'VIEW_CUDYR',
  'VIEW_NURSING_HANDOFF',
  'VIEW_MEDICAL_HANDOFF',
]);

export const isAuditPackageViewAction = (action: string): boolean => VIEW_ACTIONS.has(action);

export const getRawAuditPackageEventsJson = (auditPackage: ClinicalAuditPatientPackage): string =>
  JSON.stringify(
    auditPackage.rawLogs.map(log => ({
      id: log.id,
      timestamp: log.timestamp,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      recordDate: log.recordDate,
      patientIdentifier: log.patientIdentifier,
      details: log.details,
    })),
    null,
    2
  );

export const buildAuditPackageCopySummary = (auditPackage: ClinicalAuditPatientPackage): string => {
  const identity = [
    auditPackage.patientName,
    auditPackage.patientRut ? `RUT/ID ${auditPackage.patientRut}` : '',
    auditPackage.primaryBedLabel ? `Cama ${auditPackage.primaryBedLabel}` : '',
    `Censo ${auditPackage.recordDate}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const changes =
    auditPackage.changes.length > 0
      ? auditPackage.changes
          .map(
            change =>
              `${change.fieldLabel}: ${formatAuditPackageValue(
                change.oldValue
              )} -> ${formatAuditPackageValue(change.newValue)}`
          )
          .join('\n')
      : auditPackage.summary;

  return `${identity}\n${auditPackage.eventCount} eventos · ${getAuditPackageActorSummary(
    auditPackage
  )}\n${changes}`;
};
