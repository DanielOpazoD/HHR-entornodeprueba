import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Upload,
  FileText,
  Image as ImageIcon,
} from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { EpisodeContext } from '@/features/wound-care/use-cases/woundCareUseCases';
import type { WoundCareConsent } from '@/types/domain/woundCare';
import { useWoundCareUpload } from '../hooks/useWoundCareUpload';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

// Guard against concurrent duplicate consent uploads for the same hospitalization episode,
// even if the modal is closed and reopened or remounted on another bed while a write is in flight.
const inFlightConsentEpisodeKeys = new Set<string>();
const consentUploadStateListeners = new Set<() => void>();
const consentUploadCompletionListeners = new Set<
  (event: { patientRut: string; episodeKey: string; consent?: WoundCareConsent }) => void
>();

export const subscribeConsentUploadCompletions = (
  listener: (event: { patientRut: string; episodeKey: string; consent?: WoundCareConsent }) => void
): (() => void) => {
  consentUploadCompletionListeners.add(listener);
  return () => {
    consentUploadCompletionListeners.delete(listener);
  };
};

export const subscribeConsentUploadState = (listener: () => void): (() => void) => {
  consentUploadStateListeners.add(listener);
  return () => {
    consentUploadStateListeners.delete(listener);
  };
};

export const hasInFlightConsentUpload = (episodeKey: string): boolean =>
  inFlightConsentEpisodeKeys.has(episodeKey);

const emitConsentUploadState = () => {
  for (const listener of consentUploadStateListeners) {
    listener();
  }
};

interface ConsentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploaded?: (consent?: WoundCareConsent) => boolean | void;
  onUploadStateChange?: (episodeKey: string, inFlight: boolean) => void;
  uploadBlocked?: boolean;
  uploadBlockedReason?: string | null;
  isRetryingVerification?: boolean;
  onRetryVerification?: () => void;
  episodeContext: EpisodeContext;
  existingConsent: WoundCareConsent | null;
}

