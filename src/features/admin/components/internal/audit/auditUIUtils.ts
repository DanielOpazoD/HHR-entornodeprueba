import React from 'react';
import {
  CheckCircle2,
  LogOut,
  GitBranch,
  History,
  Activity,
  Trash2,
  FileText,
  Eye,
  MessageSquare,
  Stethoscope,
  AlertCircle,
  BarChart3,
  LogIn,
  X,
  Zap,
  User,
  Upload,
  Download,
  Search,
  Camera,
  Lock,
  Plus,
  ClipboardList,
} from 'lucide-react';
import { AuditAction } from '@/types/auditActionTypes';
import { AuditLogEntry } from '@/types/auditLogTypes';
import { formatAuditTimestamp, parseAuditTimestamp } from '@/services/admin/utils/auditUtils';

/** Firebase Timestamp-like object */
interface FirebaseTimestamp {
  toDate?: () => Date;
  seconds?: number;
}

type TimestampValue = FirebaseTimestamp | Date | string | number | null | undefined;

// Safe parser for audit timestamps is now imported from auditUtils.ts
export { parseAuditTimestamp };

// Format any timestamp-like value to readable format
export const formatTimestamp = (timestamp: TimestampValue): string => {
  return formatAuditTimestamp(timestamp);
};

// Action Icon Mapping
export const actionIcons: Record<AuditAction, React.ReactNode> = {
  PATIENT_ADMITTED: React.createElement(CheckCircle2, { size: 14 }),
  PATIENT_DISCHARGED: React.createElement(LogOut, { size: 14 }),
  PATIENT_TRANSFERRED: React.createElement(GitBranch, { size: 14 }),
  PATIENT_MODIFIED: React.createElement(Activity, { size: 14 }),
  PATIENT_BED_CHANGED: React.createElement(GitBranch, { size: 14 }),
  PATIENT_DIAGNOSIS_CHANGED: React.createElement(Stethoscope, { size: 14 }),
  PATIENT_DISCHARGE_DIAGNOSIS_CHANGED: React.createElement(Stethoscope, { size: 14 }),
  PATIENT_DISCHARGE_RECLASSIFIED: React.createElement(GitBranch, { size: 14 }),
  PATIENT_CLEARED: React.createElement(Trash2, { size: 14 }),
  DAILY_RECORD_DELETED: React.createElement(Trash2, { size: 14 }),
  DAILY_RECORD_CREATED: React.createElement(FileText, { size: 14 }),
  PREVIOUS_DAY_EDIT_CONFIRMED: React.createElement(History, { size: 14 }),
  PATIENT_VIEWED: React.createElement(Eye, { size: 14 }),
  NURSE_HANDOFF_MODIFIED: React.createElement(MessageSquare, { size: 14 }),
  MEDICAL_HANDOFF_MODIFIED: React.createElement(Stethoscope, { size: 14 }),
  HANDOFF_NOVEDADES_MODIFIED: React.createElement(AlertCircle, { size: 14 }),
  CUDYR_MODIFIED: React.createElement(BarChart3, { size: 14 }),
  CUDYR_BATCH_SAVED: React.createElement(ClipboardList, { size: 14 }),
  USER_LOGIN: React.createElement(LogIn, { size: 14 }),
  USER_LOGOUT: React.createElement(LogOut, { size: 14 }),
  VIEW_CUDYR: React.createElement(Eye, { size: 14 }),
  VIEW_NURSING_HANDOFF: React.createElement(Eye, { size: 14 }),
  VIEW_MEDICAL_HANDOFF: React.createElement(Eye, { size: 14 }),
  BED_BLOCKED: React.createElement(X, { size: 14 }),
  BED_UNBLOCKED: React.createElement(CheckCircle2, { size: 14 }),
  EXTRA_BED_TOGGLED: React.createElement(Zap, { size: 14 }),
  MEDICAL_HANDOFF_SIGNED: React.createElement(User, { size: 14 }),
  MEDICAL_HANDOFF_RESTORED: React.createElement(History, { size: 14 }),
  DATA_IMPORTED: React.createElement(Upload, { size: 14 }),
  DATA_EXPORTED: React.createElement(Download, { size: 14 }),
  PATIENT_NOTE_UPDATED: React.createElement(FileText, { size: 14 }),
  CLINICAL_EVENT_ADDED: React.createElement(Zap, { size: 14 }),
  CLINICAL_EVENT_UPDATED: React.createElement(Activity, { size: 14 }),
  CLINICAL_EVENT_DELETED: React.createElement(Trash2, { size: 14 }),
  VIEW_PATIENT: React.createElement(Eye, { size: 14 }),
  PATIENT_HARMONIZED: React.createElement(Activity, { size: 14 }),
  CONFLICT_AUTO_MERGED: React.createElement(GitBranch, { size: 14 }),
  CONFLICT_VERSION_RESTORED: React.createElement(History, { size: 14 }),
  DATA_ADMISSION_DATES_BACKFILLED: React.createElement(Search, { size: 14 }),
  PATIENT_SPECIALTY_CHANGED: React.createElement(Stethoscope, { size: 14 }),
  CLINICAL_DOCUMENT_CREATED: React.createElement(FileText, { size: 14 }),
  CLINICAL_DOCUMENT_DELETED: React.createElement(Trash2, { size: 14 }),
  CLINICAL_DOCUMENT_EDITED: React.createElement(Activity, { size: 14 }),
  CLINICAL_DOCUMENT_EXPORTED: React.createElement(Download, { size: 14 }),
  CLINICAL_DOCUMENT_PRINTED: React.createElement(FileText, { size: 14 }),
  CLINICAL_DOCUMENT_LOCKED: React.createElement(Lock, { size: 14 }),
  PRESCRIPTION_MANUAL_DELETED: React.createElement(Trash2, { size: 14 }),
  PRESCRIPTION_RETENTION_DELETED: React.createElement(Trash2, { size: 14 }),
  MEDICAL_INDICATION_RECORD_CREATED: React.createElement(ClipboardList, { size: 14 }),
  MEDICAL_INDICATION_TEMPLATE_CREATED: React.createElement(FileText, { size: 14 }),
  MEDICAL_INDICATION_TEMPLATE_UPDATED: React.createElement(Activity, { size: 14 }),
  MEDICAL_INDICATION_TEMPLATE_ARCHIVED: React.createElement(Trash2, { size: 14 }),
  MEDICAL_INDICATION_TEMPLATE_USED: React.createElement(Plus, { size: 14 }),
  STATISTICAL_SPECIALTY_RECLASSIFIED: React.createElement(BarChart3, { size: 14 }),
  WOUND_CARE_PHOTO_UPLOADED: React.createElement(Camera, { size: 14 }),
  SYSTEM_ERROR: React.createElement(AlertCircle, { size: 14 }),
};

