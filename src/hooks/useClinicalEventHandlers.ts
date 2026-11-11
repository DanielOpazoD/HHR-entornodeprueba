import type { PatientData } from '@/types/domain/patient';

import { useCallback } from 'react';
import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';
import type { ClinicalEvent } from '@/types/domain/clinicalEvents';

import type { PatientFieldValue } from '@/types/valueTypes';
import {
  buildClinicalEventAuditPayload,
  buildClinicalEventSuccessFeedback,
} from '@/hooks/controllers/clinicalEventFeedbackController';
import {
  appendClinicalEvent,
  buildAddedClinicalEvent,
  removeClinicalEventFromList,
  updateClinicalEventList,
} from '@/hooks/controllers/clinicalEventMutationController';

interface UseClinicalEventHandlersParams {
  record: { date: string; beds: Record<string, PatientData> } | null;
  updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
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
  onSuccess: (message: string, description?: string) => void;
}

export const useClinicalEventHandlers = ({
  record,
  updatePatient,
  logDebouncedEvent,
  onSuccess,
}: UseClinicalEventHandlersParams) => {
  const handleClinicalEventAdd = useCallback(
    (bedId: string, event: Omit<ClinicalEvent, 'id' | 'createdAt'>) => {
      if (!record) return;
      const patient = record.beds[bedId];
      if (!patient) return;

      const newEvent = buildAddedClinicalEvent(
        event,
        () => crypto.randomUUID(),
        () => new Date().toISOString()
      );
      const auditPayload = buildClinicalEventAuditPayload(
        'CLINICAL_EVENT_ADDED',
        bedId,
        event.name,
        record.date
      );
      const successFeedback = buildClinicalEventSuccessFeedback(event.name);

      updatePatient(bedId, 'clinicalEvents', appendClinicalEvent(patient, newEvent));

      logDebouncedEvent(
        auditPayload.action,
        auditPayload.entityType,
        auditPayload.entityId,
        auditPayload.details,
        auditPayload.patientRut,
        auditPayload.recordDate,
        auditPayload.authors,
        auditPayload.waitMs
      );

      onSuccess(successFeedback.title, successFeedback.description);
    },
    [logDebouncedEvent, onSuccess, record, updatePatient]
  );

  const handleClinicalEventUpdate = useCallback(
    (bedId: string, eventId: string, data: Partial<ClinicalEvent>) => {
      if (!record) return;
      const patient = record.beds[bedId];
      if (!patient || !patient.clinicalEvents) return;

      updatePatient(bedId, 'clinicalEvents', updateClinicalEventList(patient, eventId, data));
    },
    [record, updatePatient]
  );

  const handleClinicalEventDelete = useCallback(
    (bedId: string, eventId: string) => {
      if (!record) return;
      const patient = record.beds[bedId];
      if (!patient || !patient.clinicalEvents) return;

      const { nextEvents, deletedEvent: eventToDelete } = removeClinicalEventFromList(
        patient,
        eventId
      );
      updatePatient(bedId, 'clinicalEvents', nextEvents);

      if (eventToDelete) {
        const auditPayload = buildClinicalEventAuditPayload(
          'CLINICAL_EVENT_DELETED',
          bedId,
          eventToDelete.name,
          record.date
        );
        logDebouncedEvent(
          auditPayload.action,
          auditPayload.entityType,
          auditPayload.entityId,
          auditPayload.details,
          auditPayload.patientRut,
          auditPayload.recordDate,
          auditPayload.authors,
          auditPayload.waitMs
        );
      }
    },
    [logDebouncedEvent, record, updatePatient]
  );

  return {
    handleClinicalEventAdd,
    handleClinicalEventUpdate,
    handleClinicalEventDelete,
  };
};
