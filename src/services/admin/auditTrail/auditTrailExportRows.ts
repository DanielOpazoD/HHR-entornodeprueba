import type { AuditTrailEvent, AuditTrailSession } from '@/types/auditTrailTypes';
import {
  AUDIT_TRAIL_AREA_LABELS,
  AUDIT_TRAIL_CATEGORY_LABELS,
  AUDIT_TRAIL_STATUS_LABELS,
} from '@/services/admin/auditTrail/auditTrailCatalog';
import {
  AUDIT_TRAIL_SESSION_END_LABELS,
  resolveAuditTrailSessionDurationMs,
} from '@/services/admin/auditTrail/auditTrailSessions';
import { formatAuditTrailDuration } from '@/services/admin/auditTrail/auditTrailValues';
import { formatClinicalClock, formatClinicalDayMonthYear } from '@/utils/clinicalTimeFormat';

export const AUDIT_TRAIL_EVENT_EXPORT_HEADERS = [
  'Fecha',
  'Hora',
  'Funcionario',
  'Correo',
  'Responsables',
  'Paciente',
  'Documento',
  'Cama',
  'Tipo',
  'Área',
  'Acción',
  'Detalle',
  'Campo',
  'Antes',
  'Después',
  'Estado',
  'Dispositivo',
  'IP',
  'ID',
];

/** One row per change, so before/after stay in their own columns. */
export const buildAuditTrailEventExportRows = (events: AuditTrailEvent[]): string[][] =>
  events.flatMap(event => {
    const base = [
      formatClinicalDayMonthYear(event.at),
      formatClinicalClock(event.at, true),
      event.actor.name,
      event.actor.email ?? '',
      event.authors ?? '',
      event.patient?.name ?? '',
      event.patient?.document ?? '',
      event.patient?.bedId ?? '',
      AUDIT_TRAIL_CATEGORY_LABELS[event.category],
      AUDIT_TRAIL_AREA_LABELS[event.area],
      event.label,
      event.detail ?? '',
    ];
    const tail = [
      AUDIT_TRAIL_STATUS_LABELS[event.status],
      event.device ?? '',
      event.ipAddress ?? '',
      event.id,
    ];
    if (event.changes.length === 0) return [[...base, '', '', '', ...tail]];
    return event.changes.map(change => [
      ...base,
      change.field,
      change.before ?? '',
      change.after ?? '',
      ...tail,
    ]);
  });

export const AUDIT_TRAIL_SESSION_EXPORT_HEADERS = [
  'Funcionario',
  'Correo',
  'Fecha',
  'Conexión',
  'Desconexión',
  'Duración',
  'Cierre',
  'Cortes de red',
  'Eventos',
  'Dispositivo',
  'IP',
];

export const buildAuditTrailSessionExportRows = (sessions: AuditTrailSession[]): string[][] =>
  sessions.map(session => [
    session.actor.name,
    session.actor.email ?? '',
    formatClinicalDayMonthYear(session.startedAt),
    formatClinicalClock(session.startedAt),
    session.endedAt ? formatClinicalClock(session.endedAt) : '',
    formatAuditTrailDuration(resolveAuditTrailSessionDurationMs(session)),
    AUDIT_TRAIL_SESSION_END_LABELS[session.end],
    String(session.interruptions.length),
    String(session.events.length),
    session.device ?? '',
    session.ipAddress ?? '',
  ]);
