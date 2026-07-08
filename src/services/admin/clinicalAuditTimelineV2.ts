import type { AuditLogEntry } from '@/types/auditLogTypes';
import {
  buildClinicalAuditPatientPackages,
  type ClinicalAuditPackageChange,
  type ClinicalAuditPatientPackage,
} from '@/services/admin/clinicalAuditPatientPackages';
import {
  asAuditText,
  getAuditLogDetails,
  parseAuditTimestampMs,
} from '@/services/admin/clinicalAuditPatientPackageKey';
import { VIEW_AUDIT_ACTIONS } from '@/services/admin/clinicalAuditPatientPackageActionGroups';
import {
  CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_LABELS,
  CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_OPTION_LABELS,
  CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_ORDER,
  formatClinicalAuditTimelineV2ValuePreview,
  getClinicalAuditTimelineV2ChangedPaths,
  normalizeClinicalAuditTimelineV2FieldLabel,
  normalizeClinicalAuditTimelineV2Token,
  summarizeClinicalAuditTimelineV2SyncStates,
} from '@/services/admin/clinicalAuditTimelineV2Formatters';
import type {
  ClinicalAuditTimelineV2Change,
  ClinicalAuditTimelineV2FilterParams,
  ClinicalAuditTimelineV2Group,
  ClinicalAuditTimelineV2Option,
  ClinicalAuditTimelineV2Result,
  ClinicalAuditTimelineV2SyncState,
} from '@/services/admin/clinicalAuditTimelineV2Types';
export type {
  ClinicalAuditTimelineV2Change,
  ClinicalAuditTimelineV2Event,
  ClinicalAuditTimelineV2FilterParams,
  ClinicalAuditTimelineV2Group,
  ClinicalAuditTimelineV2Option,
  ClinicalAuditTimelineV2Result,
  ClinicalAuditTimelineV2SyncState,
} from '@/services/admin/clinicalAuditTimelineV2Types';

const pushUnique = <T>(target: T[], value: T): void => {
  if (!target.includes(value)) target.push(value);
};

const getFirstString = (details: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = asAuditText(details[key]);
    if (value) return value;
  }
  return undefined;
};

export const resolveClinicalAuditTimelineV2SyncState = (
  log: AuditLogEntry
): ClinicalAuditTimelineV2SyncState => {
  const details = getAuditLogDetails(log);
  const candidates = [details.syncStatus, details.resolution, details.queueStatus];

  for (const candidate of candidates) {
    const token = normalizeClinicalAuditTimelineV2Token(candidate);
    if (!token) continue;
    if (['accepted', 'success', 'applied', 'committed'].includes(token)) return 'accepted';
    if (['auto_merged', 'merged', 'auto_merge', 'conflict_auto_merged'].includes(token)) {
      return 'merged';
    }
    if (['blocked', 'needs_review', 'not_possible', 'rejected'].includes(token)) return 'blocked';
    if (['already_applied', 'duplicate', 'idempotent'].includes(token)) return 'already_applied';
    if (['queued', 'pending', 'outbox_pending'].includes(token)) return 'queued';
    if (['replayed', 'replay', 'outbox_replayed'].includes(token)) return 'replayed';
  }

  if (log.action === 'CONFLICT_AUTO_MERGED') return 'merged';
  if (log.action.includes('VIEW')) return 'unknown';
  return 'accepted';
};

export const getClinicalAuditTimelineV2SyncStateLabel = (
  state: ClinicalAuditTimelineV2SyncState
): string => CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_LABELS[state];

const getLogActorLabel = (log: AuditLogEntry): string =>
  asAuditText(log.userDisplayName) ||
  asAuditText(log.userId) ||
  asAuditText(log.userUid) ||
  'Usuario no identificado';

const getLogOriginLabel = (log: AuditLogEntry): string => {
  const ipAddress = asAuditText(log.ipAddress);
  return ipAddress ? `IP ${ipAddress}` : 'IP no disponible';
};

const isTechnicalAction = (log: AuditLogEntry): boolean =>
  log.action.includes('CONFLICT') || log.action.includes('SYSTEM') || log.action.includes('DATA_');

const getEventModule = (
  log: AuditLogEntry,
  eventChanges: ClinicalAuditTimelineV2Change[]
): string => {
  if (eventChanges.some(change => change.fieldLabel.includes('Entrega enfermería'))) {
    return 'Entrega enfermería';
  }
  if (eventChanges.some(change => change.fieldLabel.includes('Entrega médica'))) {
    return 'Entrega médica';
  }
  if (eventChanges.some(change => change.fieldLabel === 'Dispositivos invasivos')) {
    return 'Dispositivos invasivos';
  }
  if (log.action.includes('HANDOFF')) return 'Entrega';
  if (log.action.includes('CONFLICT')) return 'Sincronización';
  if (log.action.includes('DISCHARGED')) return 'Alta';
  if (log.action.includes('TRANSFERRED')) return 'Traslado';
  if (log.action.includes('BED_CHANGED')) return 'Movimiento interno';
  if (log.action.includes('VIEW')) return 'Visualización';
  return eventChanges[0]?.fieldLabel || 'Censo';
};

