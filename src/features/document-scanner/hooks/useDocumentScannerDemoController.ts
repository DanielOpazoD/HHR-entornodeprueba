import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listPatientOptionsWithPrescriptionPin,
  type QrDocumentPatientOption,
  type QrDocumentPatientOptionsResult,
} from '@/shared/document-intake/qrDocumentAccessService';
import {
  createDocumentScanPdf,
  createDocumentScanUploadImages,
  disposeDocumentScanSession,
  createJscanifyDocumentSession,
  type JscanifyDocumentSession,
} from '../services/jscanifyDocumentScannerService';
import {
  arrayBufferToBase64,
  submitScannedDocument,
} from '../services/documentScannerQueueService';
import type { DocumentScannerDemoPhase } from './documentScannerControllerTypes';
import { useDocumentScannerPageEditor } from './useDocumentScannerPageEditor';

export type { DocumentScannerDemoPhase } from './documentScannerControllerTypes';

const resolvePinAccessErrorMessage = (error: unknown): string => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const message = error instanceof Error ? error.message : '';

  if (
    code === 'functions/internal' ||
    code === 'functions/not-found' ||
    code === 'functions/unavailable' ||
    message.trim().toLowerCase() === 'internal'
  ) {
    return 'El servicio de acceso no está disponible en este entorno. Inicia las funciones locales o usa el ambiente de pruebas desplegado.';
  }

  return message || 'No se pudo validar el PIN.';
};

const buildPdfFileName = (): string => {
  const now = new Date();
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map(value => String(value).padStart(2, '0'))
    .join('-');
  return `documento-escaneado-${day}.pdf`;
};

const downloadBuffer = (buffer: ArrayBuffer, fileName: string): void => {
  const objectUrl = URL.createObjectURL(new Blob([buffer], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
};

const getLocalCalendarDate = (): string => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
};

const isFailedPreconditionError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = String((error as { code?: unknown }).code || '');
  return code === 'failed-precondition' || code === 'functions/failed-precondition';
};

export const createDocumentSubmissionKey = (
  cryptoApi: Pick<Crypto, 'randomUUID'> | null = globalThis.crypto ?? null
): string => {
  if (typeof cryptoApi?.randomUUID === 'function') return cryptoApi.randomUUID();
  return `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random()
    .toString(36)
    .slice(2)}`;
};

