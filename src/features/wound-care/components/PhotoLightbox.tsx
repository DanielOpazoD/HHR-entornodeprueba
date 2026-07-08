import React, { useEffect, useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Clock,
  User,
  Weight,
  Download,
  Camera,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Pencil,
  Check,
} from 'lucide-react';
import type { WoundCarePhoto } from '@/types/domain/woundCare';
import { formatFileSize, formatCompressionRatio } from '../controllers/photoUploadController';
import { usePhotoLightboxZoom } from '../hooks/usePhotoLightboxZoom';
import { formatDateTimeCL } from '@/utils/dateDisplayUtils';

interface PhotoLightboxProps {
  photos: WoundCarePhoto[];
  currentIndex: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
  onEditDescription?: (photoId: string, description: string) => Promise<void>;
}

const formatDateOnly = (iso: string): string => {
  try {
    const [year, month, day] = iso.split('T')[0].split('-');
    return `${day}-${month}-${year}`;
  } catch {
    return iso;
  }
};

// ============================================================================
// Component
// ============================================================================

export const PhotoLightbox: React.FC<PhotoLightboxProps> = ({
  photos,
  currentIndex,
  onClose,
  onNavigate,
  onEditDescription,
}) => {
  const photo = photos[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < photos.length - 1;

  const dialogRef = useRef<HTMLDivElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [editDesc, setEditDesc] = useState('');
  const zoom = usePhotoLightboxZoom();

  // Reset state on navigation
  useEffect(() => {
    setImageLoaded(false);
    zoom.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex]);

  const goNext = useCallback(() => {
    if (hasNext && !zoom.isZoomed) onNavigate(currentIndex + 1);
  }, [hasNext, currentIndex, onNavigate, zoom.isZoomed]);

  const goPrev = useCallback(() => {
    if (hasPrev && !zoom.isZoomed) onNavigate(currentIndex - 1);
  }, [hasPrev, currentIndex, onNavigate, zoom.isZoomed]);

  // Focus on mount
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Keyboard + focus trap
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose();
          return;
        case 'ArrowRight':
          goNext();
          return;
        case 'ArrowLeft':
          goPrev();
          return;
        case '+':
        case '=':
          zoom.zoomIn();
          return;
        case '-':
          zoom.zoomOut();
          return;
        case '0':
          zoom.reset();
          return;
      }
      if (e.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, a, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [onClose, goNext, goPrev, zoom]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  if (!photo) return null;

  const photoAlt = [
    photo.description || 'Foto de curación',
    photo.bodyLocation ? `Ubicación: ${photo.bodyLocation}` : '',
  ]
    .filter(Boolean)
    .join(' — ');

  const lightboxContent = (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Visor de fotografías de curaciones"
      className="fixed inset-0 z-[9999] bg-black flex flex-col outline-none animate-[fadeIn_200ms_ease-out]"
      style={{ width: '100vw', height: '100vh' }}
      onClick={() => {
        if (!zoom.isZoomed) onClose();
      }}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-3 py-1.5 shrink-0"
        onClick={e => e.stopPropagation()}
      >
        <span className="text-sm text-white/50">
          {currentIndex + 1} / {photos.length}
        </span>
        <div className="flex items-center gap-0.5">
          {/* Zoom controls */}
          <button
            type="button"
            onClick={zoom.zoomIn}
            aria-label="Acercar"
            className="p-2.5 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={zoom.zoomOut}
            aria-label="Alejar"
            disabled={!zoom.isZoomed}
            className="p-2.5 text-white/60 hover:text-white disabled:text-white/20 rounded-full hover:bg-white/10 transition-colors"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          {zoom.isZoomed && (
            <button
              type="button"
              onClick={zoom.reset}
              aria-label="Restablecer zoom"
              className="p-2.5 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors"
            >
              <RotateCcw className="w-5 h-5" />
            </button>
          )}
          <span className="text-[10px] text-white/30 mx-1 w-8 text-center">
            {zoom.scale > 1 ? `${zoom.scale.toFixed(1)}×` : ''}
          </span>
          {/* Download */}
          <a
            href={photo.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Descargar foto"
            className="p-2.5 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          >
            <Download className="w-5 h-5" />
          </a>
          {/* Close */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="p-2.5 text-white/60 hover:text-white rounded-full hover:bg-white/10 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Image area */}
      <div
        className="flex-1 relative flex items-center justify-center min-h-0 overflow-hidden touch-none"
        onClick={e => e.stopPropagation()}
        {...zoom.handlers}
      >
        {/* Nav arrows (hidden when zoomed) */}
        {hasPrev && !zoom.isZoomed && (
          <button
            type="button"
            onClick={goPrev}
            aria-label="Foto anterior"
            className="absolute left-2 sm:left-6 z-10 p-3 text-white/60 hover:text-white bg-black/30 hover:bg-black/60 rounded-full transition-colors touch-manipulation"
          >
            <ChevronLeft className="w-8 h-8" />
          </button>
        )}

        {/* Loading spinner */}
        {!imageLoaded && (
          <div className="absolute inset-0 flex items-center justify-center z-0">
            <div className="w-10 h-10 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
          </div>
        )}

        {/* Photo */}
        <img
          src={photo.downloadUrl}
          alt={photoAlt}
          className={`max-w-[95vw] max-h-[calc(100vh-100px)] object-contain select-none transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
          style={zoom.style}
          draggable={false}
          onLoad={() => setImageLoaded(true)}
          onDoubleClick={() => {
            if (zoom.isZoomed) zoom.reset();
            else zoom.zoomIn();
          }}
        />

        {hasNext && !zoom.isZoomed && (
          <button
            type="button"
            onClick={goNext}
            aria-label="Foto siguiente"
            className="absolute right-2 sm:right-6 z-10 p-3 text-white/60 hover:text-white bg-black/30 hover:bg-black/60 rounded-full transition-colors touch-manipulation"
          >
            <ChevronRight className="w-8 h-8" />
          </button>
        )}
      </div>

      {/* Info bar */}
      <div
        className="w-full px-4 py-2 text-white shrink-0 bg-gradient-to-t from-black/80 to-transparent"
        onClick={e => e.stopPropagation()}
      >
        {/* Editable description */}
        <div className="flex items-start gap-1.5 mb-0.5 min-h-[20px]">
          {isEditingDesc ? (
            <form
              className="flex-1 flex items-center gap-1.5"
              onSubmit={async e => {
                e.preventDefault();
                await onEditDescription?.(photo.id, editDesc);
                setIsEditingDesc(false);
              }}
            >
              <input
                type="text"
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                autoFocus
                placeholder="Agregar descripción..."
                className="flex-1 bg-white/10 text-white text-sm px-2 py-1 rounded border border-white/20 outline-none focus:border-white/50"
                onKeyDown={e => {
                  if (e.key === 'Escape') setIsEditingDesc(false);
                }}
              />
              <button
                type="submit"
                className="p-1.5 text-emerald-400 hover:text-emerald-300 transition-colors"
                aria-label="Guardar descripción"
              >
                <Check className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <>
              <p className="text-sm font-medium flex-1">
                {photo.description || <span className="text-white/30 italic">Sin descripción</span>}
              </p>
              {onEditDescription && (
                <button
                  type="button"
                  onClick={() => {
                    setEditDesc(photo.description || '');
                    setIsEditingDesc(true);
                  }}
                  className="p-1.5 text-white/40 hover:text-white/70 transition-colors shrink-0"
                  aria-label="Editar descripción"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-white/50">
          <span className="inline-flex items-center gap-1 text-white/70 font-medium">
            <Camera className="w-3 h-3" />
            Curación: {formatDateOnly(photo.takenAt)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Subida: {formatDateTimeCL(photo.uploadedAt)}
          </span>
          {photo.bodyLocation && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {photo.bodyLocation}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <User className="w-3 h-3" />
            {photo.uploadedBy.displayName}
          </span>
          <span className="inline-flex items-center gap-1 text-white/30">
            <Weight className="w-3 h-3" />
            {formatFileSize(photo.compressedFileSize)}
            {photo.originalFileSize > 0 && (
              <span className="text-white/20">
                ({formatCompressionRatio(photo.originalFileSize, photo.compressedFileSize)})
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  );

  return createPortal(lightboxContent, document.body);
};
