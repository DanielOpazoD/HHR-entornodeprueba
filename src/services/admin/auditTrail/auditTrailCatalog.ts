import type { AuditAction } from '@/types/auditActionTypes';
import type {
  AuditTrailArea,
  AuditTrailCategory,
  AuditTrailGrouping,
  AuditTrailStatus,
} from '@/types/auditTrailTypes';

interface AuditTrailActionEntry {
  category: AuditTrailCategory;
  area: AuditTrailArea;
  label: string;
  /** Events that someone should look at even when they were recorded normally. */
  review?: boolean;
}

const change = (area: AuditTrailArea, label: string, review = false): AuditTrailActionEntry => ({
  category: 'change',
  area,
  label,
  review,
});
const access = (area: AuditTrailArea, label: string): AuditTrailActionEntry => ({
  category: 'access',
  area,
  label,
});
const system = (area: AuditTrailArea, label: string, review = false): AuditTrailActionEntry => ({
  category: 'system',
  area,
  label,
  review,
});
const connection = (label: string): AuditTrailActionEntry => ({
  category: 'connection',
  area: 'session',
  label,
});

export const AUDIT_TRAIL_ACTIONS: Record<AuditAction, AuditTrailActionEntry> = {
  PATIENT_ADMITTED: change('census', 'Ingreso'),
  PATIENT_DISCHARGED: change('census', 'Alta'),
  PATIENT_TRANSFERRED: change('census', 'Traslado'),
  PATIENT_MODIFIED: change('census', 'Edición'),
  PATIENT_BED_CHANGED: change('census', 'Cambio de cama'),
  PATIENT_DIAGNOSIS_CHANGED: change('census', 'Diagnóstico'),
  PATIENT_DISCHARGE_DIAGNOSIS_CHANGED: change('census', 'Diagnóstico de egreso'),
  PATIENT_DISCHARGE_RECLASSIFIED: change('census', 'Egreso reclasificado'),
  PATIENT_NOTE_UPDATED: change('census', 'Nota'),
  PATIENT_SPECIALTY_CHANGED: change('census', 'Especialidad'),
  CLINICAL_EVENT_ADDED: change('census', 'Evento clínico'),
  CLINICAL_EVENT_UPDATED: change('census', 'Evento clínico editado'),
  CLINICAL_EVENT_DELETED: change('census', 'Evento clínico eliminado', true),
  PATIENT_CLEARED: change('census', 'Cama liberada', true),
  DAILY_RECORD_CREATED: change('census', 'Censo creado'),
  DAILY_RECORD_DELETED: change('census', 'Censo eliminado', true),
  PREVIOUS_DAY_EDIT_CONFIRMED: change('census', 'Edición de día anterior'),
  BED_BLOCKED: change('census', 'Cama bloqueada'),
  BED_UNBLOCKED: change('census', 'Cama desbloqueada'),
  EXTRA_BED_TOGGLED: change('census', 'Cama extra'),
  STATISTICAL_SPECIALTY_RECLASSIFIED: change('census', 'Reclasificación estadística'),
  NURSE_HANDOFF_MODIFIED: change('nursingHandoff', 'Entrega enfermería'),
  HANDOFF_NOVEDADES_MODIFIED: change('nursingHandoff', 'Novedades'),
  MEDICAL_HANDOFF_MODIFIED: change('medicalHandoff', 'Entrega médica'),
  MEDICAL_HANDOFF_SIGNED: change('medicalHandoff', 'Firma entrega médica'),
  MEDICAL_HANDOFF_RESTORED: change('medicalHandoff', 'Entrega médica restaurada'),
  CUDYR_MODIFIED: change('cudyr', 'CUDYR'),
  CUDYR_BATCH_SAVED: change('cudyr', 'CUDYR guardado'),
  CLINICAL_DOCUMENT_CREATED: change('documents', 'Documento creado'),
  CLINICAL_DOCUMENT_EDITED: change('documents', 'Documento editado'),
  CLINICAL_DOCUMENT_LOCKED: change('documents', 'Documento cerrado'),
  CLINICAL_DOCUMENT_DELETED: change('documents', 'Documento eliminado', true),
  WOUND_CARE_PHOTO_UPLOADED: change('woundCare', 'Foto de curación'),
  MEDICAL_INDICATION_RECORD_CREATED: change('indications', 'Indicaciones'),
  MEDICAL_INDICATION_TEMPLATE_CREATED: change('indications', 'Plantilla creada'),
  MEDICAL_INDICATION_TEMPLATE_UPDATED: change('indications', 'Plantilla editada'),
  MEDICAL_INDICATION_TEMPLATE_ARCHIVED: change('indications', 'Plantilla archivada'),
  MEDICAL_INDICATION_TEMPLATE_USED: change('indications', 'Plantilla usada'),
  PRESCRIPTION_MANUAL_DELETED: change('prescriptions', 'Receta eliminada', true),
  PATIENT_VIEWED: access('census', 'Vio ficha'),
  VIEW_PATIENT: access('census', 'Vio ficha'),
  VIEW_CUDYR: access('cudyr', 'Vio CUDYR'),
  VIEW_NURSING_HANDOFF: access('nursingHandoff', 'Vio entrega enfermería'),
  VIEW_MEDICAL_HANDOFF: access('medicalHandoff', 'Vio entrega médica'),
  CLINICAL_DOCUMENT_EXPORTED: access('documents', 'Documento exportado'),
  CLINICAL_DOCUMENT_PRINTED: access('documents', 'Documento impreso'),
  DATA_EXPORTED: access('system', 'Exportación'),
  USER_LOGIN: connection('Inicio de sesión'),
  USER_LOGOUT: connection('Cierre de sesión'),
  CONNECTION_INTERRUPTED: connection('Sin red'),
  DATA_IMPORTED: system('system', 'Importación'),
  PATIENT_HARMONIZED: system('census', 'Identidad armonizada'),
  CONFLICT_AUTO_MERGED: system('census', 'Conflicto conciliado'),
  CONFLICT_VERSION_RESTORED: system('census', 'Versión restaurada', true),
  DATA_ADMISSION_DATES_BACKFILLED: system('census', 'Fechas de ingreso corregidas'),
  PRESCRIPTION_RETENTION_DELETED: system('prescriptions', 'Receta depurada'),
  SYSTEM_ERROR: system('system', 'Error', true),
};