export const useDocumentScannerDemoController = () => {
  const sessionRef = useRef<JscanifyDocumentSession | null>(null);
  const mountedRef = useRef(true);
  const operationGenerationRef = useRef(0);
  const [phase, setPhase] = useState<DocumentScannerDemoPhase>('awaiting-pin');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [patientOptions, setPatientOptions] = useState<QrDocumentPatientOption[]>([]);
  const [selectedPatientKey, setSelectedPatientKey] = useState('');
  const [patientOptionsSourceDate, setPatientOptionsSourceDate] = useState<string | null>(null);
  const [isPatientOptionsFallback, setIsPatientOptionsFallback] = useState(false);
  const pinRef = useRef<string | null>(null);
  const patientOptionsRequestDateRef = useRef<string | null>(null);
  const submissionKeyRef = useRef<string | null>(null);
  const submissionAttemptedRef = useRef(false);
  const {
    filterMode,
    previewObjectUrl,
    pageThumbnails,
    cropEditor,
    pageCount,
    selectedPageIndex,
    detectedPageCount,
    refreshReview,
    clearReview,
    addPages,
    openCropEditor,
    cancelCropEditor,
    applyCrop,
    changeFilter,
    selectPage,
    rotatePage,
    redetectBorders,
    movePage,
    deletePage,
  } = useDocumentScannerPageEditor({
    sessionRef,
    mountedRef,
    operationGenerationRef,
    setPhase,
    setErrorMessage,
  });

  const discardSession = useCallback(
    async (session: JscanifyDocumentSession) => {
      if (sessionRef.current === session) {
        sessionRef.current = null;
        submissionKeyRef.current = null;
        submissionAttemptedRef.current = false;
        clearReview();
      }
      await disposeDocumentScanSession(session).catch(() => undefined);
    },
    [clearReview]
  );

  const reset = useCallback(async () => {
    const operationGeneration = operationGenerationRef.current + 1;
    operationGenerationRef.current = operationGeneration;
    clearReview();
    const session = sessionRef.current;
    sessionRef.current = null;
    submissionKeyRef.current = null;
    submissionAttemptedRef.current = false;
    await disposeDocumentScanSession(session).catch(() => undefined);
    if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
    setErrorMessage(null);
    setPhase(pinRef.current ? 'ready' : 'awaiting-pin');
  }, [clearReview]);

  const applyPatientOptionsResult = useCallback((result: QrDocumentPatientOptionsResult) => {
    patientOptionsRequestDateRef.current = result.date;
    setPatientOptions(result.patientOptions);
    setPatientOptionsSourceDate(result.sourceDate ?? result.date);
    setIsPatientOptionsFallback(Boolean(result.isFallbackFromPreviousDay));
  }, []);

  const submitPin = useCallback(
    async (pin: string) => {
      setErrorMessage(null);
      setPhase('loading-patients');
      try {
        const result = await listPatientOptionsWithPrescriptionPin(pin);
        pinRef.current = pin;
        applyPatientOptionsResult(result);
        setSelectedPatientKey('');
        setPhase('ready');
      } catch (error) {
        pinRef.current = null;
        setErrorMessage(resolvePinAccessErrorMessage(error));
        setPhase('awaiting-pin');
      }
    },
    [applyPatientOptionsResult]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      const session = sessionRef.current;
      sessionRef.current = null;
      submissionKeyRef.current = null;
      submissionAttemptedRef.current = false;
      void disposeDocumentScanSession(session).catch(() => undefined);
    };
  }, []);

  const startScanning = useCallback(
    async (files: ReadonlyArray<File>) => {
      const operationGeneration = operationGenerationRef.current + 1;
      operationGenerationRef.current = operationGeneration;
      setErrorMessage(null);
      setPhase('opening');
      let openedSession: JscanifyDocumentSession | null = null;
      try {
        const session = await createJscanifyDocumentSession(files);
        openedSession = session;
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) {
          await disposeDocumentScanSession(session).catch(() => undefined);
          return;
        }
        await disposeDocumentScanSession(sessionRef.current).catch(() => undefined);
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) {
          await disposeDocumentScanSession(session).catch(() => undefined);
          return;
        }
        sessionRef.current = session;
        submissionKeyRef.current = createDocumentSubmissionKey();
        submissionAttemptedRef.current = false;
        const refreshed = await refreshReview(session, 0, operationGeneration);
        if (!refreshed) {
          if (sessionRef.current === session) sessionRef.current = null;
          await disposeDocumentScanSession(session).catch(() => undefined);
          return;
        }
        setPhase('review');
      } catch (error) {
        if (openedSession) await discardSession(openedSession);
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        setErrorMessage(
          error instanceof Error ? error.message : 'No se pudo abrir el escáner de documentos.'
        );
        setPhase('error');
      }
    },
    [discardSession, refreshReview]
  );

  const downloadPdf = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const operationGeneration = operationGenerationRef.current + 1;
    operationGenerationRef.current = operationGeneration;
    setErrorMessage(null);
    setPhase('exporting');
    try {
      const pdf = await createDocumentScanPdf(session);
      if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
      downloadBuffer(pdf, buildPdfFileName());
      setPhase('review');
    } catch (error) {
      if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo generar el PDF del documento.'
      );
      setPhase('review');
    }
  }, []);

  const uploadDocument = useCallback(async () => {
    const session = sessionRef.current;
    const pin = pinRef.current;
    let patient = patientOptions.find(option => option.key === selectedPatientKey);
    let requestDate = patientOptionsRequestDateRef.current;
    let sourceDate = patientOptionsSourceDate;
    const submissionKey = submissionKeyRef.current;
    if (!session || !pin) return;
    if (!patient || !requestDate || !sourceDate || !submissionKey) {
      setErrorMessage('Selecciona la cama y el paciente antes de subir.');
      return;
    }
    const operationGeneration = operationGenerationRef.current + 1;
    operationGenerationRef.current = operationGeneration;
    setErrorMessage(null);
    setPhase('uploading');
    try {
      if (!submissionAttemptedRef.current) {
        const result = await listPatientOptionsWithPrescriptionPin(pin);
        if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
        applyPatientOptionsResult(result);
        const refreshedPatient = result.patientOptions.find(
          option => option.key === selectedPatientKey && option.patientRut === patient?.patientRut
        );
        if (!refreshedPatient) {
          setSelectedPatientKey('');
          throw new Error(
            'El censo se actualizó desde que abriste el escáner. Selecciona nuevamente la cama y el paciente.'
          );
        }
        patient = refreshedPatient;
        requestDate = result.date;
        sourceDate = result.sourceDate ?? result.date;
      }
      const pageImages = await createDocumentScanUploadImages(session);
      submissionAttemptedRef.current = true;
      await submitScannedDocument({
        pin,
        submissionKey,
        requestDate,
        sourceDate,
        patientOptionKey: patient.key,
        expectedPatientRut: patient.patientRut,
        pageCount: session.pages.length,
        pageImagesBase64: pageImages.map(arrayBufferToBase64),
      });
      if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
      clearReview();
      sessionRef.current = null;
      submissionKeyRef.current = null;
      submissionAttemptedRef.current = false;
      await disposeDocumentScanSession(session).catch(() => undefined);
      setPhase('success');
    } catch (error) {
      if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
      if (isFailedPreconditionError(error)) {
        try {
          const result = await listPatientOptionsWithPrescriptionPin(pin);
          if (!mountedRef.current || operationGenerationRef.current !== operationGeneration) return;
          applyPatientOptionsResult(result);
          setSelectedPatientKey('');
          setErrorMessage(
            'El censo cambió durante la carga. Selecciona nuevamente la cama y el paciente.'
          );
          setPhase('review');
          return;
        } catch {
          // Preserve the original clinical validation error when refresh is unavailable.
        }
      }
      setErrorMessage(
        error instanceof Error ? error.message : 'No se pudo subir el documento temporal.'
      );
      setPhase('review');
    }
  }, [
    applyPatientOptionsResult,
    clearReview,
    patientOptions,
    patientOptionsSourceDate,
    selectedPatientKey,
  ]);

  const startAnotherDocument = useCallback(async () => {
    setSelectedPatientKey('');
    setErrorMessage(null);
    const pin = pinRef.current;
    if (pin && patientOptionsRequestDateRef.current !== getLocalCalendarDate()) {
      setPhase('loading-patients');
      try {
        applyPatientOptionsResult(await listPatientOptionsWithPrescriptionPin(pin));
      } catch (error) {
        pinRef.current = null;
        patientOptionsRequestDateRef.current = null;
        setPatientOptions([]);
        setPatientOptionsSourceDate(null);
        setErrorMessage(resolvePinAccessErrorMessage(error));
        setPhase('awaiting-pin');
        return;
      }
    }
    setPhase('ready');
  }, [applyPatientOptionsResult]);

  return {
    phase,
    filterMode,
    previewObjectUrl,
    pageThumbnails,
    selectedPageIndex,
    cropEditor,
    pageCount,
    detectedPageCount,
    errorMessage,
    patientOptions,
    selectedPatientKey,
    patientOptionsSourceDate,
    isPatientOptionsFallback,
    isBusy:
      phase === 'loading-patients' ||
      phase === 'opening' ||
      phase === 'adding-pages' ||
      phase === 'cropping' ||
      phase === 'filtering' ||
      phase === 'editing' ||
      phase === 'exporting' ||
      phase === 'uploading',
    submitPin,
    setSelectedPatientKey,
    startScanning,
    addPages,
    openCropEditor,
    cancelCropEditor,
    applyCrop,
    changeFilter,
    selectPage,
    rotatePage,
    redetectBorders,
    movePage,
    deletePage,
    downloadPdf,
    uploadDocument,
    startAnotherDocument,
    reset,
  };
};
