import { useCallback, useMemo } from 'react';
import { useAuditContext } from '@/context/AuditContext';
import { buildDischargeUndoAuditDetails } from '@/services/admin/auditClinicalEventCatalog';

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

export const usePatientMovementAudit = () => {
  const { logEvent, logPatientDischarge, logPatientTransfer } = useAuditContext();
  const logDischargeEntries = useCallback(
    (entries: DischargeAuditEntry[], recordDate: string) => {
      for (const entry of entries) {
        logPatientDischarge(entry.bedId, entry.patientName, entry.rut, entry.status, recordDate);
      }
    },
    [logPatientDischarge]
  );

  const logTransferEntry = useCallback(
    (entry: TransferAuditEntry, recordDate: string) => {
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

  return useMemo(
    () => ({
      logDischargeEntries,
      logDischargeUndoEntry,
      logTransferEntry,
    }),
    [logDischargeEntries, logDischargeUndoEntry, logTransferEntry]
  );
};
