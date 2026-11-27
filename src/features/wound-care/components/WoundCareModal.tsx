import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Camera, QrCode, RefreshCw } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import {
  executeUpdatePhotoDescription,
  type EpisodeContext,
} from '@/features/wound-care/use-cases/woundCareUseCases';
import { useWoundCareHistory } from '../hooks/useWoundCareHistory';
import { useWoundCareUpload } from '../hooks/useWoundCareUpload';
import {
  ConsentUploadModal,
  hasInFlightConsentUpload,
  subscribeConsentUploadCompletions,
  subscribeConsentUploadState,
} from './ConsentUploadModal';
import { PhotoUploadButton } from './PhotoUploadButton';
import { PhotoUploadModal, subscribePhotoUploadCompletions } from './PhotoUploadModal';
import { generateConsentPdf } from '../services/consentPdfGenerator';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { WoundCareToast } from './WoundCareToast';
import { WoundCareErrorBoundary } from './WoundCareErrorBoundary';
import { WoundCareMobileQrPanel } from './WoundCareMobileQrPanel';
import { WoundCareEpisodeSection } from './WoundCareEpisodeSection';
import { resolveAdmissionDateFromClinicalEpisodeKey } from '@/domain/clinical-episode/clinicalEpisode';
import { useChangedOnRender } from '@/hooks/useChangedOnRender';

interface WoundCareRetryAlertProps {
  message: string;
  isRetrying: boolean;
  onRetry: () => void;
}

const WoundCareRetryAlert: React.FC<WoundCareRetryAlertProps> = ({
  message,
  isRetrying,
  onRetry,
}) => (
  <div
    role="alert"
    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900"
  >
    <span className="inline-flex items-center gap-1.5 font-medium">
      <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
      {message}
    </span>
    <button
      type="button"
      onClick={onRetry}
      disabled={isRetrying}
      className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60 transition-colors"
    >
      <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
      {isRetrying ? 'Reintentando...' : 'Reintentar'}
    </button>
  </div>
);

// ============================================================================
// Main Modal
// ============================================================================

// Deduplicate in-flight photo deletes across modal remounts for the same photo ID.
const inFlightPhotoDeletes = new Map<string, Promise<{ success: boolean; error?: string }>>();

interface WoundCareModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientName: string;
  patientRut: string;
  episodeContext: EpisodeContext;
  readOnly?: boolean;
}

