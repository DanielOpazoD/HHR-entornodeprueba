import type { AuditAction } from './auditActionTypes';
import type { AuditLogEntry } from './auditLogTypes';

/** What an audit event records: a clinical change, an access, a connection or a system step. */
export type AuditTrailCategory = 'change' | 'access' | 'connection' | 'system';

/** Grouped outcome: recorded normally, reconciled automatically, or worth a person's review. */
export type AuditTrailStatus = 'ok' | 'auto' | 'review';

export type AuditTrailArea =
  | 'census'
  | 'nursingHandoff'
  | 'medicalHandoff'
  | 'cudyr'
  | 'documents'
  | 'indications'
  | 'prescriptions'
  | 'woundCare'
  | 'session'
  | 'system';

export interface AuditTrailChange {
  field: string;
  before?: string;
  after?: string;
}

export interface AuditTrailPatient {
  /** Grouping identity: the name; a different full document splits people who share it. */
  key: string;
  name: string;
  document?: string;
  episodeId?: string;
  bedId?: string;
}

export interface AuditTrailActor {
  key: string;
  name: string;
  email?: string;
  uid?: string;
}

export interface AuditTrailEvent {
  id: string;
  /** Epoch milliseconds. */
  at: number;
  category: AuditTrailCategory;
  status: AuditTrailStatus;
  area: AuditTrailArea;
  action: AuditAction;
  /** Short statement of what happened ("Diagnóstico", "Ingreso", "Vio ficha"). */
  label: string;
  /** Short qualifier shown next to the label ("H3C2", "Domicilio", "Turno noche"). */
  detail?: string;
  changes: AuditTrailChange[];
  /** Short explanations that are not a before/after (why a conflict merge kept a value). */
  notes?: string[];
  patient?: AuditTrailPatient;
  actor: AuditTrailActor;
  /** People on shift behind a shared institutional account ("responsables documentados"). */
  authors?: string;
  /** Census day the event refers to (`YYYY-MM-DD`). */
  censusDate?: string;
  sessionId?: string;
  device?: string;
  ipAddress?: string;
  /** Stored document behind the statement, for the technical detail. */
  source: AuditLogEntry;
}

/** `open`: recent activity and no end yet; `unknown`: no end recorded and no recent activity. */
export type AuditTrailSessionEnd = 'manual' | 'automatic' | 'closed' | 'open' | 'unknown';

export interface AuditTrailInterruption {
  from: number;
  to: number;
}

export interface AuditTrailSession {
  id: string;
  actor: AuditTrailActor;
  device?: string;
  ipAddress?: string;
  startedAt: number;
  /** Known end; undefined while the session is open or its end was never recorded. */
  endedAt?: number;
  /** Last recorded event of the session. */
  lastSeenAt: number;
  end: AuditTrailSessionEnd;
  interruptions: AuditTrailInterruption[];
  events: AuditTrailEvent[];
}

export type AuditTrailGrouping = 'patient' | 'actor' | 'session' | 'time';

export interface AuditTrailCounts {
  change: number;
  access: number;
  connection: number;
  system: number;
  review: number;
}

export interface AuditTrailGroup {
  key: string;
  grouping: AuditTrailGrouping;
  title: string;
  subtitle?: string;
  from: number;
  to: number;
  /** Newest first. */
  events: AuditTrailEvent[];
  counts: AuditTrailCounts;
  patientCount: number;
  actorCount: number;
  session?: AuditTrailSession;
}

/** A display line: one event, or consecutive accesses of the same kind collapsed into one. */
export interface AuditTrailLine {
  key: string;
  events: AuditTrailEvent[];
  from: number;
  to: number;
}
