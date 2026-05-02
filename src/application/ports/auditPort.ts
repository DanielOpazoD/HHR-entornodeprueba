import {
  getAuditLogs,
  logAuditEvent,
  logThrottledViewEvent,
  logUserLogin,
  logUserLogout,
} from '@/services/admin/auditService';
import { getCurrentUserEmail } from '@/services/admin/utils/auditUtils';
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
  logUserLogin: (email: string) => Promise<void>;
  logUserLogout: (email: string, reason?: 'manual' | 'automatic') => Promise<void>;
}

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
  ) =>
    logAuditEvent(userId, action, entityType, entityId, details, patientRut, recordDate, authors),
  fetchLogs: async (limit?: number | null) => getAuditLogs(limit),
  logPatientAdmission: async (bedId, patientName, rut, pathology, recordDate) =>
    logAuditEvent(
      getCurrentUserEmail(),
      'PATIENT_ADMITTED',
      'patient',
      bedId,
      { patientName, bedId, pathology: pathology || '', rut },
      rut,
      recordDate
    ),
  logPatientDischarge: async (bedId, patientName, rut, status, recordDate) =>
    logAuditEvent(
      getCurrentUserEmail(),
      'PATIENT_DISCHARGED',
      'discharge',
      bedId,
      { patientName, status, bedId, rut },
      rut,
      recordDate
    ),
  logPatientTransfer: async (bedId, patientName, rut, destination, recordDate) =>
    logAuditEvent(
      getCurrentUserEmail(),
      'PATIENT_TRANSFERRED',
      'transfer',
      bedId,
      { patientName, destination, bedId, rut },
      rut,
      recordDate
    ),
  logPatientView: async (bedId, patientName, rut, recordDate) =>
    logThrottledViewEvent('VIEW_PATIENT', bedId, { patientName, bedId, rut }, recordDate),
  logUserLogin: async email => logUserLogin(email),
  logUserLogout: async (email, reason) => logUserLogout(email, reason),
};
