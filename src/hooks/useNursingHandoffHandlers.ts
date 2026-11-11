import type { PatientData } from '@/types/domain/patient';

import { useCallback } from 'react';
import type { AuditAction } from '@/types/auditActionTypes';
import type { AuditLogEntry } from '@/types/auditLogTypes';

import type { PatientFieldValue } from '@/types/valueTypes';
import type { NursingShift } from './useHandoffVisibility';
import { buildNursingNoteChangePlan } from '@/hooks/controllers/handoffNursingNoteController';

interface UseNursingHandoffHandlersParams {
  isMedical: boolean;
  selectedShift: NursingShift;
  record: { date: string; beds: Record<string, PatientData> } | null;
  updatePatient: (bedId: string, field: keyof PatientData, value: PatientFieldValue) => void;
  updatePatientMultiple: (bedId: string, fields: Partial<PatientData>) => void;
  updateClinicalCrib: (
    bedId: string,
    field: keyof PatientData | 'create' | 'remove',
    value?: PatientFieldValue
  ) => void;
  updateClinicalCribMultiple: (bedId: string, fields: Partial<PatientData>) => void;
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
}

export const useNursingHandoffHandlers = ({
  isMedical,
  selectedShift,
  record,
  updatePatient,
  updatePatientMultiple,
  updateClinicalCrib,
  updateClinicalCribMultiple,
  logDebouncedEvent,
}: UseNursingHandoffHandlersParams) => {
  const handleNursingNoteChange = useCallback(
    async (bedId: string, value: string, isNested: boolean = false) => {
      if (!record || isMedical) return;

      const bed = record.beds[bedId];
      const nursingNoteChangePlan = buildNursingNoteChangePlan({
        selectedShift,
        isNested,
        bed,
      });
      const noteFields = Object.fromEntries(
        Object.keys(nursingNoteChangePlan.noteFields).map(key => [key, value])
      ) as Partial<PatientData>;

      if (nursingNoteChangePlan.usesMultipleUpdate) {
        if (isNested) {
          updateClinicalCribMultiple(bedId, noteFields);
        } else {
          updatePatientMultiple(bedId, noteFields);
        }
      } else if (isNested) {
        updateClinicalCrib(bedId, 'handoffNoteNightShift', value);
      } else {
        updatePatient(bedId, 'handoffNoteNightShift', value);
      }

      const patient = isNested ? bed?.clinicalCrib : bed;
      if (!patient) return;

      logDebouncedEvent(
        'NURSE_HANDOFF_MODIFIED',
        'patient',
        bedId,
        {
          patientName: patient.patientName || (isNested ? 'Cuna' : 'ANONYMOUS'),
          shift: selectedShift,
          note: value,
          changes: {
            [nursingNoteChangePlan.noteKey]: {
              old: nursingNoteChangePlan.oldNote,
              new: value,
            },
          },
        },
        patient.rut,
        record.date,
        undefined,
        30000
      );
    },
    [
      isMedical,
      selectedShift,
      record,
      updateClinicalCrib,
      updateClinicalCribMultiple,
      updatePatient,
      updatePatientMultiple,
      logDebouncedEvent,
    ]
  );

  const handleClinicalEventAdd = useCallback(() => undefined, []);

  const handleClinicalEventUpdate = useCallback(() => undefined, []);

  const handleClinicalEventDelete = useCallback(() => undefined, []);

  return {
    handleNursingNoteChange,
    handleClinicalEventAdd,
    handleClinicalEventUpdate,
    handleClinicalEventDelete,
  };
};
