/**
 * Client-side wrappers for the three callable Cloud Functions exposed by
 * `prescriptionAccessFunctions.js`. Lives in the feature so UI components
 * never have to know about the Firebase Functions plumbing.
 */

import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type {
  PrescriptionAssignmentScope,
  PrescriptionRecord,
  PrescriptionType,
} from '@/types/prescriptionTypes';

interface PrescriptionAccessServiceDeps {
  functionsRuntime?: Pick<FunctionsRuntime, 'getFunctions'>;
}

interface ValidatePinPayload {
  pin: string;
}

interface ValidatePinResult {
  valid: true;
}

export interface PrescriptionUploadPatientOption {
  key: string;
  bedId: string;
  patientName: string;
  patientRut: string;
  patientStatus?: 'active' | 'discharge' | 'transfer';
}

interface ListPatientOptionsPayload {
  /** Required when no authenticated clinician role is available (QR flow). */
  pin?: string;
  /** ISO yyyy-mm-dd. Defaults server-side to today when omitted. */
  date?: string;
}

interface ListPatientOptionsResult {
  date: string;
  sourceDate?: string;
  isFallbackFromPreviousDay?: boolean;
  patientOptions: PrescriptionUploadPatientOption[];
}

interface ListReadonlyRecordsPayload {
  /** Required when no authenticated clinician role is available (QR flow). */
  pin?: string;
  /** ISO yyyy-mm-dd. Upload viewer supports today and yesterday. */
  date: string;
}

interface ListReadonlyRecordsResult {
  date: string;
  records: PrescriptionRecord[];
}

interface SubmitPrescriptionPayload {
  /** Required when no authenticated clinician role is available (QR flow). */
  pin?: string;
  prescriptionType: PrescriptionType;
  assignmentScope?: PrescriptionAssignmentScope;
  bedId?: string;
  patientName?: string;
  patientRut?: string;
  notes?: string;
  fullImageBase64: string;
  thumbnailBase64: string;
  fullImageWidth: number;
  fullImageHeight: number;
  uploaderDisplayName?: string;
}

export interface SubmitPrescriptionResult {
  id: string;
  expiresAt: string;
}

interface SetPinPayload {
  newPin: string;
}

const buildService = (
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
) => {
  const getCallable = async <Input, Output>(name: string) => {
    const functions = await functionsRuntime.getFunctions();
    return httpsCallable<Input, Output>(functions, name);
  };

  return {
    async validatePrescriptionAccessPin(payload: ValidatePinPayload): Promise<ValidatePinResult> {
      const callable = await getCallable<ValidatePinPayload, ValidatePinResult>(
        'validatePrescriptionAccessPin'
      );
      const response = await callable(payload);
      return response.data;
    },

    async listPrescriptionUploadPatientOptions(
      payload: ListPatientOptionsPayload
    ): Promise<ListPatientOptionsResult> {
      const callable = await getCallable<ListPatientOptionsPayload, ListPatientOptionsResult>(
        'listPrescriptionUploadPatientOptions'
      );
      const response = await callable(payload);
      return response.data;
    },

    async listPrescriptionUploadReadonlyRecords(
      payload: ListReadonlyRecordsPayload
    ): Promise<ListReadonlyRecordsResult> {
      const callable = await getCallable<ListReadonlyRecordsPayload, ListReadonlyRecordsResult>(
        'listPrescriptionUploadReadonlyRecords'
      );
      const response = await callable(payload);
      return response.data;
    },

    async submitPrescriptionPhoto(
      payload: SubmitPrescriptionPayload
    ): Promise<SubmitPrescriptionResult> {
      const callable = await getCallable<SubmitPrescriptionPayload, SubmitPrescriptionResult>(
        'submitPrescriptionPhoto'
      );
      const response = await callable(payload);
      return response.data;
    },

    async setPrescriptionAccessPin(payload: SetPinPayload): Promise<{ ok: true }> {
      const callable = await getCallable<SetPinPayload, { ok: true }>('setPrescriptionAccessPin');
      const response = await callable(payload);
      return response.data;
    },
  };
};

export const createPrescriptionAccessService = (deps: PrescriptionAccessServiceDeps = {}) =>
  buildService(deps.functionsRuntime);

const defaultService = buildService();
export const validatePrescriptionAccessPin = defaultService.validatePrescriptionAccessPin;
export const listPrescriptionUploadPatientOptions =
  defaultService.listPrescriptionUploadPatientOptions;
export const listPrescriptionUploadReadonlyRecords =
  defaultService.listPrescriptionUploadReadonlyRecords;
export const submitPrescriptionPhoto = defaultService.submitPrescriptionPhoto;
export const setPrescriptionAccessPin = defaultService.setPrescriptionAccessPin;