const getEventTitle = (
  log: AuditLogEntry,
  module: string,
  state: ClinicalAuditTimelineV2SyncState
): string => {
  if (state === 'blocked') return `${module} bloqueado`;
  if (state === 'already_applied') return `${module} ya aplicado`;
  if (state === 'merged') return `${module} con merge automático`;
  if (log.action.includes('VIEW')) return `${module} consultado`;
  return `${module} actualizado`;
};

const buildEventChanges = (
  log: AuditLogEntry,
  packageChanges: ClinicalAuditPackageChange[]
): ClinicalAuditTimelineV2Change[] => {
  const changedPaths = getClinicalAuditTimelineV2ChangedPaths(log);
  const changesForLog = packageChanges.filter(change => change.sourceLogId === log.id);

  return changesForLog.map((change, index) => {
    const fieldLabel = normalizeClinicalAuditTimelineV2FieldLabel(change.fieldLabel);
    const changedPath =
      changedPaths.find(path => normalizeClinicalAuditTimelineV2FieldLabel(path) === fieldLabel) ||
      changedPaths[index];

    return {
      fieldLabel,
      oldValue: change.oldValue,
      newValue: change.newValue,
      oldValuePreview: formatClinicalAuditTimelineV2ValuePreview(change.oldValue),
      newValuePreview: formatClinicalAuditTimelineV2ValuePreview(change.newValue),
      sourceLogId: change.sourceLogId,
      changedPath,
    };
  });
};

const getEpisodeId = (auditPackage: ClinicalAuditPatientPackage): string | undefined => {
  for (const log of auditPackage.rawLogs) {
    const details = getAuditLogDetails(log);
    const episodeId = getFirstString(details, [
      'clinicalEpisodeId',
      'episodeId',
      'episodeKey',
      'hospitalizationEpisodeId',
    ]);
    if (episodeId) return episodeId;
  }
  return undefined;
};

const getPrimaryBedLabelForTimeline = (
  auditPackage: ClinicalAuditPatientPackage
): string | undefined => {
  if (auditPackage.primaryBedLabel?.includes(' -> ')) return auditPackage.primaryBedLabel;

  for (const log of auditPackage.rawLogs) {
    const bedId = asAuditText(getAuditLogDetails(log).bedId);
    if (bedId) return bedId;
  }

  return auditPackage.primaryBedLabel;
};

const summarizeActors = (auditPackage: ClinicalAuditPatientPackage): string => {
  const actors = auditPackage.actors.map(actor => actor.label).filter(Boolean);
  if (actors.length === 0) return 'Usuario no identificado';
  if (actors.length === 1) return actors[0];
  return `${actors[0]} + ${actors.length - 1}`;
};

const summarizeOrigins = (auditPackage: ClinicalAuditPatientPackage): string => {
  if (auditPackage.ipAddresses.length === 0) return 'IP no disponible';
  if (auditPackage.ipAddresses.length === 1) return `IP ${auditPackage.ipAddresses[0]}`;
  return `${auditPackage.ipAddresses.length} IPs`;
};

