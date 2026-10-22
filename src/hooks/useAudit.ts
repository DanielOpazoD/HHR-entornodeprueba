/**
 * useAudit Hook
 * Provides audit logging functions with user context.
 * Must be used within a component that has access to authenticated user.
 */

import { useCallback } from 'react';
import { AUDIT_ACTION_LABELS } from '@/services/admin/auditConstants';
import { AuditAction } from '@/types/auditActionTypes';
import { AuditLogEntry } from '@/types/auditLogTypes';
import { reportAuditOutcome } from '@/hooks/controllers/auditEventRejectionLogger';
import { logger } from '@/services/utils/loggerService';
import { buildMeaningfulAuditDetails } from '@/hooks/controllers/auditLogPolicyController';
import { useCoalescedAuditLogger } from '@/hooks/controllers/useCoalescedAuditLogger';
import {
  VIEW_THROTTLE_KEY,
  VIEW_THROTTLE_WINDOW_MS,
  buildNextViewThrottleState,
  parseViewThrottleState,
  serializeViewThrottleState,
  shouldExcludeAuditEmail,
  shouldThrottleAuditViewAction,
  type ViewThrottleState,
} from '@/services/admin/auditViewThrottle';
import { useClinicalDocumentAuditLoggers } from '@/hooks/controllers/useClinicalDocumentAuditLoggers';
import { useCudyrAuditLoggers } from '@/hooks/controllers/useCudyrAuditLoggers';
import { useHandoffAuditLoggers } from '@/hooks/controllers/useHandoffAuditLoggers';
import { usePatientLifecycleAuditLoggers } from '@/hooks/controllers/usePatientLifecycleAuditLoggers';
import { loadWriteAuditEventUseCase } from '@/application/audit/writeAuditEventUseCaseLoader';

const loadFetchAuditLogsUseCase = () => import('@/application/audit/fetchAuditLogsUseCase');

const getViewThrottleState = (): ViewThrottleState => {
  if (typeof sessionStorage === 'undefined') return {};
  return parseViewThrottleState(sessionStorage.getItem(VIEW_THROTTLE_KEY));
};

const updateViewThrottleState = (action: AuditAction, subject: string): void => {
  if (typeof sessionStorage === 'undefined') return;
  const nextState = buildNextViewThrottleState(
    action,
    getViewThrottleState(),
    new Date().toISOString(),
    subject
  );
  sessionStorage.setItem(VIEW_THROTTLE_KEY, serializeViewThrottleState(nextState));
};

/**
 * Reads are counted once per patient and screen. Document, name and bed together: a newborn may
 * carry the mother's document but is another patient.
 */
const resolveViewSubject = (
  entityId: string,
  details: Record<string, unknown>,
  patientRut?: string
): string => [patientRut || details.rut, details.patientName, entityId].filter(Boolean).join('|');

interface UseAuditReturn {
  // Logging functions
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
  // Generic logger
  logEvent: (
    action: AuditAction,
    entityType: AuditLogEntry['entityType'],
    entityId: string,
    details: Record<string, unknown>,
    patientRut?: string,
    recordDate?: string,
    authors?: string
  ) => void;
  // Smart logger (debounced)
  logDebouncedEvent: (
    action: AuditAction,
    entityType: AuditLogEntry['entityType'],
    entityId: string,
    details: Record<string, unknown>,
    patientRut?: string,
    recordDate?: string,
    authors?: string
  ) => void;
  // Fetching
  fetchLogs: (limit?: number) => Promise<AuditLogEntry[]>;
  // Labels
  getActionLabel: (action: AuditAction) => string;
}

