import { useCallback, useRef, useEffect } from 'react';
import type { DailyRecord } from '@/application/shared/dailyRecordCoreContracts';
import { PatientData } from '@/hooks/contracts/patientHookContracts';
import type { CudyrScore } from '@/types/domain/cudyr';
import { PatientFieldValue } from '@/types/valueTypes';
import { useAuditContext } from '@/context/AuditContext';
import { getAttributedAuthors } from '@/services/admin/attributionService';
import {
  buildCribCudyrAuditDetails,
  buildCudyrAuditDetails,
  resolvePatientChangeAudit,
} from '@/hooks/controllers/bedAuditController';

/**
 * useBedAudit Hook
 *
 * Handles all auditing and logging for bed and patient modifications.
 */
export const useBedAudit = (record: DailyRecord | null) => {
  const { logCudyrModified, logDebouncedEvent, logEvent, logPatientAdmission, userId } =
    useAuditContext();
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

      logDebouncedEvent(
        'PATIENT_MODIFIED',
        'patient',
        bedId,
        decision.details,
        decision.patientRut,
        currentRecord.date
      );
    },
    [logDebouncedEvent, logEvent, logPatientAdmission]
  );

  const auditCudyrChange = useCallback(
    (bedId: string, field: keyof CudyrScore, value: number) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const payload = buildCudyrAuditDetails(currentRecord, bedId, field, value);
      if (!payload) return;
      const authors = getAttributedAuthors(userId, currentRecord);

      logCudyrModified(
        bedId,
        payload.patientName,
        payload.patientRut || '',
        String(payload.details.field),
        Number(payload.details.value),
        Number(payload.details.oldValue),
        currentRecord.date,
        authors
      );
    },
    [logCudyrModified, userId]
  );

  const auditCribCudyrChange = useCallback(
    (bedId: string, field: keyof CudyrScore, value: number) => {
      const currentRecord = recordRef.current;
      if (!currentRecord) return;
      const payload = buildCribCudyrAuditDetails(currentRecord, bedId, field, value);
      if (!payload) return;
      const authors = getAttributedAuthors(userId, currentRecord);

      logCudyrModified(
        String(payload.details.bedId),
        payload.patientName,
        payload.patientRut || '',
        String(payload.details.field),
        Number(payload.details.value),
        Number(payload.details.oldValue),
        currentRecord.date,
        authors
      );
    },
    [logCudyrModified, userId]
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
      logEvent(
        'PATIENT_MODIFIED',
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

  return {
    auditPatientChange,
    auditCudyrChange,
    auditCribCudyrChange,
    auditPatientCleared,
    auditPatientModified,
    auditPatientMovement,
  };
};
