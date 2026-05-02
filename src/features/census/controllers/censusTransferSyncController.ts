import {
  RECEIVING_CENTER_EXTRASYSTEM,
  RECEIVING_CENTER_OTHER,
} from '@/constants/clinicalMovementConstants';
import type { TransferExecutionInput } from '@/features/census/domain/movements/contracts';
import type { PatientData } from '@/features/census/controllers/censusActionPatientContracts';
import type {
  completeTransferWithResult,
  createFinalizedTransferRequestWithResult,
  getLatestOpenTransferRequestByBedId,
} from '@/services/transfers/transferService';

type CompleteTransferResult = Awaited<ReturnType<typeof completeTransferWithResult>>;
type CreateFinalizedTransferResult = Awaited<
  ReturnType<typeof createFinalizedTransferRequestWithResult>
>;

export const resolveTransferDestinationHospital = (
  receivingCenter: string,
  receivingCenterOther: string
): string => {
  const otherValue = receivingCenterOther.trim();
  if (
    receivingCenter === RECEIVING_CENTER_OTHER ||
    receivingCenter === RECEIVING_CENTER_EXTRASYSTEM
  ) {
    return otherValue || receivingCenter;
  }
  return receivingCenter;
};

export const resolveTransferCurrentDiagnosis = (patient: PatientData): string => {
  const pathology = patient.pathology?.trim();
  if (pathology) {
    return pathology;
  }

  const cie10Description = patient.cie10Description?.trim();
  if (cie10Description) {
    return cie10Description;
  }

  const cie10Code = patient.cie10Code?.trim();
  if (cie10Code) {
    return cie10Code;
  }

  const diagnosisComment = patient.diagnosisComments?.trim();
  if (diagnosisComment) {
    return diagnosisComment;
  }

  return 'Sin diagnóstico';
};

export const buildTransferPatientSnapshot = (patient: PatientData, recordDate: string) => ({
  name: patient.patientName || 'Paciente sin nombre',
  rut: patient.rut || 'Sin RUT',
  age: Number.parseInt(patient.age || '', 10) || 0,
  birthDate: patient.birthDate,
  sex: patient.biologicalSex === 'Masculino' ? ('M' as const) : ('F' as const),
  diagnosis: resolveTransferCurrentDiagnosis(patient),
  secondaryDiagnoses: patient.diagnosisComments ? [patient.diagnosisComments] : undefined,
  admissionDate: patient.admissionDate || recordDate,
});

const assertTransferCompletionSucceeded = (result: CompleteTransferResult): void => {
  if (result.status === 'success') {
    return;
  }

  throw new Error(result.userSafeMessage || 'No se pudo completar el traslado.');
};

const assertFinalizedTransferCreationSucceeded = (result: CreateFinalizedTransferResult): void => {
  if (result.status === 'success') {
    return;
  }

  throw new Error(result.userSafeMessage || 'No se pudo crear el traslado finalizado.');
};

interface SyncCensusTransferRequestParams {
  bedId: string;
  patient: PatientData;
  recordDate?: string;
  data?: TransferExecutionInput;
  destinationHospital: string;
  createdByEmail: string;
  getLatestOpenTransferRequestByBedId: typeof getLatestOpenTransferRequestByBedId;
  createFinalizedTransferRequestWithResult: typeof createFinalizedTransferRequestWithResult;
  completeTransferWithResult: typeof completeTransferWithResult;
}

export const syncCensusTransferRequest = async ({
  bedId,
  patient,
  recordDate,
  data,
  destinationHospital,
  createdByEmail,
  getLatestOpenTransferRequestByBedId,
  createFinalizedTransferRequestWithResult,
  completeTransferWithResult,
}: SyncCensusTransferRequestParams): Promise<void> => {
  const requestDate = (data?.movementDate || recordDate || new Date().toISOString()).split('T')[0];
  const linkedRequest = await getLatestOpenTransferRequestByBedId(bedId, {
    referenceDate: requestDate,
  });
  if (linkedRequest) {
    const completionResult = await completeTransferWithResult(linkedRequest.id, createdByEmail);
    assertTransferCompletionSucceeded(completionResult);
    return;
  }

  // No prior request exists: create it directly as TRANSFERRED in the history collection.
  // The patient was already moved from census, so an active REQUESTED intermediate row is misleading.
  const creationResult = await createFinalizedTransferRequestWithResult(
    {
      patientId: bedId,
      bedId,
      patientSnapshot: buildTransferPatientSnapshot(patient, recordDate || requestDate),
      destinationHospital,
      transferReason: 'Traslado registrado desde Censo Diario',
      requestingDoctor: '',
      observations: 'Traslado registrado automáticamente desde Censo Diario.',
      customFields: {
        source: 'census_transfer_autocreate',
      },
      status: 'TRANSFERRED',
      requestDate,
      createdBy: createdByEmail,
    },
    createdByEmail
  );
  assertFinalizedTransferCreationSucceeded(creationResult);
};