const dedupeChanges = (
  changes: ClinicalAuditTimelineV2Change[]
): ClinicalAuditTimelineV2Change[] => {
  const seen = new Set<string>();
  return changes.filter(change => {
    const key = [
      change.fieldLabel,
      change.oldValuePreview,
      change.newValuePreview,
      change.sourceLogId,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildTimelineGroupFromPackage = (
  auditPackage: ClinicalAuditPatientPackage
): ClinicalAuditTimelineV2Group => {
  const events = auditPackage.rawLogs.map(log => {
    const details = getAuditLogDetails(log);
    const changes = buildEventChanges(log, auditPackage.changes);
    const module = getEventModule(log, changes);
    const mutationState = resolveClinicalAuditTimelineV2SyncState(log);

    return {
      id: log.id,
      timestamp: log.timestamp,
      action: log.action,
      title: getEventTitle(log, module, mutationState),
      module,
      actorLabel: getLogActorLabel(log),
      originLabel: getLogOriginLabel(log),
      mutationState,
      mutationStateLabel: CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_LABELS[mutationState],
      mutationId: asAuditText(details.mutationId) || undefined,
      clientId: asAuditText(details.clientId) || undefined,
      tabId: asAuditText(details.tabId) || undefined,
      changedPaths: getClinicalAuditTimelineV2ChangedPaths(log),
      changes,
      isViewEvent: VIEW_AUDIT_ACTIONS.has(log.action),
      isTechnicalEvent: isTechnicalAction(log),
    };
  });

  const syncStates: ClinicalAuditTimelineV2SyncState[] = [];
  events.forEach(event => pushUnique(syncStates, event.mutationState));

  const modules: string[] = [];
  events.forEach(event => pushUnique(modules, event.module));

  const visibleChanges = dedupeChanges(events.flatMap(event => event.changes));
  const chronologicalVisibleChanges = dedupeChanges(
    [...events]
      .sort((a, b) => parseAuditTimestampMs(a.timestamp) - parseAuditTimestampMs(b.timestamp))
      .flatMap(event => event.changes)
  );
  const viewEventCount = events.filter(event => event.isViewEvent).length;

  return {
    id: `clinical-timeline-v2-${auditPackage.id}`,
    groupKey: auditPackage.packageKey,
    patientName: auditPackage.patientName,
    patientRut: auditPackage.patientRut,
    patientIdentifier: auditPackage.patientIdentifier,
    episodeId: getEpisodeId(auditPackage),
    primaryBedLabel: getPrimaryBedLabelForTimeline(auditPackage),
    recordDate: auditPackage.recordDate,
    startedAt: auditPackage.startedAt,
    endedAt: auditPackage.endedAt,
    responsibleSummary: summarizeActors(auditPackage),
    originSummary: summarizeOrigins(auditPackage),
    modules,
    actions: auditPackage.actions,
    syncStates,
    syncStateSummary: summarizeClinicalAuditTimelineV2SyncStates(syncStates),
    eventCount: auditPackage.eventCount,
    clinicalMutationCount: events.length - viewEventCount,
    viewEventCount,
    visibleChanges:
      chronologicalVisibleChanges.length > 0 ? chronologicalVisibleChanges : visibleChanges,
    events,
    rawPackage: auditPackage,
  };
};

export const buildClinicalAuditTimelineV2GroupFromPackage = (
  auditPackage: ClinicalAuditPatientPackage
): ClinicalAuditTimelineV2Group => buildTimelineGroupFromPackage(auditPackage);

export const getClinicalAuditTimelineV2StatesForPackage = (
  auditPackage: ClinicalAuditPatientPackage
): ClinicalAuditTimelineV2SyncState[] => {
  const states: ClinicalAuditTimelineV2SyncState[] = [];
  auditPackage.rawLogs.forEach(log =>
    pushUnique(states, resolveClinicalAuditTimelineV2SyncState(log))
  );
  return states;
};

export const getClinicalAuditTimelineV2SummaryForPackage = (
  auditPackage: ClinicalAuditPatientPackage
): string =>
  summarizeClinicalAuditTimelineV2SyncStates(
    getClinicalAuditTimelineV2StatesForPackage(auditPackage)
  );

const buildSyncStateOptions = (
  groups: ClinicalAuditTimelineV2Group[]
): ClinicalAuditTimelineV2Option[] =>
  CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_ORDER.map(state => ({
    id: state,
    label: CLINICAL_AUDIT_TIMELINE_V2_SYNC_STATE_OPTION_LABELS[state],
    count: groups.filter(group => group.syncStates.includes(state)).length,
  })).filter(option => option.count > 0);

export const buildClinicalAuditTimelineV2FromPackages = (
  packages: ClinicalAuditPatientPackage[]
): ClinicalAuditTimelineV2Result => {
  const groups = packages
    .map(buildTimelineGroupFromPackage)
    .sort((a, b) => parseAuditTimestampMs(b.endedAt) - parseAuditTimestampMs(a.endedAt));

  return {
    groups,
    syncStateOptions: buildSyncStateOptions(groups),
  };
};

export const buildClinicalAuditTimelineV2 = (
  logs: AuditLogEntry[]
): ClinicalAuditTimelineV2Result =>
  buildClinicalAuditTimelineV2FromPackages(buildClinicalAuditPatientPackages(logs));

const groupMatchesSearch = (
  group: ClinicalAuditTimelineV2Group,
  normalizedSearchTerm: string
): boolean => {
  if (!normalizedSearchTerm) return true;
  const haystack = [
    group.patientName,
    group.patientRut,
    group.patientIdentifier,
    group.episodeId,
    group.primaryBedLabel,
    group.recordDate,
    group.responsibleSummary,
    group.originSummary,
    group.syncStateSummary,
    ...group.modules,
    ...group.visibleChanges.flatMap(change => [
      change.fieldLabel,
      change.oldValuePreview,
      change.newValuePreview,
      change.changedPath,
    ]),
    ...group.events.flatMap(event => [
      event.mutationId,
      event.clientId,
      event.tabId,
      ...event.changedPaths,
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(normalizedSearchTerm);
};

export const filterClinicalAuditTimelineV2Groups = (
  groups: ClinicalAuditTimelineV2Group[],
  params: ClinicalAuditTimelineV2FilterParams
): ClinicalAuditTimelineV2Group[] => {
  const normalizedSearchTerm = (params.searchTerm || '').trim().toLowerCase();
  const syncState = params.syncState && params.syncState !== 'ALL' ? params.syncState : undefined;
  const module = (params.module || '').trim();

  return groups.filter(group => {
    if (syncState && !group.syncStates.includes(syncState)) return false;
    if (module && !group.modules.includes(module)) return false;
    return groupMatchesSearch(group, normalizedSearchTerm);
  });
};
