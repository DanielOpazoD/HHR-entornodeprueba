import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import { buildKnownClinicalAuditNarrative } from '@/services/admin/clinicalAuditNarratives';

export type ClinicalAuditImpact =
  | 'registro'
  | 'visualizacion'
  | 'modificacion'
  | 'eliminacion'
  | 'exportacion'
  | 'sistema'
  | 'sesion';

export type ClinicalAuditArea =
  | 'censo'
  | 'entrega'
  | 'documentos'
  | 'indicaciones'
  | 'recetas'
  | 'cudyr'
  | 'heridas'
  | 'sesion'
  | 'mantenimiento'
  | 'sistema';

export interface ClinicalAuditChange {
  fieldLabel: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ClinicalAuditPresentation {
  title: string;
  narrative: string;
  affectedSubject: string;
  actorLabel: string;
  actorSecondary?: string;
  originLabel: string;
  timestampLabel: string;
  impact: ClinicalAuditImpact;
  clinicalArea: ClinicalAuditArea;
  importantChanges: ClinicalAuditChange[];
  technical: {
    action: AuditAction;
    entityType: AuditLogEntry['entityType'];
    entityId: string;
    details: Record<string, unknown>;
  };
}

const UNKNOWN_USER = 'Usuario no identificado';

const FIELD_LABELS: Record<string, string> = {
  note: 'Nota clínica',
  novedades: 'Novedades',
  handoffNote: 'Nota de entrega de enfermería',
  handoffNoteDayShift: 'Nota de entrega de enfermería - turno día',
  handoffNoteNightShift: 'Nota de entrega de enfermería - turno noche',
  handoffNovedadesDayShift: 'Novedades de entrega de enfermería - turno día',
  handoffNovedadesNightShift: 'Novedades de entrega de enfermería - turno noche',
  medicalHandoffNote: 'Nota de entrega médica',
  medicalHandoffEntries: 'Entradas de entrega médica por paciente',
  medicalHandoffBySpecialty: 'Entrega médica por especialidad',
  medicalHandoffNovedades: 'Novedades de entrega médica',
  specialty: 'Especialidad',
  secondarySpecialty: 'Especialidad secundaria',
  diagnosis: 'Diagnóstico',
  pathology: 'Diagnóstico',
  bedId: 'Cama',
  sourceBed: 'Cama origen',
  targetBed: 'Cama destino',
  restoredBed: 'Cama restaurada',
  status: 'Estado',
  reason: 'Motivo',
  active: 'Estado de cama extra',
  score: 'Puntaje',
  category: 'Categoría',
  documentType: 'Tipo de documento',
  documentTitle: 'Documento',
  doctorName: 'Médico responsable',
  authorName: 'Autor',
};

const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const getActorLabel = (log: AuditLogEntry): string =>
  asText(log.userDisplayName) || asText(log.userId) || asText(log.userUid) || UNKNOWN_USER;

const getActorSecondary = (log: AuditLogEntry): string | undefined => {
  const userId = asText(log.userId);
  const uid = asText(log.userUid);
  if (userId && uid) return `${userId} · UID ${uid}`;
  if (userId) return userId;
  if (uid) return `UID ${uid}`;
  return undefined;
};

const getOriginLabel = (log: AuditLogEntry): string =>
  asText(log.ipAddress) ? `IP ${asText(log.ipAddress)}` : 'IP no disponible';

const formatClinicalAuditTimestamp = (timestamp: unknown): string => {
  const date =
    typeof timestamp === 'string' || typeof timestamp === 'number'
      ? new Date(timestamp)
      : timestamp instanceof Date
        ? timestamp
        : new Date(0);

  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return 'Fecha desconocida';

  return date.toLocaleString('es-CL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

const classifyImpact = (action: AuditAction): ClinicalAuditImpact => {
  if (action.includes('VIEW')) return 'visualizacion';
  if (action.includes('DELETED') || action.includes('CLEARED')) return 'eliminacion';
  if (action.includes('EXPORTED')) return 'exportacion';
  if (action.includes('LOGIN') || action.includes('LOGOUT')) return 'sesion';
  if (action.includes('ERROR')) return 'sistema';
  if (action.includes('MODIFIED') || action.includes('UPDATED') || action.includes('RESTORED')) {
    return 'modificacion';
  }
  if (action.includes('CHANGED')) return 'modificacion';
  return 'registro';
};

const classifyArea = (action: AuditAction): ClinicalAuditArea => {
  if (action.includes('LOGIN') || action.includes('LOGOUT')) return 'sesion';
  if (action.includes('HANDOFF')) return 'entrega';
  if (action.includes('CLINICAL_DOCUMENT')) return 'documentos';
  if (action.includes('MEDICAL_INDICATION')) return 'indicaciones';
  if (action.includes('PRESCRIPTION')) return 'recetas';
  if (action.includes('CUDYR')) return 'cudyr';
  if (action.includes('WOUND_CARE')) return 'heridas';
  if (action.includes('SYSTEM') || action.includes('CONFLICT')) return 'sistema';
  if (action.includes('DATA_')) return 'mantenimiento';
  return 'censo';
};

const buildImportantChanges = (details: Record<string, unknown>): ClinicalAuditChange[] => {
  const rawChanges = details.changes;
  if (!rawChanges || typeof rawChanges !== 'object' || Array.isArray(rawChanges)) return [];

  return Object.entries(rawChanges as Record<string, { old?: unknown; new?: unknown }>).map(
    ([field, change]) => ({
      fieldLabel: FIELD_LABELS[field] || field,
      oldValue: change?.old,
      newValue: change?.new,
    })
  );
};

export const buildClinicalAuditPresentation = (log: AuditLogEntry): ClinicalAuditPresentation => {
  const details = log.details || {};
  const narrative = buildKnownClinicalAuditNarrative(log, details);

  return {
    ...narrative,
    actorLabel: getActorLabel(log),
    actorSecondary: getActorSecondary(log),
    originLabel: getOriginLabel(log),
    timestampLabel: formatClinicalAuditTimestamp(log.timestamp),
    impact: classifyImpact(log.action),
    clinicalArea: classifyArea(log.action),
    importantChanges: buildImportantChanges(details),
    technical: {
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      details,
    },
  };
};
