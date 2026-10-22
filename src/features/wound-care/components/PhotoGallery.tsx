import React, { useState } from 'react';
import { Trash2, ImageOff } from 'lucide-react';
import type { WoundCarePhoto } from '@/types/domain/woundCare';
import { groupPhotosByDate } from '@/application/wound-care/woundCarePhotoTime';
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
  onDelete?: (photo: WoundCarePhoto) => Promise<{ success: boolean; error?: string }>;
  onEditDescription?: (photoId: string, description: string) => Promise<void>;
}

export const PhotoGallery: React.FC<PhotoGalleryProps> = ({
  photos,
  readOnly = false,
  onDelete,
  onEditDescription,
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [deletePhoto, setDeletePhoto] = useState<WoundCarePhoto | null>(null);

  const sessions = groupPhotosByDate(photos);

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center py-6 text-center">
        <ImageOff className="w-10 h-10 text-slate-200 mb-2" />
        <p className="text-xs text-slate-400">No hay fotografías en esta sesión.</p>
      </div>
    );
  }

  // Build flat list for lightbox navigation (matches display order)
  const allPhotosFlat = sessions.flatMap(s => s.photos);

  const openLightbox = (photo: WoundCarePhoto) => {
    const idx = allPhotosFlat.findIndex(p => p.id === photo.id);
    setLightboxIndex(idx >= 0 ? idx : 0);
  };

  return (
    <>
      <div className="space-y-3">
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

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={allPhotosFlat}
          currentIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
          onEditDescription={!readOnly ? onEditDescription : undefined}
        />
      )}

      {deletePhoto && onDelete && (
        <PhotoDeleteConfirm
          photo={deletePhoto}
          onConfirm={async () => {
            await onDelete(deletePhoto);
            setDeletePhoto(null);
          }}
          onCancel={() => setDeletePhoto(null)}
        />
      )}
    </>
  );
};
