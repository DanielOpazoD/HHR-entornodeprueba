import { buildDischargeWithActiveTransferConfirmDialog } from '@/features/census/controllers/censusMovementActionConfirmController';
import type { DailyRecord } from '@/features/census/contracts/censusRecordContracts';
import type { PatientData } from '@/features/census/contracts/censusPatientContracts';
import type { DischargeState } from '@/features/census/types/censusActionTypes';
import type { getLatestOpenTransferRequestByBedId } from '@/services/transfers/transferService';
import type { TransferRequest } from '@/types/transferRequestTypes';

interface RunDischargeWithTransferGuardParams {
  dischargeState: DischargeState;
  record: DailyRecord | null;
  executeDischarge: () => Promise<void>;
  runConfirmedMovementAction: (params: {
    dialog: ReturnType<typeof buildDischargeWithActiveTransferConfirmDialog>;
    run: () => Promise<void>;
    errorTitle: string;
  }) => Promise<void>;
  getLatestOpenTransferRequestByBedId: typeof getLatestOpenTransferRequestByBedId;
  warn: (message: string, error: unknown) => void;
}

const normalizeComparable = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase();

const normalizeRut = (value: unknown): string => normalizeComparable(value).replace(/[.\-\s]/g, '');

const sameNonEmpty = (left: string, right: string): boolean =>
  Boolean(left && right && left === right);

export const isTransferRequestForCurrentBedPatient = (
  transfer: TransferRequest,
  patient: PatientData | undefined
): boolean => {
  if (!patient) {
    return false;
  }

  const transferRut = normalizeRut(transfer.patientSnapshot?.rut);
  const patientRut = normalizeRut(patient.rut);
  const transferAdmissionDate = normalizeComparable(transfer.patientSnapshot?.admissionDate);
  const patientAdmissionDate = normalizeComparable(patient.admissionDate || patient.firstSeenDate);

  if (transferRut || patientRut) {
    if (!sameNonEmpty(transferRut, patientRut)) {
      return false;
    }

    if (transferAdmissionDate && patientAdmissionDate) {
      return transferAdmissionDate === patientAdmissionDate;
    }

    return true;
  }

  const transferName = normalizeComparable(transfer.patientSnapshot?.name);
  const patientName = normalizeComparable(patient.patientName);
  if (!sameNonEmpty(transferName, patientName)) {
    return false;
  }

  if (transferAdmissionDate && patientAdmissionDate) {
    return transferAdmissionDate === patientAdmissionDate;
  }

  return true;
};

export const runDischargeWithTransferGuard = async ({
  dischargeState,
  record,
  executeDischarge,
  runConfirmedMovementAction,
  getLatestOpenTransferRequestByBedId,
  warn,
}: RunDischargeWithTransferGuardParams): Promise<void> => {
  const bedId = dischargeState.bedId;

  if (!bedId || dischargeState.recordId) {
    await executeDischarge();
    return;
  }

  try {
    const activeTransfer = await getLatestOpenTransferRequestByBedId(bedId);
    if (!activeTransfer) {
      await executeDischarge();
      return;
    }

    const patient = record?.beds?.[bedId];
    if (!isTransferRequestForCurrentBedPatient(activeTransfer, patient)) {
      await executeDischarge();
      return;
    }

    const patientName = patient?.patientName;

    await runConfirmedMovementAction({
      dialog: buildDischargeWithActiveTransferConfirmDialog(patientName),
      run: executeDischarge,
      errorTitle: 'No se pudo confirmar el alta',
    });
  } catch (error) {
    warn(`[Census Discharge] Failed to validate active transfer context for bed ${bedId}:`, error);
    await executeDischarge();
  }
};
