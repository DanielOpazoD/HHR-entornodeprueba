import type { AuditAction } from '@/types/auditActionTypes';
import type { ClinicalAuditPatientPackage } from '@/services/admin/clinicalAuditPatientPackages';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditConstants';
import {
  DOCUMENT_AUDIT_ACTIONS,
  MEDICATION_AUDIT_ACTIONS,
  VIEW_AUDIT_ACTIONS,
} from '@/services/admin/clinicalAuditPatientPackageActionGroups';
import {
  getClinicalAuditTimelineV2StatesForPackage,
  getClinicalAuditTimelineV2SummaryForPackage,
} from '@/services/admin/clinicalAuditTimelineV2';

export type ClinicalAuditPatientPackageFilterId =
  | 'ALL'
  | 'CENSUS'
  | 'PATIENT'
  | 'BED'
  | 'DISCHARGE'
  | 'TRANSFER'
  | 'INTERNAL_MOVEMENT'
  | 'CMA'
  | 'CONFLICT'
  | 'VIEW_ACTIVITY'
  | 'SYSTEM'
  | 'DOCUMENTS'
  | 'DIAGNOSIS'
  | 'STATUS'
  | 'MEDICATIONS'
  | 'SYNC_ACCEPTED'
  | 'SYNC_MERGED'
  | 'SYNC_BLOCKED'
  | 'SYNC_ALREADY_APPLIED'
  | 'SYNC_QUEUED'
  | 'SYNC_REPLAYED';

export type ClinicalAuditPatientPackageIntentId =
  | 'CLINICAL_OPERATIONS'
  | 'VIEW_ACTIVITY'
  | 'SYSTEM_SYNC';

export const DEFAULT_PATIENT_PACKAGE_INTENT: ClinicalAuditPatientPackageIntentId =
  'CLINICAL_OPERATIONS';

export interface ClinicalAuditPatientPackageFilterOption {
  id: ClinicalAuditPatientPackageFilterId;
  label: string;
  count: number;
}

export interface ClinicalAuditPatientPackageIntentOption {
  id: ClinicalAuditPatientPackageIntentId;
  label: string;
  count: number;
}

export interface ClinicalAuditPatientPackageFilterParams {
  searchTerm?: string;
  activeFilter?: ClinicalAuditPatientPackageFilterId;
  activeIntent?: ClinicalAuditPatientPackageIntentId;
}

export interface IndexedClinicalAuditPatientPackage {
  auditPackage: ClinicalAuditPatientPackage;
  searchIndex: string;
}

const FILTER_LABELS: Record<ClinicalAuditPatientPackageFilterId, string> = {
  ALL: 'Todos',
  CENSUS: 'Censo',
  PATIENT: 'Paciente',
  BED: 'Cama',
  DISCHARGE: 'Altas',
  TRANSFER: 'Traslados',
  INTERNAL_MOVEMENT: 'Mov. internos',
  CMA: 'CMA',
  CONFLICT: 'Conflictos',
  VIEW_ACTIVITY: 'Visualizaciones',
  SYSTEM: 'Sistema',
  DOCUMENTS: 'Documentos',
  DIAGNOSIS: 'Diagnóstico',
  STATUS: 'Estado',
  MEDICATIONS: 'Indicaciones',
  SYNC_ACCEPTED: 'Aceptadas',
  SYNC_MERGED: 'Merge automático',
  SYNC_BLOCKED: 'Bloqueadas',
  SYNC_ALREADY_APPLIED: 'Ya aplicadas',
  SYNC_QUEUED: 'En cola',
  SYNC_REPLAYED: 'Replay',
};

const INTENT_LABELS: Record<ClinicalAuditPatientPackageIntentId, string> = {
  CLINICAL_OPERATIONS: 'Cambios clínicos/operacionales',
  VIEW_ACTIVITY: 'Visualizaciones',
  SYSTEM_SYNC: 'Sistema/sincronización',
};

const FILTER_ORDER: ClinicalAuditPatientPackageFilterId[] = [
  'ALL',
  'CENSUS',
  'PATIENT',
  'BED',
  'DISCHARGE',
  'TRANSFER',
  'INTERNAL_MOVEMENT',
  'CMA',
  'DOCUMENTS',
  'DIAGNOSIS',
  'STATUS',
  'CONFLICT',
  'SYNC_BLOCKED',
  'SYNC_MERGED',
  'SYNC_ALREADY_APPLIED',
  'SYNC_QUEUED',
  'SYNC_REPLAYED',
  'SYNC_ACCEPTED',
  'VIEW_ACTIVITY',
  'SYSTEM',
  'MEDICATIONS',
];

const INTENT_ORDER: ClinicalAuditPatientPackageIntentId[] = [
  'CLINICAL_OPERATIONS',
  'VIEW_ACTIVITY',
  'SYSTEM_SYNC',
];

