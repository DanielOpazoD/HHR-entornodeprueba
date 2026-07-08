/**
 * Audit Context
 * Provides audit logging functionality throughout the app with user context.
 */

import React, { createContext, useContext, ReactNode, useMemo } from 'react';
import { useAudit } from '@/hooks/useAudit';
import { useAuth, type AuthUser } from '@/context/AuthContext';
import { ANONYMOUS_AUDIT_ACTOR } from '@/application/audit/auditActorPolicy';
import { AuditAction } from '@/types/auditActionTypes';
import { AuditLogEntry } from '@/types/auditLogTypes';

export { ANONYMOUS_AUDIT_ACTOR };

export const resolveAuditActor = (currentUser: AuthUser | null): string => {
  if (!currentUser) return ANONYMOUS_AUDIT_ACTOR;
  if (currentUser.email) return currentUser.email;
  if (currentUser.uid) return currentUser.uid;
  return ANONYMOUS_AUDIT_ACTOR;
};

interface AuditContextType {
  logPatientAdmission: (
    bedId: string,
    patientName: string,
    rut: string,
    recordDate: string
  ) => void;
  logPatientDischarge: (
    bedId: string,
    patientName: string,
    rut: string,
    status: string,
    recordDate: string
  ) => void;
  logPatientTransfer: (
    bedId: string,
    patientName: string,
    rut: string,
    destination: string,
    recordDate: string
  ) => void;
  logPatientCleared: (bedId: string, patientName: string, rut: string, recordDate: string) => void;
  logDailyRecordDeleted: (date: string) => void;
  logDailyRecordCreated: (date: string, copiedFrom?: string) => void;
  logCudyrModified: (
    bedId: string,
    patientName: string,
    rut: string,
    field: string,
    value: number,
    oldValue: number,
    recordDate: string,
    authors?: string
  ) => void;
  logHandoffNovedadesModified: (
    shift: string,
    content: string,
    oldContent: string,
    recordDate: string,
    authors?: string
  ) => void;
  logMedicalHandoffModified: (
    bedId: string,
    patientName: string,
    rut: string,
    note: string,
    oldNote: string,
    recordDate: string
  ) => void;
  logNurseHandoffModified: (
    bedId: string,
    patientName: string,
    rut: string,
    shift: string,
    note: string,
    oldNote: string,
    recordDate: string
  ) => void;
  logPatientView: (
    bedId: string,
    patientName: string,
    rut: string,
    recordDate: string,
    authors?: string
  ) => void;
  logClinicalDocumentCreated: (
    documentId: string,
    templateId: string,
    documentTitle: string,
    patientRut?: string,
    recordDate?: string
  ) => void;
  logClinicalDocumentEdited: (
    documentId: string,
    templateId: string,
    documentTitle: string,
    patientRut?: string,
    recordDate?: string
  ) => void;
  logClinicalDocumentDeleted: (
    documentId: string,
    templateId: string,
    documentTitle: string,
    patientRut?: string,
    recordDate?: string
  ) => void;
  logViewEvent: (
    action: AuditAction,
    entityType: AuditLogEntry['entityType'],
    entityId: string,
    details: Record<string, unknown>,
    patientRut?: string,
    recordDate?: string,
    authors?: string
  ) => void;
  logEvent: (
    action: AuditAction,
    entityType: AuditLogEntry['entityType'],
    entityId: string,
    details: Record<string, unknown>,
    patientRut?: string,
    recordDate?: string,
    authors?: string
  ) => void;
  logDebouncedEvent: (
    action: AuditAction,
    entityType: AuditLogEntry['entityType'],
    entityId: string,
    details: Record<string, unknown>,
    patientRut?: string,
    recordDate?: string,
    authors?: string,
    waitMs?: number
  ) => void;
  fetchLogs: (limit?: number) => Promise<AuditLogEntry[]>;
  getActionLabel: (action: AuditAction) => string;
  userId: string;
}

const AuditContext = createContext<AuditContextType | undefined>(undefined);

interface AuditProviderProps {
  children: ReactNode;
}

export const AuditProvider: React.FC<AuditProviderProps> = ({ children }) => {
  const { currentUser } = useAuth();
  const userId = useMemo(() => resolveAuditActor(currentUser), [currentUser]);
  const auditFunctions = useAudit(userId);
  const value = useMemo(() => ({ ...auditFunctions, userId }), [auditFunctions, userId]);

  return <AuditContext.Provider value={value}>{children}</AuditContext.Provider>;
};

export const useAuditContext = (): AuditContextType => {
  const context = useContext(AuditContext);
  if (!context) {
    throw new Error('useAuditContext must be used within an AuditProvider');
  }
  return context;
};