// Action color mapping - Enhanced with semantic shades
export const actionColors: Record<AuditAction, string> = {
  PATIENT_ADMITTED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  PATIENT_DISCHARGED: 'bg-blue-50 text-blue-700 border-blue-100',
  PATIENT_TRANSFERRED: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  PATIENT_MODIFIED: 'bg-amber-50 text-amber-700 border-amber-100',
  PATIENT_BED_CHANGED: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  PATIENT_DIAGNOSIS_CHANGED: 'bg-sky-50 text-sky-700 border-sky-100',
  PATIENT_DISCHARGE_DIAGNOSIS_CHANGED: 'bg-blue-50 text-blue-700 border-blue-100',
  PATIENT_DISCHARGE_RECLASSIFIED: 'bg-amber-50 text-amber-700 border-amber-100',
  PATIENT_CLEARED: 'bg-slate-50 text-slate-700 border-slate-100',
  DAILY_RECORD_DELETED: 'bg-rose-50 text-rose-700 border-rose-100',
  DAILY_RECORD_CREATED: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  PREVIOUS_DAY_EDIT_CONFIRMED: 'bg-amber-50 text-amber-700 border-amber-100',
  PATIENT_VIEWED: 'bg-teal-50 text-teal-700 border-teal-100',
  NURSE_HANDOFF_MODIFIED: 'bg-purple-50 text-purple-700 border-purple-100',
  MEDICAL_HANDOFF_MODIFIED: 'bg-sky-50 text-sky-700 border-sky-100',
  HANDOFF_NOVEDADES_MODIFIED: 'bg-orange-50 text-orange-700 border-orange-100',
  CUDYR_MODIFIED: 'bg-yellow-50 text-yellow-700 border-yellow-100',
  CUDYR_BATCH_SAVED: 'bg-amber-50 text-amber-700 border-amber-100',
  USER_LOGIN: 'bg-violet-50 text-violet-700 border-violet-100',
  USER_LOGOUT: 'bg-gray-50 text-gray-700 border-gray-100',
  VIEW_CUDYR: 'bg-amber-50 text-amber-700 border-amber-100',
  VIEW_NURSING_HANDOFF: 'bg-purple-50 text-purple-700 border-purple-100',
  VIEW_MEDICAL_HANDOFF: 'bg-sky-50 text-sky-700 border-sky-100',
  BED_BLOCKED: 'bg-rose-50 text-rose-700 border-rose-100',
  BED_UNBLOCKED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  EXTRA_BED_TOGGLED: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  MEDICAL_HANDOFF_SIGNED: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  MEDICAL_HANDOFF_RESTORED: 'bg-orange-50 text-orange-700 border-orange-100',
  DATA_IMPORTED: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  DATA_EXPORTED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  PATIENT_NOTE_UPDATED: 'bg-blue-50 text-blue-700 border-blue-100',
  CLINICAL_EVENT_ADDED: 'bg-teal-50 text-teal-700 border-teal-100',
  CLINICAL_EVENT_UPDATED: 'bg-amber-50 text-amber-700 border-amber-100',
  CLINICAL_EVENT_DELETED: 'bg-rose-50 text-rose-700 border-rose-100',
  VIEW_PATIENT: 'bg-teal-50 text-teal-700 border-teal-100',
  PATIENT_HARMONIZED: 'bg-violet-50 text-violet-700 border-violet-100',
  CONFLICT_AUTO_MERGED: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  CONFLICT_VERSION_RESTORED: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  DATA_ADMISSION_DATES_BACKFILLED: 'bg-amber-50 text-amber-700 border-amber-100',
  PATIENT_SPECIALTY_CHANGED: 'bg-indigo-50 text-indigo-700 border-indigo-100',
  CLINICAL_DOCUMENT_CREATED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  CLINICAL_DOCUMENT_DELETED: 'bg-rose-50 text-rose-700 border-rose-100',
  CLINICAL_DOCUMENT_EDITED: 'bg-amber-50 text-amber-700 border-amber-100',
  CLINICAL_DOCUMENT_EXPORTED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  CLINICAL_DOCUMENT_PRINTED: 'bg-blue-50 text-blue-700 border-blue-100',
  CLINICAL_DOCUMENT_LOCKED: 'bg-slate-50 text-slate-700 border-slate-100',
  PRESCRIPTION_MANUAL_DELETED: 'bg-rose-50 text-rose-700 border-rose-100',
  PRESCRIPTION_RETENTION_DELETED: 'bg-slate-50 text-slate-700 border-slate-100',
  MEDICAL_INDICATION_RECORD_CREATED: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  MEDICAL_INDICATION_TEMPLATE_CREATED: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  MEDICAL_INDICATION_TEMPLATE_UPDATED: 'bg-amber-50 text-amber-700 border-amber-100',
  MEDICAL_INDICATION_TEMPLATE_ARCHIVED: 'bg-slate-50 text-slate-700 border-slate-100',
  MEDICAL_INDICATION_TEMPLATE_USED: 'bg-blue-50 text-blue-700 border-blue-100',
  STATISTICAL_SPECIALTY_RECLASSIFIED: 'bg-sky-50 text-sky-700 border-sky-100',
  WOUND_CARE_PHOTO_UPLOADED: 'bg-sky-50 text-sky-700 border-sky-100',
  SYSTEM_ERROR: 'bg-red-50 text-red-700 border-red-100',
};

