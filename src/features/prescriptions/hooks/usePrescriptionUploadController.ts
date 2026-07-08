/**
 * Orchestrates the prescription upload form: PIN gate, image compression,
 * payload assembly, and Cloud Function call. Keeps the UI components
 * dumb.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PRESCRIPTION_TYPES,
  type PrescriptionAssignmentScope,
  type PrescriptionType,
} from '@/types/prescriptionTypes';
import {
  compressPrescriptionImage,
  releaseCompressedPrescriptionImagePreview,
  type CompressedPrescriptionImageBundle,
} from '@/features/prescriptions/services/prescriptionImageCompressionService';
import {
  listPrescriptionUploadPatientOptions,
  submitPrescriptionPhoto,
  validatePrescriptionAccessPin,
  type PrescriptionUploadPatientOption,
  type SubmitPrescriptionResult,
} from '@/features/prescriptions/services/prescriptionAccessService';

export type PrescriptionUploadPhase =
  | 'awaiting-pin'
  | 'ready'
  | 'compressing'
  | 'uploading'
  | 'success'
  | 'error';

export interface PrescriptionUploadFormValues {
  prescriptionType: PrescriptionType;
  assignmentScope: PrescriptionAssignmentScope;
  selectedPatientKey: string;
  patientUnassigned: boolean;
}

const initialFormValues: PrescriptionUploadFormValues = {
  prescriptionType: 'comun',
  assignmentScope: 'patient',
  selectedPatientKey: '',
  patientUnassigned: false,
};

export type PrescriptionPatientOption = PrescriptionUploadPatientOption;

export type PrescriptionPatientOptionsPhase = 'loading' | 'ready' | 'error';

export interface UsePrescriptionUploadControllerOptions {
  /**
   * When `true` the user is authenticated as admin/nurse and skips the
   * PIN gate. The controller still requires no auth token; the Cloud
   * Function handles role resolution server-side.
   */
  bypassPinGate?: boolean;
}

export interface PrescriptionUploadControllerHandle {
  phase: PrescriptionUploadPhase;
  values: PrescriptionUploadFormValues;
  patientOptions: PrescriptionPatientOption[];
  patientOptionsPhase: PrescriptionPatientOptionsPhase;
  patientOptionsError: string | null;
  patientOptionsSourceDate: string | null;
  isPatientOptionsFallbackFromPreviousDay: boolean;
  setField: <K extends keyof PrescriptionUploadFormValues>(
    field: K,
    value: PrescriptionUploadFormValues[K]
  ) => void;
  errorMessage: string | null;
  /** Result of the most recent successful upload (id + monthly review date). */
  lastResult: SubmitPrescriptionResult | null;
  /** Validated QR/PIN token used by the readonly upload viewer. Null for authenticated flows. */
  readonlyViewerAccessPin: string | null;
  /** Preview object URL for the currently captured image, if any. */
  previewObjectUrl: string | null;
  /** True when an image has been captured and compressed for submission. */
  hasCompressedImage: boolean;
  /** Submits a PIN to the validation Cloud Function. */
  submitPin: (pin: string) => Promise<void>;
  /** Capture handler for `<input type="file">`. */
  handleImageFile: (file: File) => Promise<void>;
  clearCompressedImage: () => void;
  submitForm: () => Promise<void>;
  /** Resets the form for a fresh upload after a successful one. */
  resetAfterSuccess: () => void;
  prescriptionTypes: typeof PRESCRIPTION_TYPES;
}

const FORM_VALIDATION_ERROR = 'Completa los campos requeridos antes de subir.';
const NO_IMAGE_ERROR = 'Toma o selecciona una foto de la receta antes de subir.';
const NO_PATIENT_SELECTION_ERROR = 'Selecciona una cama/paciente o marca sin paciente asignado.';

