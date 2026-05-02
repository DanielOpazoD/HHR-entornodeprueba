import { useCallback } from 'react';

import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { AuditAction } from '@/types/auditActionTypes';

type AuditLogger = (
  action: AuditAction,
  entityType: AuditLogEntry['entityType'],
  entityId: string,
  details: Record<string, unknown>,
  patientRut?: string,
  recordDate?: string,
  authors?: string
) => void;

const CLINICAL_DOCUMENT_EDITED_THROTTLE_MS = 15 * 60 * 1000;

const buildClinicalDocumentDetails = (
  documentId: string,
  templateId: string,
  documentTitle: string
): Record<string, unknown> => ({ documentId, templateId, documentTitle });

const shouldLogClinicalDocumentEdit = (documentId: string): boolean => {
  if (typeof sessionStorage === 'undefined') return true;

  const throttleKey = `hhr_audit_throttle_CLINICAL_DOCUMENT_EDITED_${documentId}`;
  const lastLogged = sessionStorage.getItem(throttleKey);
  if (lastLogged) {
    const elapsed = Date.now() - new Date(lastLogged).getTime();
    if (elapsed < CLINICAL_DOCUMENT_EDITED_THROTTLE_MS) {
      return false;
    }
  }

  sessionStorage.setItem(throttleKey, new Date().toISOString());
  return true;
};

export const useClinicalDocumentAuditLoggers = (logEvent: AuditLogger) => {
  const logClinicalDocumentCreated = useCallback(
    (
      documentId: string,
      templateId: string,
      documentTitle: string,
      patientRut?: string,
      recordDate?: string
    ) => {
      logEvent(
        'CLINICAL_DOCUMENT_CREATED',
        'clinicalDocument',
        documentId,
        buildClinicalDocumentDetails(documentId, templateId, documentTitle),
        patientRut,
        recordDate
      );
    },
    [logEvent]
  );

  const logClinicalDocumentEdited = useCallback(
    (
      documentId: string,
      templateId: string,
      documentTitle: string,
      patientRut?: string,
      recordDate?: string
    ) => {
      if (!shouldLogClinicalDocumentEdit(documentId)) {
        return;
      }

      logEvent(
        'CLINICAL_DOCUMENT_EDITED',
        'clinicalDocument',
        documentId,
        buildClinicalDocumentDetails(documentId, templateId, documentTitle),
        patientRut,
        recordDate
      );
    },
    [logEvent]
  );

  const logClinicalDocumentDeleted = useCallback(
    (
      documentId: string,
      templateId: string,
      documentTitle: string,
      patientRut?: string,
      recordDate?: string
    ) => {
      logEvent(
        'CLINICAL_DOCUMENT_DELETED',
        'clinicalDocument',
        documentId,
        buildClinicalDocumentDetails(documentId, templateId, documentTitle),
        patientRut,
        recordDate
      );
    },
    [logEvent]
  );

  return {
    logClinicalDocumentCreated,
    logClinicalDocumentEdited,
    logClinicalDocumentDeleted,
  };
};
