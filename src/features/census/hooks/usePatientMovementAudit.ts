import { useCallback, useMemo } from 'react';
import { logPatientDischarge, logPatientTransfer } from '@/services/admin/auditService';

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
  const logDischargeEntries = useCallback((entries: DischargeAuditEntry[], recordDate: string) => {
    for (const entry of entries) {
      logPatientDischarge(entry.bedId, entry.patientName, entry.rut, entry.status, recordDate);
    }
  }, []);

  const logTransferEntry = useCallback((entry: TransferAuditEntry, recordDate: string) => {
    logPatientTransfer(
      entry.bedId,
      entry.patientName,
      entry.rut,
      entry.receivingCenter,
      recordDate
    );
  }, []);

  return useMemo(
    () => ({
      logDischargeEntries,
      logTransferEntry,
    }),
    [logDischargeEntries, logTransferEntry]
  );
};