export const ConsentUploadModal: React.FC<ConsentUploadModalProps> = ({
  isOpen,
  onClose,
  onUploaded,
  onUploadStateChange,
  uploadBlocked = false,
  uploadBlockedReason = null,
  isRetryingVerification = false,
  onRetryVerification,
  episodeContext,
  existingConsent,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef(true);
  const isSubmittingRef = useRef(false);
  const activePatientRutRef = useRef(episodeContext.patientRut);
  const [selectedDraft, setSelectedDraft] = useState<{ file: File; episodeKey: string } | null>(
    null
  );
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { uploadConsent, cancelPendingRetries, isUploading } = useWoundCareUpload();
  const isBusy = isUploading || isSubmitting;
  const selectedFile =
    selectedDraft && selectedDraft.episodeKey === episodeContext.episodeKey
      ? selectedDraft.file
      : null;
  const hasSignedConsent = existingConsent?.status === 'signed';
  const isUploadLocked =
    uploadBlocked || hasSignedConsent || inFlightConsentEpisodeKeys.has(episodeContext.episodeKey);

  const episodeChanged = useChangedOnRender([episodeContext.episodeKey]);
  if (episodeChanged && !isBusy) {
    setSelectedDraft(null);
    setPreviewUrl(null);
    setError(null);
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    activePatientRutRef.current = episodeContext.patientRut;
  }, [episodeContext.patientRut]);

  useEffect(() => {
    if (!selectedFile && fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isBusy || isUploadLocked) return;
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setSelectedDraft({ file, episodeKey: episodeContext.episodeKey });

    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  const handleClose = () => {
    cancelPendingRetries?.();
    setSelectedDraft(null);
    setPreviewUrl(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  const handleUpload = async () => {
    if (
      !selectedDraft ||
      selectedDraft.episodeKey !== episodeContext.episodeKey ||
      isSubmittingRef.current ||
      uploadBlocked ||
      hasSignedConsent
    ) {
      return;
    }

    const requestEpisodeContext = episodeContext;
    const requestPatientRut = requestEpisodeContext.patientRut;
    const requestEpisodeKey = requestEpisodeContext.episodeKey;

    if (inFlightConsentEpisodeKeys.has(requestEpisodeKey)) {
      setError('Ya hay un consentimiento subiéndose para esta hospitalización.');
      return;
    }

    inFlightConsentEpisodeKeys.add(requestEpisodeKey);
    emitConsentUploadState();
    onUploadStateChange?.(requestEpisodeKey, true);
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await uploadConsent(selectedDraft.file, requestEpisodeContext);
      if (result.success) {
        const handledByParent =
          activePatientRutRef.current === requestPatientRut &&
          onUploaded?.(result.data ?? undefined) === true;
        if (!handledByParent) {
          for (const listener of consentUploadCompletionListeners) {
            listener({
              patientRut: requestPatientRut,
              episodeKey: requestEpisodeKey,
              consent: result.data ?? undefined,
            });
          }
        }
        if (isMountedRef.current) {
          handleClose();
        }
      } else if (isMountedRef.current && activePatientRutRef.current === requestPatientRut) {
        setError(result.error || 'Error al subir el consentimiento.');
      }
    } catch (unknownError) {
      if (!isMountedRef.current || activePatientRutRef.current !== requestPatientRut) return;
      setError(
        unknownError instanceof Error ? unknownError.message : 'Error al subir el consentimiento.'
      );
    } finally {
      inFlightConsentEpisodeKeys.delete(requestEpisodeKey);
      emitConsentUploadState();
      onUploadStateChange?.(requestEpisodeKey, false);
      isSubmittingRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  // A verified signed consent always supersedes any local unsent draft.
  const isViewingExisting = hasSignedConsent && !isBusy;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Consentimiento Informado"
      icon={<ShieldCheck className="w-5 h-5" />}
      size="md"
    >
      <div className="space-y-4">
        {/* Legal notice */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          <p className="font-medium mb-1">Aviso legal</p>
          <p>
            Este consentimiento autoriza la toma de fotografías y videos con fines{' '}
            <strong>exclusivos de registro clínico</strong>.
          </p>
          <p className="mt-1 font-semibold">
            NO autoriza su uso con fines académicos ni de investigación.
          </p>
        </div>

        {/* Existing consent view */}
        {isViewingExisting && existingConsent && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium mb-1">
              <ShieldCheck className="w-4 h-4" />
              Consentimiento firmado
            </div>
            <p className="text-xs text-emerald-600">
              Subido el{' '}
              {new Date(existingConsent.uploadedAt).toLocaleDateString('es-CL', {
                timeZone: CLINICAL_TIME_ZONE,
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              por {existingConsent.uploadedBy.displayName}
            </p>
            {existingConsent.consentFileMimeType.startsWith('image/') ? (
              <img
                src={existingConsent.consentFileDownloadUrl}
                alt="Consentimiento firmado"
                className="mt-2 rounded-lg max-h-64 object-contain w-full"
              />
            ) : (
              <a
                href={existingConsent.consentFileDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline"
              >
                <FileText className="w-4 h-4" />
                Ver documento PDF
              </a>
            )}
          </div>
        )}

        {/* Verification failure or in-progress verification banner when modal is already open */}
        {!isViewingExisting && !isBusy && uploadBlocked && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"
          >
            <span className="inline-flex items-center gap-1.5 font-medium">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              {uploadBlockedReason ||
                'No fue posible verificar el consentimiento informado. Reintente antes de subir.'}
            </span>
            {onRetryVerification && (
              <button
                type="button"
                onClick={onRetryVerification}
                disabled={isRetryingVerification}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${isRetryingVerification ? 'animate-spin' : ''}`} />
                {isRetryingVerification ? 'Reintentando...' : 'Reintentar'}
              </button>
            )}
          </div>
        )}

        {/* File upload area */}
        {!isViewingExisting && (
          <>
            <div
              onClick={() => {
                if (!isBusy && !isUploadLocked) fileInputRef.current?.click();
              }}
              aria-disabled={isBusy || isUploadLocked}
              className={`border-2 border-dashed border-slate-300 rounded-lg p-6 text-center transition-colors ${
                isBusy || isUploadLocked
                  ? 'opacity-60 cursor-not-allowed'
                  : 'cursor-pointer hover:border-sky-400 hover:bg-sky-50/30'
              }`}
            >
              {selectedFile ? (
                <div className="space-y-2">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Vista previa"
                      className="mx-auto max-h-48 rounded-lg object-contain"
                    />
                  ) : (
                    <FileText className="w-12 h-12 mx-auto text-slate-400" />
                  )}
                  <p className="text-sm text-slate-600">{selectedFile.name}</p>
                  <p className="text-xs text-slate-400">
                    {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-center gap-2 text-slate-400">
                    <ImageIcon className="w-8 h-8" />
                    <FileText className="w-8 h-8" />
                  </div>
                  <p className="text-sm text-slate-500">
                    Toque para seleccionar el consentimiento firmado
                  </p>
                  <p className="text-xs text-slate-400">PDF, JPEG, PNG (max 15 MB)</p>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              disabled={isBusy || isUploadLocked}
              onChange={handleFileChange}
              className="hidden"
            />
          </>
        )}

        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {/* Actions */}
        {!isViewingExisting && (
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!selectedFile || isBusy || isUploadLocked}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              {isBusy ? 'Subiendo...' : 'Subir consentimiento'}
            </button>
          </div>
        )}
      </div>
    </BaseModal>
  );
};
