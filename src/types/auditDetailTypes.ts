export type AuditValue = string | number | boolean | null | undefined | string[];

export interface AuditDetailsPatient {
  patientName?: string;
  rut?: string;
  bedId?: string;
  pathology?: string;
  diagnosis?: string;
}

export interface AuditDetailsChange {
  field?: string;
  value?: AuditValue;
  oldValue?: AuditValue;
  newValue?: AuditValue;
  changes?: Record<string, { old: AuditValue; new: AuditValue }>;
}

export interface AuditDetailsHandoff {
  shift?: 'day' | 'night' | string;
  doctorName?: string;
  authorName?: string;
}

export interface AuditDetailsBed {
  bedId?: string;
  reason?: string;
  active?: boolean;
}

export interface AuditDeviceChange {
  old: string | null | { installationDate?: string; notes?: string } | 'N/A';
  new: string | null | { installationDate?: string; notes?: string } | 'Eliminado';
}

export type AuditDeviceChangesMap = Record<string, AuditDeviceChange>;

export type AuditDetails = AuditDetailsPatient &
  AuditDetailsChange &
  AuditDetailsHandoff &
  AuditDetailsBed &
  Record<string, unknown>;
