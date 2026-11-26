import React, { useState } from 'react';
import { Trash2, ImageOff, AlertTriangle, RefreshCw } from 'lucide-react';
import type { WoundCarePhoto } from '@/types/domain/woundCare';
import { groupPhotosByDate } from '@/features/wound-care/use-cases/woundCarePhotoTime';
import {
  formatSessionDate,
  formatPhotoTime,
  formatSessionSummary,
} from '../controllers/photoGalleryController';
import { PhotoLightbox } from './PhotoLightbox';
import { PhotoDeleteConfirm } from './PhotoDeleteConfirm';

interface PhotoGalleryProps {
  photos: WoundCarePhoto[];
  readOnly?: boolean;
  loadError?: string | null;
  isRetrying?: boolean;
  onRetry?: () => void;
  onDelete?: (photo: WoundCarePhoto) => Promise<{ success: boolean; error?: string }>;
  onEditDescription?: (
    photoId: string,
    description: string
  ) => Promise<{ success: boolean; error?: string }>;
}

export const PhotoGallery: React.FC<PhotoGalleryProps> = ({
  photos,
  readOnly = false,
  loadError = null,
  isRetrying = false,
  onRetry,
  onDelete,
  onEditDescription,
}) => {
  const [lightboxPhotoId, setLightboxPhotoId] = useState<string | null>(null);
  const [deletePhoto, setDeletePhoto] = useState<WoundCarePhoto | null>(null);

  const sessions = groupPhotosByDate(photos);

  if (photos.length === 0) {
    if (loadError) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-5 text-center"
        >
          <AlertTriangle className="w-6 h-6 text-amber-600" />
          <p className="text-xs font-medium text-amber-900">{loadError}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
              {isRetrying ? 'Reintentando...' : 'Reintentar'}
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col items-center py-6 text-center">
        <ImageOff className="w-10 h-10 text-slate-200 mb-2" />
        <p className="text-xs text-slate-400">No hay fotografías en esta sesión.</p>
      </div>
    );
  }

  // Build flat list for lightbox navigation (matches display order)
  const allPhotosFlat = sessions.flatMap(s => s.photos);
  const lightboxIndex =
    lightboxPhotoId === null ? -1 : allPhotosFlat.findIndex(p => p.id === lightboxPhotoId);

  const openLightbox = (photo: WoundCarePhoto) => {
    setLightboxPhotoId(photo.id);
  };

  return (
    <>
      <div className="space-y-3">
        {loadError && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900"
          >
            <span className="inline-flex items-center gap-1.5 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              {loadError}
            </span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                disabled={isRetrying}
                className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-60 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`} />
                {isRetrying ? 'Reintentando...' : 'Reintentar'}
              </button>
            )}
          </div>
        )}
        {sessions.map(session => (
          <div key={session.date}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-semibold text-slate-500">
                {formatSessionDate(session.date)}
              </span>
              <span className="text-xs text-slate-400">{formatSessionSummary(session)}</span>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-1.5">
              {session.photos.map(photo => (
                <div key={photo.id} className="relative group">
                  <button
                    type="button"
                    onClick={() => openLightbox(photo)}
                    className="block w-full aspect-square rounded-lg overflow-hidden bg-slate-100 focus:ring-2 focus:ring-sky-500"
                  >
                    <img
                      src={photo.thumbnailDownloadUrl}
                      alt={photo.description || 'Foto de curación'}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  </button>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent pt-4 px-1 pb-0.5">
                    <span className="text-white text-[10px] truncate block">
                      {formatPhotoTime(photo)}
                    </span>
                    {photo.bodyLocation && (
                      <span className="inline-block mt-0.5 text-[9px] bg-white/20 text-white/90 px-1.5 py-px rounded-full truncate max-w-full">
                        {photo.bodyLocation}
                      </span>
                    )}
                  </div>
                  {!readOnly && onDelete && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        setDeletePhoto(photo);
                      }}
                      className="absolute top-0.5 right-0.5 p-1.5 bg-red-500/80 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Eliminar foto"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {lightboxIndex >= 0 && (
        <PhotoLightbox
          photos={allPhotosFlat}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxPhotoId(null)}
          onNavigate={index => {
            const nextPhoto = allPhotosFlat[index];
            if (nextPhoto) setLightboxPhotoId(nextPhoto.id);
          }}
          onEditDescription={!readOnly ? onEditDescription : undefined}
        />
      )}

      {deletePhoto && onDelete && (
        <PhotoDeleteConfirm
          photo={deletePhoto}
          onConfirm={async () => {
            const targetPhoto = deletePhoto;
            const result = await onDelete(targetPhoto);
            if (result.success) {
              setDeletePhoto(current => (current?.id === targetPhoto.id ? null : current));
            }
            return result;
          }}
          onCancel={() => setDeletePhoto(null)}
        />
      )}
    </>
  );
};