export const renderHumanDetails = (log: AuditLogEntry) => {
  const details = log.details || {};
  switch (log.action) {
    case 'PATIENT_ADMITTED':
      return `Se ingresó al paciente ${details.patientName || 'ANÓNIMO'} en la cama ${details.bedId || log.entityId}.`;
    case 'PATIENT_DISCHARGED':
      return `Se dio el alta a ${details.patientName || 'ANÓNIMO'} con estado "${details.status || 'Egreso'}".`;
    case 'PATIENT_TRANSFERRED':
      return `Se trasladó a ${details.patientName || 'ANÓNIMO'} hacia ${details.destination || 'otro centro'}.`;
    case 'PATIENT_MODIFIED':
      return `Se actualizaron los datos clínicos del paciente ${details.patientName || ''}.`;
    case 'PATIENT_BED_CHANGED':
      return `Se cambió de cama a ${details.patientName || 'paciente'}.`;
    case 'PATIENT_DIAGNOSIS_CHANGED':
      return `Se actualizó el diagnóstico de ${details.patientName || 'paciente'}.`;
    case 'PATIENT_DISCHARGE_DIAGNOSIS_CHANGED':
      return `Se actualizó el diagnóstico de egreso de ${details.patientName || 'paciente'}.`;
    case 'PATIENT_DISCHARGE_RECLASSIFIED':
      return `Se reclasificó el egreso de ${details.patientName || 'paciente'}: ${details.from || 'origen no registrado'} → ${details.to || 'destino no registrado'}.`;
    case 'PATIENT_CLEARED':
      return `Se liberó la cama ${details.bedId || log.entityId} (Paciente: ${details.patientName || 'N/A'}).`;
    case 'DAILY_RECORD_CREATED':
      return `Se creó el registro clínico para el día ${log.entityId}.`;
    case 'DAILY_RECORD_DELETED':
      return `Se eliminó permanentemente el registro clínico del ${log.entityId}.`;
    case 'CUDYR_MODIFIED':
      return `Se actualizó la evaluación CUDYR(${details.field || 'valor'}): ${details.value || '0'}.`;
    case 'CUDYR_BATCH_SAVED':
      return `Se guardó CUDYR en lote: ${details.fieldCount || 0} cambio(s) en ${details.patientCount || 0} paciente(s).`;
    case 'NURSE_HANDOFF_MODIFIED':
      return `Modificación de nota de enfermería(${details.shift === 'day' ? 'Día' : 'Noche'}).`;
    case 'MEDICAL_HANDOFF_MODIFIED':
      return `Se editó la evolución médica del paciente.`;
    case 'HANDOFF_NOVEDADES_MODIFIED':
      return `Se actualizó la sección de novedades generales(${details.shift || 'turno'}).`;
    case 'VIEW_CUDYR':
      return `El usuario visualizó la planilla de categorización CUDYR.`;
    case 'BED_BLOCKED':
      return `Cama ${details.bedId || log.entityId} bloqueada${details.reason ? `: ${details.reason}` : ''}.`;
    case 'BED_UNBLOCKED':
      return `Cama ${details.bedId || log.entityId} desbloqueada.`;
    case 'EXTRA_BED_TOGGLED':
      return `Cama extra ${details.bedId || log.entityId} ${details.active ? 'activada' : 'desactivada'}.`;
    case 'MEDICAL_HANDOFF_SIGNED':
      return `Se registró la firma médica de ${(details.doctorName as string) || 'un profesional'}.`;
    case 'MEDICAL_HANDOFF_RESTORED':
      return `Se restauró la entrega médica eliminando ${Array.isArray(details.clearedFields) ? (details.clearedFields as string[]).join(', ') : 'firmas previas'}.`;
    case 'VIEW_NURSING_HANDOFF':
      return `Visualización de la entrega de turno de enfermería(${details.shift || 'turno'}).`;
    case 'VIEW_MEDICAL_HANDOFF':
      return `Visualización de la entrega de turno médica.`;
    case 'DATA_IMPORTED':
      return `Se importó un respaldo JSON(${details.recordCount || 0} registros).`;
    case 'DATA_EXPORTED':
      return `Se exportó la base de datos a JSON(${details.recordCount || 0} registros).`;
    case 'SYSTEM_ERROR':
      return `Error del sistema: ${details.message || 'Error no especificado'}.`;
    case 'CONFLICT_AUTO_MERGED':
      return `Se aplicó auto-merge de conflicto para ${log.entityId} con política ${details.policyVersion || 'N/A'}.`;
    case 'DATA_ADMISSION_DATES_BACKFILLED':
      return `Se corrigieron ${details.correctionCount || 0} fechas de ingreso históricas.`;
    case 'PATIENT_SPECIALTY_CHANGED': {
      const fieldLabel =
        details.field === 'secondarySpecialty' ? 'especialidad secundaria' : 'especialidad';
      const changes = details.changes as Record<string, { old: unknown; new: unknown }> | undefined;
      const key = (details.field as string) || 'specialty';
      const oldVal = changes?.[key]?.old || '—';
      const newVal = changes?.[key]?.new || '—';
      return `Se reasignó la ${fieldLabel} de ${details.patientName || 'paciente'}: "${oldVal}" → "${newVal}".`;
    }
    case 'CLINICAL_DOCUMENT_CREATED':
      return `Se creó el documento clínico "${details.documentTitle || log.entityId}".`;
    case 'CLINICAL_DOCUMENT_DELETED':
      return `Se eliminó el documento clínico "${details.documentTitle || log.entityId}".`;
    case 'CLINICAL_DOCUMENT_EDITED':
      return `Se editó el documento clínico "${details.documentTitle || log.entityId}".`;
    case 'CLINICAL_DOCUMENT_EXPORTED':
      return `Se exportó el documento clínico "${details.documentTitle || log.entityId}".`;
    case 'CLINICAL_DOCUMENT_PRINTED':
      return `Se preparó la impresión del documento clínico "${details.documentTitle || log.entityId}".`;
    case 'CLINICAL_DOCUMENT_LOCKED':
      return `Se bloqueó el documento clínico "${details.documentTitle || log.entityId}" al cerrarse el episodio.`;
    case 'PRESCRIPTION_MANUAL_DELETED':
      return `Se eliminó manualmente el respaldo de receta ${details.prescriptionId || log.entityId}${details.patientName ? ` de ${details.patientName}` : ''}.`;
    case 'PRESCRIPTION_RETENTION_DELETED':
      return `Se eliminó por un proceso automático histórico el respaldo de receta ${details.prescriptionId || log.entityId}${details.patientName ? ` de ${details.patientName}` : ''}.`;
    case 'MEDICAL_INDICATION_RECORD_CREATED':
      return `Se generaron indicaciones médicas para ${details.patientName || 'paciente'} con fecha objetivo ${details.targetDate || log.recordDate || 'no registrada'}.`;
    case 'STATISTICAL_SPECIALTY_RECLASSIFIED':
      return `Se reclasificó una especialidad para estadística: ${details.originalSpecialty || 'sin origen'} → ${details.reportingSpecialty || 'sin cambio'}.`;
    case 'MEDICAL_INDICATION_TEMPLATE_CREATED':
      return `Se guardó una indicación personal: ${details.textPreview || log.entityId}.`;
    case 'MEDICAL_INDICATION_TEMPLATE_UPDATED':
      return `Se editó una indicación personal: ${details.textPreview || log.entityId}.`;
    case 'MEDICAL_INDICATION_TEMPLATE_ARCHIVED':
      return `Se archivó una indicación personal (${log.entityId}).`;
    case 'MEDICAL_INDICATION_TEMPLATE_USED':
      return `Se reutilizó una indicación personal: ${details.textPreview || log.entityId}.`;
    case 'WOUND_CARE_PHOTO_UPLOADED':
      return `Se subió foto clínica por QR para ${details.patientName || 'paciente'}${details.bodyLocation ? ` (${details.bodyLocation})` : ''}.`;
    default:
      return typeof details === 'string' ? details : JSON.stringify(details).slice(0, 100) + '...';
  }
};
