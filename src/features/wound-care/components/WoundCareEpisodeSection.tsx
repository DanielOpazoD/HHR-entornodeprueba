import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Printer, QrCode } from 'lucide-react';
import { resolveAdmissionDateFromClinicalEpisodeKey } from '@/domain/clinical-episode/clinicalEpisode';
import { formatSessionDate } from '../controllers/photoGalleryController';
import type { EpisodePhotoGroup } from '../hooks/useWoundCareHistory';
import { ConsentStatus } from './ConsentStatus';
import { PhotoGallery } from './PhotoGallery';
import { PhotoUploadButton } from './PhotoUploadButton';

export interface WoundCareEpisodeSectionProps {
  group: EpisodePhotoGroup;
  readOnly: boolean;
  photosError: string | null;
  consentUploadBlocked: boolean;
  consentUploadBlockedReason: string | null;
  onFileSelected: (file: File) => void;
  onDelete: (photo: {
    id: string;
    storagePath: string;
    thumbnailStoragePath: string;
  }) => Promise<{ success: boolean; error?: string }>;
  onEditDescription?: (
    photoId: string,
    description: string
  ) => Promise<{ success: boolean; error?: string }>;
  onConsentAction: () => void;
  onPrintConsent: () => void;
  onShowMobileQr: () => void;
}

export const WoundCareEpisodeSection: React.FC<WoundCareEpisodeSectionProps> = ({
  group,
  readOnly,
  photosError,
  consentUploadBlocked,
  consentUploadBlockedReason,
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
                disabled={consentUploadBlocked}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-md transition-colors touch-manipulation"
                title={
                  consentUploadBlocked
                    ? consentUploadBlockedReason ||
                      'Reintente la carga para verificar el consentimiento antes de subir uno nuevo'
                    : 'Subir consentimiento firmado'
                }
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
            loadError={photosError}
            hideTopBanner
            onDelete={!readOnly && group.isCurrent ? onDelete : undefined}
            onEditDescription={!readOnly && group.isCurrent ? onEditDescription : undefined}
          />
        </div>
      )}
    </div>
  );
};
