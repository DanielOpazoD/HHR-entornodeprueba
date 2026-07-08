import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { ClinicalAuditPatientPackage } from '@/services/admin/clinicalAuditPatientPackages';

export type ClinicalAuditTimelineV2SyncState =
  | 'accepted'
  | 'merged'
  | 'blocked'
  | 'already_applied'
  | 'queued'
  | 'replayed'
  | 'unknown';

export interface ClinicalAuditTimelineV2Change {
  fieldLabel: string;
  oldValue: unknown;
  newValue: unknown;
  oldValuePreview: string;
  newValuePreview: string;
  sourceLogId: string;
  changedPath?: string;
}

export interface ClinicalAuditTimelineV2Event {
  id: string;
  timestamp: string;
  action: AuditLogEntry['action'];
  title: string;
  module: string;
  actorLabel: string;
  originLabel: string;
  mutationState: ClinicalAuditTimelineV2SyncState;
  mutationStateLabel: string;
  mutationId?: string;
  clientId?: string;
  tabId?: string;
  changedPaths: string[];
  changes: ClinicalAuditTimelineV2Change[];
  isViewEvent: boolean;
  isTechnicalEvent: boolean;
}

export interface ClinicalAuditTimelineV2Group {
  id: string;
  groupKey: string;
  patientName: string;
  patientRut?: string;
  patientIdentifier?: string;
  episodeId?: string;
  primaryBedLabel?: string;
  recordDate: string;
  startedAt: string;
  endedAt: string;
  responsibleSummary: string;
  originSummary: string;
  modules: string[];
  actions: AuditLogEntry['action'][];
  syncStates: ClinicalAuditTimelineV2SyncState[];
  syncStateSummary: string;
  eventCount: number;
  clinicalMutationCount: number;
  viewEventCount: number;
  visibleChanges: ClinicalAuditTimelineV2Change[];
  events: ClinicalAuditTimelineV2Event[];
  rawPackage: ClinicalAuditPatientPackage;
}

export interface ClinicalAuditTimelineV2Option {
  id: ClinicalAuditTimelineV2SyncState;
  label: string;
  count: number;
}

export interface ClinicalAuditTimelineV2Result {
  groups: ClinicalAuditTimelineV2Group[];
  syncStateOptions: ClinicalAuditTimelineV2Option[];
}

export interface ClinicalAuditTimelineV2FilterParams {
  searchTerm?: string;
  module?: string;
  syncState?: ClinicalAuditTimelineV2SyncState | 'ALL';
}