const SYSTEM_SYNC_ACTIONS = new Set<AuditAction>([
  'CONFLICT_AUTO_MERGED',
  'CONFLICT_VERSION_RESTORED',
  'DAILY_RECORD_CREATED',
  'DAILY_RECORD_DELETED',
  'PREVIOUS_DAY_EDIT_CONFIRMED',
  'DATA_IMPORTED',
  'DATA_EXPORTED',
  'PATIENT_HARMONIZED',
  'DATA_ADMISSION_DATES_BACKFILLED',
  'SYSTEM_ERROR',
]);

export const normalizeClinicalAuditPatientPackageSearch = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const packageHasAnyAction = (
  auditPackage: ClinicalAuditPatientPackage,
  actions: Set<AuditAction>
): boolean => auditPackage.actions.some(action => actions.has(action));

const packageHasOnlyActions = (
  auditPackage: ClinicalAuditPatientPackage,
  actions: Set<AuditAction>
): boolean =>
  auditPackage.actions.length > 0 && auditPackage.actions.every(action => actions.has(action));

const packageHasOperationalImpact = (auditPackage: ClinicalAuditPatientPackage): boolean =>
  auditPackage.flags.admission ||
  auditPackage.flags.discharge ||
  auditPackage.flags.transfer ||
  auditPackage.flags.internalMovement ||
  auditPackage.flags.cma ||
  auditPackage.flags.diagnosis ||
  auditPackage.flags.status ||
  packageHasAnyAction(auditPackage, DOCUMENT_AUDIT_ACTIONS) ||
  packageHasAnyAction(auditPackage, MEDICATION_AUDIT_ACTIONS);

const packageHasOnlyConflictSyncEvidence = (auditPackage: ClinicalAuditPatientPackage): boolean =>
  auditPackage.flags.conflict &&
  !packageHasOperationalImpact(auditPackage) &&
  auditPackage.actions.length > 0 &&
  auditPackage.actions.every(
    action => SYSTEM_SYNC_ACTIONS.has(action) || action.includes('CONFLICT')
  );

export const resolveClinicalAuditPatientPackageIntent = (
  auditPackage: ClinicalAuditPatientPackage
): ClinicalAuditPatientPackageIntentId => {
  if (packageHasOnlyActions(auditPackage, VIEW_AUDIT_ACTIONS)) return 'VIEW_ACTIVITY';
  if (packageHasOnlyActions(auditPackage, SYSTEM_SYNC_ACTIONS)) {
    return 'SYSTEM_SYNC';
  }
  if (packageHasOnlyConflictSyncEvidence(auditPackage)) {
    return 'SYSTEM_SYNC';
  }
  return DEFAULT_PATIENT_PACKAGE_INTENT;
};

export const getClinicalAuditPatientPackageCategories = (
  auditPackage: ClinicalAuditPatientPackage
): ClinicalAuditPatientPackageFilterId[] => {
  const categories: ClinicalAuditPatientPackageFilterId[] = ['ALL'];

  const push = (category: ClinicalAuditPatientPackageFilterId) => {
    if (!categories.includes(category)) categories.push(category);
  };

  if (auditPackage.recordDate) push('CENSUS');
  if (auditPackage.patientName || auditPackage.patientRut || auditPackage.patientIdentifier) {
    push('PATIENT');
  }
  if (auditPackage.primaryBedLabel) push('BED');
  if (auditPackage.flags.discharge) push('DISCHARGE');
  if (auditPackage.flags.transfer) push('TRANSFER');
  if (auditPackage.flags.internalMovement) push('INTERNAL_MOVEMENT');
  if (auditPackage.flags.cma) push('CMA');
  if (packageHasAnyAction(auditPackage, DOCUMENT_AUDIT_ACTIONS)) push('DOCUMENTS');
  if (auditPackage.flags.diagnosis) push('DIAGNOSIS');
  if (auditPackage.flags.status) push('STATUS');
  if (auditPackage.flags.conflict) push('CONFLICT');
  if (packageHasAnyAction(auditPackage, VIEW_AUDIT_ACTIONS)) push('VIEW_ACTIVITY');
  const syncStates = getClinicalAuditTimelineV2StatesForPackage(auditPackage);
  if (syncStates.includes('accepted')) push('SYNC_ACCEPTED');
  if (syncStates.includes('merged')) push('SYNC_MERGED');
  if (syncStates.includes('blocked')) push('SYNC_BLOCKED');
  if (syncStates.includes('already_applied')) push('SYNC_ALREADY_APPLIED');
  if (syncStates.includes('queued')) push('SYNC_QUEUED');
  if (syncStates.includes('replayed')) push('SYNC_REPLAYED');
  if (
    resolveClinicalAuditPatientPackageIntent(auditPackage) === 'SYSTEM_SYNC' ||
    packageHasAnyAction(auditPackage, SYSTEM_SYNC_ACTIONS)
  ) {
    push('SYSTEM');
  }
  if (packageHasAnyAction(auditPackage, MEDICATION_AUDIT_ACTIONS)) push('MEDICATIONS');

  return categories;
};

