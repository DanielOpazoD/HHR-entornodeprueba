import type { PatientData } from '@/types/domain/patient';

import { useCallback, useMemo, useRef, useEffect } from 'react';
import type { DailyRecord } from '@/types/domain/dailyRecord';

import { PatientFieldValue } from '@/types/valueTypes';
import { useAuditContext } from '@/context/AuditContext';
import { resolvePatientChangeAudit } from '@/hooks/controllers/bedAuditController';

export const PATIENT_CLINICAL_AUDIT_DEBOUNCE_MS = 1500;

/**
 * useBedAudit Hook
 *
 * Handles all auditing and logging for bed and patient modifications.
 */
export const useBedAudit = (record: DailyRecord | null) => {
  const { logDebouncedEvent, logEvent, logPatientAdmission } = useAuditContext();
  const recordRef = useRef(record);

  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  /**
   * Audit Logging for patient admission or modification
   */
  const auditPatientChange = useCallback(
    (
      bedId: string,
      field: keyof PatientData,
      oldPatient: PatientData,
      newValue: PatientFieldValue
    ) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const decision = resolvePatientChangeAudit(field, oldPatient, newValue);
      if (!decision) {
        return;
      }

      if (decision.kind === 'admission') {
        logPatientAdmission(bedId, decision.patientName, decision.rut || '', currentRecord.date);
        return;
      }

      if (decision.kind === 'specialty_changed') {
        logEvent(
          'PATIENT_SPECIALTY_CHANGED',
          'patient',
          bedId,
          {
            patientName: decision.patientName,
            bedId,
            field: decision.field,
            changes: {
              [decision.field]: {
                old: decision.oldSpecialty,
                new: decision.newSpecialty,
              },
            },
          },
          decision.patientRut || '',
          currentRecord.date
        );
        return;
      }

      if (decision.kind === 'diagnosis_changed') {
        logDebouncedEvent(
          'PATIENT_DIAGNOSIS_CHANGED',
          'patient',
          bedId,
          {
            patientName: decision.patientName,
            bedId,
            changes: {
              diagnosis: {
                old: decision.oldDiagnosis,
                new: decision.newDiagnosis,
              },
            },
          },
          decision.patientRut,
          currentRecord.date,
          undefined,
          PATIENT_CLINICAL_AUDIT_DEBOUNCE_MS
        );
        return;
      }

      logDebouncedEvent(
        'PATIENT_MODIFIED',
        'patient',
        bedId,
        decision.details,
        decision.patientRut,
        currentRecord.date,
        undefined,
        PATIENT_CLINICAL_AUDIT_DEBOUNCE_MS
      );
    },
    [logDebouncedEvent, logEvent, logPatientAdmission]
  );

  const auditPatientCleared = useCallback(
    (bedId: string, patientName: string, rut?: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      logDebouncedEvent(
        'PATIENT_CLEARED',
        'patient',
        bedId,
        { patientName, bedId },
        rut,
        currentRecord.date
      );
    },
    [logDebouncedEvent]
  );

  const auditPatientModified = useCallback(
    (bedId: string, details: Record<string, unknown>) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const patient = currentRecord.beds[bedId];
      logDebouncedEvent(
        'PATIENT_MODIFIED',
        'patient',
        bedId,
        {
          patientName: patient?.patientName,
          ...details,
        },
        patient?.rut,
        currentRecord.date
      );
    },
    [logDebouncedEvent]
  );

  const auditPatientMovement = useCallback(
    (bedId: string, details: Record<string, unknown>, rut?: string) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const patient = currentRecord.beds[bedId];
      const action = details.movementKind === 'move' ? 'PATIENT_BED_CHANGED' : 'PATIENT_MODIFIED';
      logEvent(
        action,
        'patient',
        bedId,
        {
          patientName: patient?.patientName,
          ...details,
        },
        rut,
        currentRecord.date
      );
    },
    [logEvent]
  );

  return useMemo(
    () => ({
      auditPatientChange,
      auditPatientCleared,
      auditPatientModified,
      auditPatientMovement,
    }),
    [auditPatientChange, auditPatientCleared, auditPatientModified, auditPatientMovement]
  );
};
