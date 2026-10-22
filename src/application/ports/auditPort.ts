import {
  getAuditLogs,
  getAuditLogsByIds,
  getAuditLogsInRange,
  logAuditEvent,
  logThrottledViewEvent,
} from '@/services/admin/auditService';
import { getCurrentUserEmail, getCurrentUserUid } from '@/services/admin/utils/auditUtils';
import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';

export interface AuditPort {
  writeEvent: (
    userId: string,
    action: AuditAction,
    entityType: AuditLogEntry['entityType'],
    entityId: string,
    details: Record<string, unknown>,
    patientRut?: string,
    recordDate?: string,
    authors?: string
  ) => Promise<void>;
  fetchLogs: (limit?: number | null) => Promise<AuditLogEntry[]>;
  fetchLogsInRange: (range: {
    fromIso: string;
    toIso: string;
    limit: number;
  }) => Promise<AuditLogEntry[]>;
  fetchLogsByIds: (ids: string[]) => Promise<AuditLogEntry[]>;
  logPatientAdmission: (
    bedId: string,
    patientName: string,
    rut: string,
    pathology: string | undefined,
    recordDate: string
  ) => Promise<void>;
  logPatientDischarge: (
    bedId: string,
    patientName: string,
    rut: string,
    status: string,
    recordDate: string
  ) => Promise<void>;
  logPatientTransfer: (
    bedId: string,
    patientName: string,
    rut: string,
    destination: string,
    recordDate: string
  ) => Promise<void>;
  logPatientView: (
    bedId: string,
    patientName: string,
    rut: string,
    recordDate: string
  ) => Promise<void>;
  /** Closes the device connection of the signed-in user (call before signing out). */
  logUserLogout: (email: string, reason?: 'manual' | 'automatic') => Promise<void>;
}

const loadAuditConnectionRuntime = () =>
  import('@/services/admin/auditSession/auditConnectionRuntime');

export const defaultAuditPort: AuditPort = {
  writeEvent: async (
    userId,
    action,
    entityType,
    entityId,
    details,
    patientRut,
    recordDate,
    authors
  ) => {
    const delivery = await logAuditEvent(
      userId,
      action,
      entityType,
      entityId,
      details,
      patientRut,
      recordDate,
      authors
    );
    // Fail-closed mutations (deleting a day, a prescription) must not proceed without their event.
    if (delivery === 'rejected' || delivery === 'failed') {
      throw new Error('No se pudo guardar el evento de auditoría.');
    }
  },
  fetchLogs: async (limit?: number | null) => getAuditLogs(limit),
  fetchLogsInRange: async range => getAuditLogsInRange(range),
  fetchLogsByIds: async ids => getAuditLogsByIds(ids),
  logPatientAdmission: async (bedId, patientName, rut, pathology, recordDate) => {
    await logAuditEvent(
      getCurrentUserEmail(),
      'PATIENT_ADMITTED',
      'patient',
      bedId,
      { patientName, bedId, pathology: pathology || '', rut },
      rut,
      recordDate
    );
  },
  logPatientDischarge: async (bedId, patientName, rut, status, recordDate) => {
    await logAuditEvent(
      getCurrentUserEmail(),
      'PATIENT_DISCHARGED',
      'discharge',
      bedId,
      { patientName, status, bedId, rut },
      rut,
      recordDate
    );
  },
  logPatientTransfer: async (bedId, patientName, rut, destination, recordDate) => {
    await logAuditEvent(
      getCurrentUserEmail(),
      'PATIENT_TRANSFERRED',
      'transfer',
      bedId,
      { patientName, destination, bedId, rut },
      rut,
      recordDate
    );
  },
  logPatientView: async (bedId, patientName, rut, recordDate) =>
    logThrottledViewEvent('VIEW_PATIENT', bedId, { patientName, bedId, rut }, recordDate),
  logUserLogout: async (_email, reason = 'manual') => {
    // Whose connection ends is fixed now: the module may finish loading after sign-out.
    const uid = getCurrentUserUid();
    const { endCurrentAuditConnection } = await loadAuditConnectionRuntime();
    await endCurrentAuditConnection(reason, uid);
  },
};