export const WoundCareModal: React.FC<WoundCareModalProps> = ({
  isOpen,
  onClose,
  patientName,
  patientRut,
  episodeContext,
  readOnly = false,
}) => {
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [showMobileQr, setShowMobileQr] = useState(false);
  const [selectedPhotoDraft, setSelectedPhotoDraft] = useState<{
    file: File;
    episodeKey: string;
  } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const scopeReset = useChangedOnRender([patientRut, isOpen]);
  if (
    scopeReset &&
    (!isOpen || showConsentModal || showPhotoModal || showMobileQr || selectedPhotoDraft)
  ) {
    setShowConsentModal(false);
    setShowPhotoModal(false);
    setShowMobileQr(false);
    setSelectedPhotoDraft(null);
  }
  const activeScopeRef = useRef({
    mounted: true,
    isOpen,
    patientRut,
  });

  useEffect(() => {
    activeScopeRef.current = {
      mounted: true,
      isOpen,
      patientRut,
    };
  }, [isOpen, patientRut]);

  useEffect(() => {
    return () => {
      activeScopeRef.current = {
        ...activeScopeRef.current,
        mounted: false,
      };
    };
  }, []);

  const {
    episodes,
    isLoading,
    isRefreshingPhotos,
    isRefreshingConsents,
    photosError,
    consentsError,
    reload,
    reloadConsents,
    applyPhotoDescription,
    applyDeletedPhoto,
    applyUploadedPhoto,
    applyUploadedConsent,
  } = useWoundCareHistory({
    patientRut: isOpen ? patientRut : undefined,
    currentEpisodeKey: episodeContext.episodeKey,
  });
  const { deletePhoto } = useWoundCareUpload();

  const handleFileSelected = (file: File) => {
    setSelectedPhotoDraft({ file, episodeKey: episodeContext.episodeKey });
    setShowPhotoModal(true);
  };

  const showToast = (msg: string) => setToastMessage(msg);

  const isSameActivePatient = (targetPatientRut: string) =>
    activeScopeRef.current.mounted &&
    activeScopeRef.current.isOpen &&
    activeScopeRef.current.patientRut === targetPatientRut;

  const handleDeletePhoto = async (photo: {
    id: string;
    storagePath: string;
    thumbnailStoragePath: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const requestPatientRut = patientRut;
    let requestPromise = inFlightPhotoDeletes.get(photo.id);
    if (!requestPromise) {
      requestPromise = (async () => {
        try {
          return await deletePhoto(photo.id, photo.storagePath, photo.thumbnailStoragePath);
        } catch (unknownError) {
          return {
            success: false,
            error:
              unknownError instanceof Error
                ? unknownError.message
                : 'No se pudo eliminar la fotografía.',
          };
        } finally {
          inFlightPhotoDeletes.delete(photo.id);
        }
      })();
      inFlightPhotoDeletes.set(photo.id, requestPromise);
    }

    const result = await requestPromise;
    if (result.success && isSameActivePatient(requestPatientRut)) {
      applyDeletedPhoto(photo.id);
      reload();
      showToast('Foto eliminada');
    }
    return result;
  };

  const handleEditDescription = async (
    photoId: string,
    description: string
  ): Promise<{ success: boolean; error?: string }> => {
    const requestPatientRut = patientRut;
    try {
      const outcome = await executeUpdatePhotoDescription(photoId, description);
      if (outcome.status === 'success') {
        if (isSameActivePatient(requestPatientRut)) {
          applyPhotoDescription(photoId, description);
          reload();
          showToast('Descripción actualizada');
        }
        return { success: true };
      }
      return {
        success: false,
        error:
          outcome.issues[0]?.userSafeMessage ||
          outcome.issues[0]?.message ||
          'No se pudo actualizar la descripción.',
      };
    } catch (unknownError) {
      return {
        success: false,
        error:
          unknownError instanceof Error
            ? unknownError.message
            : 'No se pudo actualizar la descripción.',
      };
    }
  };

  useEffect(() => {
    const unsubscribeConsentCompletions = subscribeConsentUploadCompletions(event => {
      if (!isSameActivePatient(event.patientRut)) return;
      if (event.consent) {
        applyUploadedConsent(event.consent);
      }
      reloadConsents();
      showToast('Consentimiento guardado');
    });
    const unsubscribePhotoCompletions = subscribePhotoUploadCompletions(event => {
      if (!isSameActivePatient(event.patientRut)) return;
      if (event.photo) {
        applyUploadedPhoto(event.photo);
      }
      reload();
      showToast('Foto subida exitosamente');
    });
    return () => {
      unsubscribeConsentCompletions();
      unsubscribePhotoCompletions();
    };
  }, [applyUploadedConsent, applyUploadedPhoto, reload, reloadConsents]);

  const currentConsent = episodes.find(e => e.isCurrent)?.consent ?? null;
  const isConsentUploadInFlight = useSyncExternalStore(
    subscribeConsentUploadState,
    () => hasInFlightConsentUpload(episodeContext.episodeKey),
    () => false
  );
  const consentUploadBlocked = Boolean(
    (consentsError || isRefreshingConsents || isConsentUploadInFlight) &&
    currentConsent?.status !== 'signed'
  );
  const consentUploadBlockedReason = isConsentUploadInFlight
    ? 'Hay un consentimiento subiéndose para esta hospitalización.'
    : isRefreshingConsents
      ? 'Verificando el estado del consentimiento informado...'
      : consentsError;

  const handlePrintConsent = async () => {
    const admissionDate = resolveAdmissionDateFromClinicalEpisodeKey(episodeContext.episodeKey);
    const blobUrl = await generateConsentPdf({ patientName, patientRut, admissionDate });
    defaultBrowserWindowRuntime.open(blobUrl);
  };

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title={
          <span className="truncate">
            <Camera className="w-4 h-4 inline mr-1.5" />
            Registro clínico audiovisual — {patientName}
          </span>
        }
        size="lg"
        variant="white"
        bodyClassName="p-4 space-y-3"
        scrollableBody
      >
        <WoundCareErrorBoundary patientName={patientName}>
          <div className="space-y-3">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-slate-200 border-t-sky-500 rounded-full animate-spin" />
                <p className="text-sm text-slate-400 mt-3">Cargando historial...</p>
              </div>
            ) : (
              <>
                {consentsError && (
                  <WoundCareRetryAlert
                    message={consentsError}
                    isRetrying={isRefreshingConsents}
                    onRetry={reloadConsents}
                  />
                )}

                {photosError && (
                  <WoundCareRetryAlert
                    message={photosError}
                    isRetrying={isRefreshingPhotos}
                    onRetry={() => reload({ preserveInFlightConsents: true })}
                  />
                )}

                {episodes.length === 0 ? (
                  !photosError && (
                    <div className="text-center py-10">
                      <div className="w-12 h-12 mx-auto mb-2.5 rounded-full bg-slate-50 flex items-center justify-center">
                        <Camera className="w-6 h-6 text-slate-300" />
                      </div>
                      <p className="text-sm font-medium text-slate-500">Sin registro audiovisual</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Las fotos de curaciones aparecerán aquí
                      </p>
                      {!readOnly && (
                        <div className="mt-3 inline-flex items-center gap-1.5">
                          <PhotoUploadButton onFileSelected={handleFileSelected} />
                          <button
                            type="button"
                            onClick={() => setShowMobileQr(current => !current)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-md transition-colors"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>Ver QR</span>
                          </button>
                        </div>
                      )}
                      {showMobileQr && !readOnly && (
                        <div className="mt-3 text-left">
                          <WoundCareMobileQrPanel episodeContext={episodeContext} />
                        </div>
                      )}
                    </div>
                  )
                ) : (
                  <>
                    {showMobileQr && !readOnly && (
                      <WoundCareMobileQrPanel episodeContext={episodeContext} />
                    )}
                    {episodes.map(group => (
                      <WoundCareEpisodeSection
                        key={group.episodeKey}
                        group={group}
                        readOnly={readOnly}
                        photosError={photosError}
                        consentUploadBlocked={group.isCurrent ? consentUploadBlocked : false}
                        consentUploadBlockedReason={
                          group.isCurrent ? consentUploadBlockedReason : null
                        }
                        onFileSelected={handleFileSelected}
                        onDelete={handleDeletePhoto}
                        onEditDescription={handleEditDescription}
                        onConsentAction={() => {
                          if (!consentUploadBlocked) setShowConsentModal(true);
                        }}
                        onPrintConsent={handlePrintConsent}
                        onShowMobileQr={() => setShowMobileQr(current => !current)}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        </WoundCareErrorBoundary>
      </BaseModal>

      {showConsentModal && (
        <ConsentUploadModal
          isOpen
          onClose={() => setShowConsentModal(false)}
          onUploaded={consent => {
            if (!isSameActivePatient(patientRut)) return false;
            if (consent) {
              applyUploadedConsent(consent);
            }
            reloadConsents();
            showToast('Consentimiento guardado');
            return true;
          }}
          uploadBlocked={Boolean(
            (consentsError || isRefreshingConsents) && currentConsent?.status !== 'signed'
          )}
          uploadBlockedReason={
            isRefreshingConsents
              ? 'Verificando el estado del consentimiento informado...'
              : consentsError
          }
          isRetryingVerification={isRefreshingConsents}
          onRetryVerification={reloadConsents}
          episodeContext={episodeContext}
          existingConsent={currentConsent}
        />
      )}

      {showPhotoModal && (
        <PhotoUploadModal
          isOpen
          onClose={() => {
            setShowPhotoModal(false);
            setSelectedPhotoDraft(null);
          }}
          onUploaded={photo => {
            if (!isSameActivePatient(patientRut)) return false;
            if (photo) {
              applyUploadedPhoto(photo);
            }
            reload();
            showToast('Foto subida exitosamente');
            return true;
          }}
          file={selectedPhotoDraft?.file ?? null}
          draftEpisodeKey={selectedPhotoDraft?.episodeKey}
          episodeContext={episodeContext}
        />
      )}

      {toastMessage && (
        <WoundCareToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      )}
    </>
  );
};