/** Actions written only by Cloud Functions, outside the client `AuditAction` union. */
const SERVER_ACTIONS: Record<string, AuditTrailActionEntry> = {
  CLINICAL_DOCUMENT_DRIVE_EXPORTED: access('documents', 'Documento enviado a Drive'),
  WOUND_CARE_MOBILE_SESSION_VALIDATED: access('woundCare', 'Carga QR validada'),
};

const UNKNOWN_ACTION: AuditTrailActionEntry = system('system', 'Evento');

export const resolveAuditTrailAction = (action: string): AuditTrailActionEntry =>
  (AUDIT_TRAIL_ACTIONS as Record<string, AuditTrailActionEntry | undefined>)[action] ??
  SERVER_ACTIONS[action] ?? { ...UNKNOWN_ACTION, label: action || UNKNOWN_ACTION.label };

export const AUDIT_TRAIL_CATEGORY_LABELS: Record<AuditTrailCategory, string> = {
  change: 'Cambios',
  access: 'Accesos',
  connection: 'Conexiones',
  system: 'Sistema',
};

export const AUDIT_TRAIL_CATEGORY_ORDER: AuditTrailCategory[] = [
  'change',
  'access',
  'connection',
  'system',
];

export const AUDIT_TRAIL_STATUS_LABELS: Record<AuditTrailStatus, string> = {
  ok: 'Registrado',
  auto: 'Automático',
  review: 'Revisar',
};

export const AUDIT_TRAIL_AREA_LABELS: Record<AuditTrailArea, string> = {
  census: 'Censo',
  nursingHandoff: 'Entrega enfermería',
  medicalHandoff: 'Entrega médica',
  cudyr: 'CUDYR',
  documents: 'Documentos',
  indications: 'Indicaciones',
  prescriptions: 'Recetas',
  woundCare: 'Curaciones',
  session: 'Sesión',
  system: 'Sistema',
};

export const AUDIT_TRAIL_AREA_ORDER: AuditTrailArea[] = [
  'census',
  'nursingHandoff',
  'medicalHandoff',
  'cudyr',
  'documents',
  'indications',
  'prescriptions',
  'woundCare',
  'session',
  'system',
];

export const AUDIT_TRAIL_GROUPING_LABELS: Record<AuditTrailGrouping, string> = {
  patient: 'Paciente',
  actor: 'Funcionario',
  session: 'Conexión',
  time: 'Cronológico',
};

export const AUDIT_TRAIL_GROUPING_ORDER: AuditTrailGrouping[] = [
  'patient',
  'actor',
  'session',
  'time',
];
