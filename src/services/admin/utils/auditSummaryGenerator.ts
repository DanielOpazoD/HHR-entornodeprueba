/**
 * Audit Summary Generator
 * Provides human-readable descriptions for audit log entries.
 */

import { AuditAction } from '@/types/auditActionTypes';
import { buildPatientMovementSummary } from '@/services/admin/auditClinicalEventCatalog';

/**
 * Generate human-readable summary for audit entry
 */
export const generateSummary = (
  action: AuditAction,
  details: Record<string, unknown>,
  entityId: string
): string => {
  const patientName = (details.patientName as string) || 'Paciente';
  const bedId = (details.bedId as string) || entityId;

  switch (action) {
    case 'PATIENT_ADMITTED': {
      const dx = (details.pathology as string) ? ` [Dx: ${details.pathology}]` : '';
      return `Ingreso: ${patientName}${dx} → Cama ${bedId}`;
    }
    case 'PATIENT_DISCHARGED':
      return `Alta: ${patientName} (${(details.status as string) || 'Egreso'})`;
    case 'PATIENT_TRANSFERRED':
      return `Traslado: ${patientName} → ${(details.destination as string) || 'otro centro'}`;
    case 'PATIENT_DISCHARGE_RECLASSIFIED':
      return `Egreso reclasificado: ${patientName} (${String(details.from || '—')} → ${String(details.to || '—')})`;
    case 'PATIENT_MODIFIED': {
      const patientMovementSummary = buildPatientMovementSummary(
        {
          movementKind: details.movementKind,
          patientName,
          sourceBed: details.sourceBed as string | undefined,
          targetBed: details.targetBed as string | undefined,
          restoredBed: details.restoredBed as string | undefined,
        },
        bedId
      );
      if (patientMovementSummary) {
        return patientMovementSummary;
      }
      const fields = details.changes ? Object.keys(details.changes as object).join(', ') : '';
      return `Editó Ficha: ${patientName}${fields ? ` (${fields})` : ''}`;
    }
    case 'PATIENT_CLEARED':
      return `Limpieza Cama: ${bedId} (${patientName})`;
    case 'DAILY_RECORD_CREATED':
      return `Registro creado: ${entityId}${details.copiedFrom ? ` (desde ${details.copiedFrom})` : ''}`;
    case 'DAILY_RECORD_DELETED':
      return `Eliminación de Registro: ${entityId}`;
    case 'CUDYR_MODIFIED': {
      const cFields = details.changes ? Object.keys(details.changes as object).join(', ') : '';
      return `Editó CUDYR: ${patientName}${cFields ? ` (${cFields})` : ''}`;
    }
    case 'CUDYR_BATCH_SAVED':
      return `Guardó CUDYR: ${details.fieldCount || 0} cambios en ${details.patientCount || 0} paciente(s)`;
    case 'NURSE_HANDOFF_MODIFIED':
      return `Editó Nota Enfermería: ${patientName} (${(details.shift as string) === 'day' ? 'Largo' : 'Noche'})`;
    case 'MEDICAL_HANDOFF_MODIFIED':
      return `Actualizó Evolución Médica: ${patientName}`;
    case 'HANDOFF_NOVEDADES_MODIFIED':
      return `Novedades actualizadas (${(details.shift as string) || 'turno'})`;
    case 'VIEW_CUDYR':
      return `Vista: Planilla CUDYR`;
    case 'VIEW_NURSING_HANDOFF':
      return `Vista: Entrega Enfermería`;
    case 'VIEW_MEDICAL_HANDOFF':
      return `Vista: Entrega Médica`;
    case 'USER_LOGIN':
      return `Inicio de sesión`;
    case 'USER_LOGOUT':
      return `Cierre de sesión${details.durationFormatted ? ` (${details.durationFormatted})` : ''}`;
    case 'PATIENT_VIEWED':
      return `Ficha visualizada: ${patientName}`;
    case 'BED_BLOCKED':
      return `Cama bloqueada: ${bedId}${details.reason ? ` (${details.reason})` : ''}`;
    case 'BED_UNBLOCKED':
      return `Cama desbloqueada: ${bedId}`;
    case 'EXTRA_BED_TOGGLED':
      return `${details.active ? 'Activada' : 'Desactivada'} cama extra: ${bedId}`;
    case 'MEDICAL_HANDOFF_SIGNED':
      return `Entrega médica firmada: ${(details.doctorName as string) || 'Médico'}`;
    case 'MEDICAL_HANDOFF_RESTORED':
      return `Entrega médica restaurada: ${Array.isArray(details.clearedFields) ? (details.clearedFields as string[]).join(', ') : 'firmas eliminadas'}`;
    case 'CONFLICT_AUTO_MERGED':
      return `Auto-merge de conflicto: ${entityId} (${(details.entryCount as number) ?? 0} decisiones)`;
    case 'DATA_ADMISSION_DATES_BACKFILLED':
      return `Fechas de ingreso corregidas: ${(details.correctionCount as number) ?? 0} ajustes`;
    default:
      return action;
  }
};