const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const usePrescriptionUploadController = ({
  bypassPinGate = false,
}: UsePrescriptionUploadControllerOptions = {}): PrescriptionUploadControllerHandle => {
  const [phase, setPhase] = useState<PrescriptionUploadPhase>(
    bypassPinGate ? 'ready' : 'awaiting-pin'
  );
  const [values, setValues] = useState<PrescriptionUploadFormValues>(initialFormValues);
  const [patientOptions, setPatientOptions] = useState<PrescriptionPatientOption[]>([]);
  const [patientOptionsSourceDate, setPatientOptionsSourceDate] = useState<string | null>(null);
  const [isPatientOptionsFallbackFromPreviousDay, setIsPatientOptionsFallbackFromPreviousDay] =
    useState(false);
  const [patientOptionsPhase, setPatientOptionsPhase] =
    useState<PrescriptionPatientOptionsPhase>('loading');
  const [patientOptionsError, setPatientOptionsError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SubmitPrescriptionResult | null>(null);
  const [readonlyViewerAccessPin, setReadonlyViewerAccessPin] = useState<string | null>(null);
  const compressedRef = useRef<CompressedPrescriptionImageBundle | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [hasCompressedImage, setHasCompressedImage] = useState(false);
  const pinRef = useRef<string | null>(null);

  const loadPatientOptions = useCallback(async () => {
    setPatientOptionsPhase('loading');
    setPatientOptionsError(null);
    try {
      const result = await listPrescriptionUploadPatientOptions({
        pin: pinRef.current ?? undefined,
        date: todayIso(),
      });
      setPatientOptions(result.patientOptions);
      setPatientOptionsSourceDate(result.sourceDate ?? result.date);
      setIsPatientOptionsFallbackFromPreviousDay(Boolean(result.isFallbackFromPreviousDay));
      setPatientOptionsPhase('ready');
    } catch (error) {
      setPatientOptions([]);
      setPatientOptionsSourceDate(null);
      setIsPatientOptionsFallbackFromPreviousDay(false);
      setPatientOptionsError(
        error instanceof Error ? error.message : 'No se pudo cargar el censo diario.'
      );
      setPatientOptionsPhase('error');
    }
  }, []);

  useEffect(() => {
    if (phase !== 'ready') return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void loadPatientOptions();
    });
    return () => {
      cancelled = true;
    };
  }, [loadPatientOptions, phase]);

  useEffect(() => {
    return () => {
      if (compressedRef.current) {
        releaseCompressedPrescriptionImagePreview(compressedRef.current.previewObjectUrl);
        compressedRef.current = null;
      }
    };
  }, []);

  const setField = useCallback(
    <K extends keyof PrescriptionUploadFormValues>(
      field: K,
      value: PrescriptionUploadFormValues[K]
    ) => {
      setValues(prev => {
        const next = { ...prev, [field]: value };
        if (field === 'assignmentScope') {
          next.patientUnassigned = value !== 'patient';
          if (value !== 'patient') next.selectedPatientKey = '';
        }
        if (field === 'patientUnassigned') {
          next.assignmentScope = value ? 'unassigned' : 'patient';
          if (value) next.selectedPatientKey = '';
        }
        return next;
      });
    },
    []
  );

  const submitPin = useCallback(async (pin: string) => {
    setErrorMessage(null);
    try {
      await validatePrescriptionAccessPin({ pin });
      pinRef.current = pin;
      setReadonlyViewerAccessPin(pin);
      setPhase('ready');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo validar el PIN. Reintenta.'
      );
    }
  }, []);

  const clearCompressedImage = useCallback(() => {
    if (compressedRef.current) {
      releaseCompressedPrescriptionImagePreview(compressedRef.current.previewObjectUrl);
      compressedRef.current = null;
    }
    setPreviewObjectUrl(null);
    setHasCompressedImage(false);
  }, []);

  const handleImageFile = useCallback(
    async (file: File) => {
      setErrorMessage(null);
      clearCompressedImage();
      setPhase('compressing');
      try {
        const bundle = await compressPrescriptionImage(file);
        compressedRef.current = bundle;
        setPreviewObjectUrl(bundle.previewObjectUrl);
        setHasCompressedImage(true);
        setPhase('ready');
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'No se pudo procesar la imagen. Reintenta.'
        );
        setPhase('error');
      }
    },
    [clearCompressedImage]
  );

  const submitForm = useCallback(async () => {
    setErrorMessage(null);
    const compressed = compressedRef.current;
    if (!compressed) {
      setErrorMessage(NO_IMAGE_ERROR);
      return;
    }
    if (!values.prescriptionType) {
      setErrorMessage(FORM_VALIDATION_ERROR);
      return;
    }

    const includePatient = values.assignmentScope === 'patient' && !values.patientUnassigned;
    const selectedPatient = includePatient
      ? patientOptions.find(option => option.key === values.selectedPatientKey)
      : null;

    if (includePatient && !selectedPatient) {
      setErrorMessage(NO_PATIENT_SELECTION_ERROR);
      return;
    }

    setPhase('uploading');
    try {
      const result = await submitPrescriptionPhoto({
        pin: pinRef.current ?? undefined,
        prescriptionType: values.prescriptionType,
        assignmentScope: values.assignmentScope,
        bedId: includePatient ? selectedPatient?.bedId : undefined,
        patientName: includePatient ? selectedPatient?.patientName || undefined : undefined,
        patientRut: includePatient ? selectedPatient?.patientRut || undefined : undefined,
        fullImageBase64: compressed.full.base64,
        thumbnailBase64: compressed.thumbnail.base64,
        fullImageWidth: compressed.full.width,
        fullImageHeight: compressed.full.height,
      });
      setLastResult(result);
      setPhase('success');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo subir la receta. Reintenta.'
      );
      setPhase('error');
    }
  }, [patientOptions, values]);

  const resetAfterSuccess = useCallback(() => {
    clearCompressedImage();
    setValues(initialFormValues);
    setLastResult(null);
    setPhase('ready');
  }, [clearCompressedImage]);

  return {
    phase,
    values,
    patientOptions,
    patientOptionsPhase,
    patientOptionsError,
    patientOptionsSourceDate,
    isPatientOptionsFallbackFromPreviousDay,
    setField,
    errorMessage,
    lastResult,
    readonlyViewerAccessPin,
    previewObjectUrl,
    hasCompressedImage,
    submitPin,
    handleImageFile,
    clearCompressedImage,
    submitForm,
    resetAfterSuccess,
    prescriptionTypes: PRESCRIPTION_TYPES,
  };
};