export const matchesClinicalAuditPatientPackageFilter = (
  auditPackage: ClinicalAuditPatientPackage,
  activeFilter: ClinicalAuditPatientPackageFilterId
): boolean => {
  return getClinicalAuditPatientPackageCategories(auditPackage).includes(activeFilter);
};

export const matchesClinicalAuditPatientPackageIntent = (
  auditPackage: ClinicalAuditPatientPackage,
  activeIntent: ClinicalAuditPatientPackageIntentId
): boolean => resolveClinicalAuditPatientPackageIntent(auditPackage) === activeIntent;

export const buildClinicalAuditPatientPackageSearchIndex = (
  auditPackage: ClinicalAuditPatientPackage
): string => {
  const actionLabels = auditPackage.actions.map(action => AUDIT_ACTION_LABELS[action] || action);
  const actorText = auditPackage.actors.flatMap(actor => [
    actor.label,
    actor.secondary,
    actor.userId,
    actor.uid,
  ]);

  return [
    auditPackage.patientName,
    auditPackage.patientRut,
    auditPackage.patientIdentifier,
    auditPackage.primaryBedLabel,
    auditPackage.recordDate,
    auditPackage.summary,
    getClinicalAuditTimelineV2SummaryForPackage(auditPackage),
    ...auditPackage.modules,
    ...actionLabels,
    ...actorText,
    ...auditPackage.ipAddresses,
    ...auditPackage.changes.flatMap(change => [
      change.fieldLabel,
      String(change.oldValue ?? ''),
      String(change.newValue ?? ''),
    ]),
    ...auditPackage.rawLogs.flatMap(log => {
      const details = log.details || {};
      return [
        String(details.mutationId ?? ''),
        String(details.clientId ?? ''),
        String(details.tabId ?? ''),
        ...(Array.isArray(details.changedPaths) ? details.changedPaths.map(String) : []),
      ];
    }),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(normalizeClinicalAuditPatientPackageSearch)
    .join(' ');
};

export const buildIndexedClinicalAuditPatientPackages = (
  patientPackages: ClinicalAuditPatientPackage[],
  buildSearchIndex = buildClinicalAuditPatientPackageSearchIndex
): IndexedClinicalAuditPatientPackage[] =>
  patientPackages.map(auditPackage => ({
    auditPackage,
    searchIndex: buildSearchIndex(auditPackage),
  }));

export const filterIndexedClinicalAuditPatientPackages = (
  indexedPackages: IndexedClinicalAuditPatientPackage[],
  params: ClinicalAuditPatientPackageFilterParams
): ClinicalAuditPatientPackage[] => {
  const search = normalizeClinicalAuditPatientPackageSearch(params.searchTerm || '');
  const activeFilter = params.activeFilter || 'ALL';
  const activeIntent = params.activeIntent;

  return indexedPackages
    .filter(({ auditPackage, searchIndex }) => {
      const matchesSearch = !search || searchIndex.includes(search);
      const matchesActiveIntent =
        !activeIntent || matchesClinicalAuditPatientPackageIntent(auditPackage, activeIntent);
      return (
        matchesSearch &&
        matchesActiveIntent &&
        matchesClinicalAuditPatientPackageFilter(auditPackage, activeFilter)
      );
    })
    .map(({ auditPackage }) => auditPackage);
};

export const filterClinicalAuditPatientPackages = (
  patientPackages: ClinicalAuditPatientPackage[],
  params: ClinicalAuditPatientPackageFilterParams
): ClinicalAuditPatientPackage[] =>
  filterIndexedClinicalAuditPatientPackages(
    buildIndexedClinicalAuditPatientPackages(patientPackages),
    params
  );

export const buildClinicalAuditPatientPackageFilterOptions = (
  patientPackages: ClinicalAuditPatientPackage[]
): ClinicalAuditPatientPackageFilterOption[] =>
  FILTER_ORDER.map(id => ({
    id,
    label: FILTER_LABELS[id],
    count: patientPackages.filter(auditPackage =>
      matchesClinicalAuditPatientPackageFilter(auditPackage, id)
    ).length,
  }));

export const buildClinicalAuditPatientPackageIntentOptions = (
  patientPackages: ClinicalAuditPatientPackage[]
): ClinicalAuditPatientPackageIntentOption[] =>
  INTENT_ORDER.map(id => ({
    id,
    label: INTENT_LABELS[id],
    count: patientPackages.filter(auditPackage =>
      matchesClinicalAuditPatientPackageIntent(auditPackage, id)
    ).length,
  }));
