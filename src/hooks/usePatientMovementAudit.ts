import { useCallback, useMemo } from 'react';
import { useAuditContext } from '@/context/AuditContext';
import {
  buildDischargeDiagnosisChangeAuditDetails,
  buildDischargeReclassificationAuditDetails,
  buildDischargeUndoAuditDetails,
} from '@/services/admin/auditClinicalEventCatalog';
import { isFeatureEnabled } from '@/services/utils/featureFlags';

interface DischargeAuditEntry {
  bedId: string;
  patientName: string;
  rut: string;
  status: 'Vivo' | 'Fallecido';
}

interface TransferAuditEntry {
  bedId: string;
  patientName: string;
  rut: string;
  receivingCenter: string;
}

interface DischargeDiagnosisAuditEntry {
  movementId: string;
  entityType: 'discharge' | 'transfer';
  patientName: string;
  rut?: string;
  movementLabel: string;
  previousDiagnosis?: string;
  nextDiagnosis?: string;
  clinicalEpisodeId?: string;
}

export interface DischargeReclassificationAuditEntry {
  movementId: string;
  previousMovementId: string;
  patientName: string;
  rut?: string;
  from: string;
  to: string;
  lineageId: string;
  clinicalEpisodeId?: string;
}

export const usePatientMovementAudit = () => {
  const { logEvent, logPatientDischarge, logPatientTransfer, userId } = useAuditContext();
  const logDischargeEntries = useCallback(
    (entries: DischargeAuditEntry[], recordDate: string) => {
      // When the canonical discharge facade is on, the modal owns the
      // PATIENT_DISCHARGED audit emission via dispatchCanonicalDischarge
      // (validates anon, returns typed outcome, single audit per
      // entry). The legacy fan-out below would produce duplicates.
      if (isFeatureEnabled('USE_DISCHARGE_PATIENT_COMMAND')) {
        return;
      }
      for (const entry of entries) {
        logPatientDischarge(entry.bedId, entry.patientName, entry.rut, entry.status, recordDate);
      }
    },
    [logPatientDischarge]
  );

  const logTransferEntry = useCallback(
    (entry: TransferAuditEntry, recordDate: string) => {
      // Same pattern as logDischargeEntries: when the canonical
      // transfer facade is on, the modal owns the PATIENT_TRANSFERRED
      // emission via dispatchCanonicalTransfer.
      if (isFeatureEnabled('USE_TRANSFER_PATIENT_COMMAND')) {
        return;
      }
      logPatientTransfer(
        entry.bedId,
        entry.patientName,
        entry.rut,
        entry.receivingCenter,
        recordDate
      );
    },
    [logPatientTransfer]
  );

  const logDischargeUndoEntry = useCallback(
    (
      entry: {
        dischargeId: string;
        bedId: string;
        patientName: string;
        rut?: string;
      },
      recordDate: string
    ) => {
      logEvent(
        'PATIENT_MODIFIED',
        'patient',
        entry.bedId,
        buildDischargeUndoAuditDetails({
          dischargeId: entry.dischargeId,
          patientName: entry.patientName,
          restoredBed: entry.bedId,
        }),
        entry.rut,
        recordDate
      );
    },
    [logEvent]
  );

  const logDischargeDiagnosisChange = useCallback(
    (entry: DischargeDiagnosisAuditEntry, recordDate: string) => {
      logEvent(
        'PATIENT_DISCHARGE_DIAGNOSIS_CHANGED',
        entry.entityType,
        entry.movementId,
        buildDischargeDiagnosisChangeAuditDetails({
          patientName: entry.patientName,
          movementId: entry.movementId,
          movementLabel: entry.movementLabel,
          previousDiagnosis: entry.previousDiagnosis,
          nextDiagnosis: entry.nextDiagnosis,
          clinicalEpisodeId: entry.clinicalEpisodeId,
        }),
        entry.rut,
        recordDate
      );
    },
    [logEvent]
  );

  const logDischargeReclassification = useCallback(
    (entry: DischargeReclassificationAuditEntry, recordDate: string) => {
      logEvent(
        'PATIENT_DISCHARGE_RECLASSIFIED',
        'patient',
        entry.movementId,
        buildDischargeReclassificationAuditDetails(entry),
        entry.rut,
        recordDate
      );
    },
    [logEvent]
  );

  return useMemo(
    () => ({
      logDischargeEntries,
      logDischargeDiagnosisChange,
      logDischargeReclassification,
      logDischargeUndoEntry,
      logTransferEntry,
      actor: userId,
    }),
    [
      logDischargeEntries,
      logDischargeDiagnosisChange,
      logDischargeReclassification,
      logDischargeUndoEntry,
      logTransferEntry,
      userId,
    ]
  );
};
