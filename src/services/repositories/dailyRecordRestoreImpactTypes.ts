export type DailyRecordRestoreImpactRisk = 'low' | 'medium' | 'high';
export type DailyRecordRestoreImpactStatus = 'safe' | 'review_required' | 'blocked';
export type DailyRecordRestoreImpactModule =
  | 'census'
  | 'movements'
  | 'nursing_handoff'
  | 'medical_handoff';

export type DailyRecordRestoreImpactKind =
  | 'movement_loss'
  | 'movement_tombstone_revived'
  | 'active_bed_rollback'
  | 'duplicate_active_patient'
  | 'nursing_handoff_loss'
  | 'medical_handoff_loss';

export interface DailyRecordRestoreImpact {
  kind: DailyRecordRestoreImpactKind;
  module: DailyRecordRestoreImpactModule;
  severity: 'warning' | 'blocking';
  path: string;
  message: string;
  patientName?: string;
  rut?: string;
  bedId?: string;
}

export interface DailyRecordRestoreImpactAnalysis {
  date: string;
  status: DailyRecordRestoreImpactStatus;
  risk: DailyRecordRestoreImpactRisk;
  impacts: DailyRecordRestoreImpact[];
  impactedModules: DailyRecordRestoreImpactModule[];
  blockingImpactCount: number;
  currentRevision?: string;
  selectedRevision?: string;
}
