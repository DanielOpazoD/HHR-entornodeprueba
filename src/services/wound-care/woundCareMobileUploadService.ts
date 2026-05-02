import { httpsCallable } from 'firebase/functions';
import { defaultFunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';
import type { FunctionsRuntime } from '@/services/firebase-runtime/functionsRuntime';

export interface WoundCareMobileUploadSessionPayload {
  sessionId: string;
  episodeKey: string;
  patientRut: string;
  patientName: string;
  expiresAt: string;
}

export interface WoundCareMobilePhotoUploadInput {
  sessionId: string;
  imageBase64: string;
  thumbnailBase64: string;
  mimeType: string;
  originalFileName: string;
  originalFileSize: number;
  compressedFileSize: number;
  width: number;
  height: number;
  description?: string;
  bodyLocation?: string;
  takenAt?: string;
}

export interface WoundCareMobilePhotoUploadResult {
  photoId: string;
  uploadedAt: string;
}

export const createWoundCareMobileUploadService = (
  functionsRuntime: Pick<FunctionsRuntime, 'getFunctions'> = defaultFunctionsRuntime
) => ({
  validateSession: async (sessionId: string): Promise<WoundCareMobileUploadSessionPayload> => {
    const functions = await functionsRuntime.getFunctions();
    const callable = httpsCallable<{ sessionId: string }, WoundCareMobileUploadSessionPayload>(
      functions,
      'validateWoundCareMobileUploadSession'
    );
    const response = await callable({ sessionId });
    return response.data;
  },

  uploadPhoto: async (
    input: WoundCareMobilePhotoUploadInput
  ): Promise<WoundCareMobilePhotoUploadResult> => {
    const functions = await functionsRuntime.getFunctions();
    const callable = httpsCallable<
      WoundCareMobilePhotoUploadInput & { userAgent?: string },
      WoundCareMobilePhotoUploadResult
    >(functions, 'uploadWoundCareMobilePhoto');
    const response = await callable({
      ...input,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    });
    return response.data;
  },
});

const woundCareMobileUploadService = createWoundCareMobileUploadService();

export const validateWoundCareMobileUploadSession = woundCareMobileUploadService.validateSession;
export const uploadWoundCareMobilePhoto = woundCareMobileUploadService.uploadPhoto;
