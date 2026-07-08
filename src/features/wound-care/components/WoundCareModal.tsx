import React, { useState } from 'react';
import { Camera, FileText, Printer, ChevronDown, ChevronRight, QrCode } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import {
  executeUpdatePhotoDescription,
  type EpisodeContext,
} from '@/application/wound-care/woundCareUseCases';
import { useWoundCareHistory, type EpisodePhotoGroup } from '../hooks/useWoundCareHistory';
import { useWoundCareUpload } from '../hooks/useWoundCareUpload';
import { ConsentStatus } from './ConsentStatus';
import { ConsentUploadModal } from './ConsentUploadModal';
import { PhotoUploadButton } from './PhotoUploadButton';
import { PhotoUploadModal } from './PhotoUploadModal';
import { generateConsentPdf } from '../services/consentPdfGenerator';
import { defaultBrowserWindowRuntime } from '@/shared/runtime/browserWindowRuntimeCore';
import { WoundCareToast } from './WoundCareToast';
import { PhotoGallery } from './PhotoGallery';
import { WoundCareErrorBoundary } from './WoundCareErrorBoundary';
import { formatSessionDate } from '../controllers/photoGalleryController';
import { WoundCareMobileQrPanel } from './WoundCareMobileQrPanel';
import { resolveAdmissionDateFromClinicalEpisodeKey } from '@/application/patient-flow/clinicalEpisode';

// ============================================================================
// Episode Section (collapsible per hospitalization)
// ============================================================================

interface EpisodeSectionProps {
  group: EpisodePhotoGroup;
  readOnly: boolean;
  onFileSelected: (file: File) => void;
  onDelete: (photo: {
    id: string;
    storagePath: string;
    thumbnailStoragePath: string;
  }) => Promise<{ success: boolean; error?: string }>;
  onEditDescription?: (photoId: string, description: string) => Promise<void>;
  onConsentAction: () => void;
  onPrintConsent: () => void;
  onShowMobileQr: () => void;
}

const EpisodeSection: React.FC<EpisodeSectionProps> = ({
  group,
  readOnly,
  onFileSelected,
  onDelete,
  onEditDescription,
  onConsentAction,
  onPrintConsent,
  onShowMobileQr,
}) => {
  const [isExpanded, setIsExpanded] = useState(group.isCurrent);

  const admissionDate = resolveAdmissionDateFromClinicalEpisodeKey(group.episodeKey) || '';
  const label = group.isCurrent
    ? `Hospitalización actual (${formatSessionDate(admissionDate)})`
    : `Hospitalización ${formatSessionDate(admissionDate)}`;

  return (
    <div
      className={`rounded-lg overflow-hidden ${group.isCurrent ? 'border border-sky-200 bg-white' : 'border border-slate-100 bg-slate-50/30'}`}
    >
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center gap-1.5 px-3 py-2 transition-colors text-left ${group.isCurrent ? 'bg-sky-50/50 hover:bg-sky-50' : 'hover:bg-slate-50'}`}
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
        )}
        <span className="text-[13px] font-medium text-slate-700 flex-1">{label}</span>
        {group.photos.length > 0 && (
          <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-600">
            {group.photos.length} foto{group.photos.length > 1 ? 's' : ''}
          </span>
        )}
        {group.consent && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">
            <FileText className="w-2.5 h-2.5" />
            CI
          </span>
        )}
      </button>

      {isExpanded && (
        <div className="px-3 py-2.5 space-y-2.5 border-t border-slate-100 bg-white">
          {/* Actions for current episode — compact toolbar */}
          {group.isCurrent && !readOnly && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <PhotoUploadButton onFileSelected={onFileSelected} />
              <button
                type="button"
                onClick={onShowMobileQr}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-sky-700 hover:bg-sky-50 rounded-md transition-colors touch-manipulation"
                title="Ver QR para carga móvil"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Ver QR</span>
              </button>
              <div className="w-px h-5 bg-slate-200 mx-0.5" />
              <button
                type="button"
                onClick={onConsentAction}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors touch-manipulation"
                title="Subir consentimiento firmado"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Subir CI</span>
              </button>
              <button
                type="button"
                onClick={onPrintConsent}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors touch-manipulation"
                title="Imprimir formulario de consentimiento"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Imprimir CI</span>
              </button>
              {group.consent?.status === 'signed' && (
                <ConsentStatus consent={group.consent} onAction={onConsentAction} readOnly />
              )}
            </div>
          )}

          {/* Previous episode: view-only consent status */}
          {!group.isCurrent && group.consent?.status === 'signed' && (
            <ConsentStatus consent={group.consent} onAction={onConsentAction} readOnly />
          )}

          <PhotoGallery
            photos={group.photos}
            readOnly={readOnly || !group.isCurrent}
            onDelete={!readOnly && group.isCurrent ? onDelete : undefined}
            onEditDescription={!readOnly && group.isCurrent ? onEditDescription : undefined}
          />
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Main Modal
// ============================================================================

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const { episodes, isLoading, reload } = useWoundCareHistory({
    patientRut: isOpen ? patientRut : undefined,
    currentEpisodeKey: episodeContext.episodeKey,
  });
  const { deletePhoto } = useWoundCareUpload();

  const handleFileSelected = (file: File) => {
    setSelectedFile(file);
    setShowPhotoModal(true);
  };

  const handleDeletePhoto = async (photo: {
    id: string;
    storagePath: string;
    thumbnailStoragePath: string;
  }) => {
    const result = await deletePhoto(photo.id, photo.storagePath, photo.thumbnailStoragePath);
    if (result.success) {
      reload();
      showToast('Foto eliminada');
    }
    return result;
  };

  const showToast = (msg: string) => setToastMessage(msg);

  const handleEditDescription = async (photoId: string, description: string) => {
    await executeUpdatePhotoDescription(photoId, description);
    reload();
    showToast('Descripción actualizada');
  };

  const currentConsent = episodes.find(e => e.isCurrent)?.consent ?? null;

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
            ) : episodes.length === 0 ? (
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
            ) : (
              <>
                {showMobileQr && !readOnly && (
                  <WoundCareMobileQrPanel episodeContext={episodeContext} />
                )}
                {episodes.map(group => (
                  <EpisodeSection
                    key={group.episodeKey}
                    group={group}
                    readOnly={readOnly}
                    onFileSelected={handleFileSelected}
                    onDelete={handleDeletePhoto}
                    onEditDescription={handleEditDescription}
                    onConsentAction={() => setShowConsentModal(true)}
                    onPrintConsent={handlePrintConsent}
                    onShowMobileQr={() => setShowMobileQr(current => !current)}
                  />
                ))}
              </>
            )}
          </div>
        </WoundCareErrorBoundary>
      </BaseModal>

      {showConsentModal && (
        <ConsentUploadModal
          isOpen
          onClose={() => {
            setShowConsentModal(false);
            reload();
            showToast('Consentimiento guardado');
          }}
          episodeContext={episodeContext}
          existingConsent={currentConsent}
        />
      )}

      {showPhotoModal && (
        <PhotoUploadModal
          isOpen
          onClose={() => {
            setShowPhotoModal(false);
            setSelectedFile(null);
            reload();
            showToast('Foto subida exitosamente');
          }}
          file={selectedFile}
          episodeContext={episodeContext}
        />
      )}

      {toastMessage && (
        <WoundCareToast message={toastMessage} onDismiss={() => setToastMessage(null)} />
      )}
    </>
  );
};
