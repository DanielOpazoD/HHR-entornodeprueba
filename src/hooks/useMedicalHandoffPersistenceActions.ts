import { useCallback } from 'react';
import type {
  MedicalHandoffActor,
  MedicalSpecialty,
} from '@/types/domain/dailyRecordMedicalHandoff';
import type { MedicalHandoffScope } from '@/types/medicalHandoff';
import type { ConfirmMedicalSpecialtyNoChangesInput } from '@/hooks/handoffManagementTypes';
import {
  executeConfirmMedicalSpecialtyNoChanges,
  executeUpdateMedicalHandoffDoctor,
  executeUpdateMedicalSignature,
  executeUpdateMedicalSpecialtyNote,
  type ConfirmMedicalSpecialtyNoChangesOutput,
  type PersistedHandoffRecordOutput,
} from '@/application/handoff';
import {
  buildMedicalNoChangesAuditEvent,
  buildMedicalNoChangesAuditPayload,
  buildMedicalSignatureAuditEvent,
  buildMedicalSpecialtyAuditEvent,
} from '@/hooks/controllers/handoffManagementPersistenceController';
import type { HandoffPersistenceRuntime } from '@/hooks/useHandoffPersistenceRuntime';

export const useMedicalHandoffPersistenceActions = (runtime: HandoffPersistenceRuntime) => {
  const {
    canMutateCurrentMedicalRecord,
    logDebouncedEvent,
    logEvent,
    patchRecord,
    presentSpecialistHistoricalEditError,
    runMutation,
    saveAndUpdate,
  } = runtime;

  const updateMedicalSpecialtyNote = useCallback(
    async (specialty: MedicalSpecialty, value: string, actor: Partial<MedicalHandoffActor>) => {
      if (!canMutateCurrentMedicalRecord()) {
        presentSpecialistHistoricalEditError();
        return;
      }

      await runMutation<PersistedHandoffRecordOutput>(
        record =>
          executeUpdateMedicalSpecialtyNote({
            actor,
            record,
            saveRecord: saveAndUpdate,
            patchRecord,
            specialty,
            value,
          }),
        {
          fallbackMessage: 'No se pudo actualizar la nota médica.',
          fallbackTitle: 'Error al guardar',
        },
        ({ currentRecord }) => {
          const auditEvent = buildMedicalSpecialtyAuditEvent(currentRecord, specialty, value);

          logDebouncedEvent(
            auditEvent.action,
            auditEvent.entityType,
            auditEvent.entityId,
            auditEvent.details,
            undefined,
            auditEvent.recordDate
          );
        }
      );
    },
    [
      canMutateCurrentMedicalRecord,
      logDebouncedEvent,
      patchRecord,
      presentSpecialistHistoricalEditError,
      runMutation,
      saveAndUpdate,
    ]
  );

  const confirmMedicalSpecialtyNoChanges = useCallback(
    async ({ specialty, actor, comment, dateKey }: ConfirmMedicalSpecialtyNoChangesInput) => {
      if (!canMutateCurrentMedicalRecord()) {
        presentSpecialistHistoricalEditError();
        return;
      }

      await runMutation<ConfirmMedicalSpecialtyNoChangesOutput>(
        record =>
          executeConfirmMedicalSpecialtyNoChanges({
            actor,
            comment,
            dateKey,
            record,
            saveRecord: saveAndUpdate,
            patchRecord,
            specialty,
          }),
        {
          fallbackMessage: 'No se pudo confirmar continuidad de la especialidad.',
          fallbackTitle: 'Error al guardar',
          reasonTitles: {
            missing_base_note: 'Sin nota base',
            already_updated_today: 'Ya actualizado hoy',
          },
        },
        ({ currentRecord, data }) => {
          const auditDetails = buildMedicalNoChangesAuditPayload(
            data.updatedRecord,
            specialty,
            actor,
            data.effectiveDateKey,
            data.confirmedAt
          );
          const auditEvent = buildMedicalNoChangesAuditEvent(currentRecord, auditDetails);

          logEvent(
            auditEvent.action,
            auditEvent.entityType,
            auditEvent.entityId,
            auditEvent.details,
            undefined,
            auditEvent.recordDate
          );
        }
      );
    },
    [
      canMutateCurrentMedicalRecord,
      logEvent,
      patchRecord,
      presentSpecialistHistoricalEditError,
      runMutation,
      saveAndUpdate,
    ]
  );

  const updateMedicalSignature = useCallback(
    async (doctorName: string, scope: MedicalHandoffScope = 'all') => {
      await runMutation<PersistedHandoffRecordOutput>(
        record =>
          executeUpdateMedicalSignature({
            doctorName,
            record,
            saveRecord: saveAndUpdate,
            patchRecord,
            scope,
          }),
        {
          fallbackMessage: 'No se pudo registrar la firma médica.',
          fallbackTitle: 'Error al guardar',
        },
        ({ currentRecord, data }) => {
          const auditEvent = buildMedicalSignatureAuditEvent(
            currentRecord,
            data.updatedRecord,
            doctorName,
            scope
          );

          logEvent(
            auditEvent.action,
            auditEvent.entityType,
            auditEvent.entityId,
            auditEvent.details,
            undefined,
            auditEvent.recordDate
          );
        }
      );
    },
    [logEvent, patchRecord, runMutation, saveAndUpdate]
  );

  const updateMedicalHandoffDoctor = useCallback(
    async (doctorName: string): Promise<void> => {
      if (!canMutateCurrentMedicalRecord()) {
        presentSpecialistHistoricalEditError();
        return;
      }

      await runMutation<PersistedHandoffRecordOutput>(
        record =>
          executeUpdateMedicalHandoffDoctor({
            doctorName,
            record,
            saveRecord: saveAndUpdate,
            patchRecord,
          }),
        {
          fallbackMessage: 'No se pudo actualizar el médico de entrega.',
          fallbackTitle: 'Error al guardar',
        }
      );
    },
    [
      canMutateCurrentMedicalRecord,
      patchRecord,
      presentSpecialistHistoricalEditError,
      runMutation,
      saveAndUpdate,
    ]
  );

  return {
    updateMedicalSpecialtyNote,
    confirmMedicalSpecialtyNoChanges,
    updateMedicalSignature,
    updateMedicalHandoffDoctor,
  };
};