export const useAudit = (userId: string): UseAuditReturn => {
  const recordEvent = useCallback(
    async (
      action: AuditAction,
      entityType: AuditLogEntry['entityType'],
      entityId: string,
      details: Record<string, unknown>,
      patientRut?: string,
      recordDate?: string,
      authors?: string
    ): Promise<void> => {
      const normalizedDetails = buildMeaningfulAuditDetails(details);
      if (!normalizedDetails) {
        return;
      }

      try {
        const { executeWriteAuditEvent } = await loadWriteAuditEventUseCase();
        const outcome = await executeWriteAuditEvent({
          userId,
          action,
          entityType,
          entityId,
          details: normalizedDetails,
          patientRut,
          recordDate,
          authors,
        });
        reportAuditOutcome(outcome, { userId, action, entityType, entityId });
      } catch (error) {
        logger.warn('Failed to record audit event', error);
      }
    },
    [userId]
  );

  const logEvent = useCallback(
    (
      action: AuditAction,
      entityType: AuditLogEntry['entityType'],
      entityId: string,
      details: Record<string, unknown>,
      patientRut?: string,
      recordDate?: string,
      authors?: string
    ) => {
      void recordEvent(action, entityType, entityId, details, patientRut, recordDate, authors);
    },
    [recordEvent]
  );

  const logDebouncedEvent = useCoalescedAuditLogger(recordEvent, userId);

  const {
    logPatientAdmission,
    logPatientDischarge,
    logPatientTransfer,
    logPatientCleared,
    logDailyRecordDeleted,
    logDailyRecordCreated,
  } = usePatientLifecycleAuditLoggers(logEvent);

  const { logHandoffNovedadesModified, logMedicalHandoffModified, logNurseHandoffModified } =
    useHandoffAuditLoggers(logDebouncedEvent);

  const logViewEvent = useCallback(
    (
      action: AuditAction,
      entityType: AuditLogEntry['entityType'],
      entityId: string,
      details: Record<string, unknown>,
      patientRut?: string,
      recordDate?: string,
      authors?: string
    ) => {
      if (shouldExcludeAuditEmail(userId)) {
        return;
      }

      const subject = resolveViewSubject(entityId, details, patientRut);
      if (
        shouldThrottleAuditViewAction(
          action,
          getViewThrottleState(),
          Date.now(),
          VIEW_THROTTLE_WINDOW_MS,
          subject
        )
      ) {
        return;
      }

      updateViewThrottleState(action, subject);
      logEvent(action, entityType, entityId, details, patientRut, recordDate, authors);
    },
    [logEvent, userId]
  );

  const logPatientView = useCallback(
    (bedId: string, patientName: string, rut: string, recordDate: string, authors?: string) => {
      logViewEvent(
        'PATIENT_VIEWED',
        'patient',
        bedId,
        { patientName, bedId },
        rut,
        recordDate,
        authors
      );
    },
    [logViewEvent]
  );

  const { logClinicalDocumentCreated, logClinicalDocumentEdited, logClinicalDocumentDeleted } =
    useClinicalDocumentAuditLoggers(logEvent);
  const { logCudyrModified } = useCudyrAuditLoggers(logDebouncedEvent);

  const fetchLogs = useCallback(async (limit: number = 100): Promise<AuditLogEntry[]> => {
    const { executeFetchAuditLogs } = await loadFetchAuditLogsUseCase();
    const result = await executeFetchAuditLogs({ limit });
    return result.data;
  }, []);

  const getActionLabel = useCallback((action: AuditAction): string => {
    return AUDIT_ACTION_LABELS[action] || action;
  }, []);

  return {
    logPatientAdmission,
    logPatientDischarge,
    logPatientTransfer,
    logPatientCleared,
    logDailyRecordDeleted,
    logDailyRecordCreated,
    logCudyrModified,
    logHandoffNovedadesModified,
    logMedicalHandoffModified,
    logNurseHandoffModified,
    logPatientView,
    logClinicalDocumentCreated,
    logClinicalDocumentEdited,
    logClinicalDocumentDeleted,
    logViewEvent,
    logEvent,
    logDebouncedEvent,
    fetchLogs,
    getActionLabel,
  };
};
