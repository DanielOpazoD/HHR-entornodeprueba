import React, { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { resolvePrescriptionImageDownloadUrl } from '@/features/prescriptions/services/prescriptionStorageImageService';

interface PrescriptionThumbnailProps {
  thumbnailStoragePath: string;
  fullStoragePath: string;
  alt?: string;
  className?: string;
  /**
   * Fired on click. The parent typically opens the lightbox with the
   * resolved full-image URL. The component memoizes the URL after first
   * resolve so the next click is instant.
   */
  onPreview: (fullImageUrl: string) => void;
}

export const PrescriptionThumbnail: React.FC<PrescriptionThumbnailProps> = ({
  thumbnailStoragePath,
  fullStoragePath,
  alt = 'Receta',
  className,
  onPreview,
}) => {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    resolvePrescriptionImageDownloadUrl(thumbnailStoragePath)
      .then(url => {
        if (cancelled) return;
        setThumbUrl(url);
        setError(false);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [thumbnailStoragePath]);

  const handlePreview = async () => {
    if (fullUrl) {
      onPreview(fullUrl);
      return;
    }
    try {
      const url = await resolvePrescriptionImageDownloadUrl(fullStoragePath);
      setFullUrl(url);
      onPreview(url);
    } catch {
      setError(true);
    }
  };

  if (error) {
    return (
      <span
        className={`inline-flex h-12 w-12 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-400 ${className ?? ''}`}
        title="No se pudo cargar la miniatura"
      >
        <ImageOff size={18} />
      </span>
    );
  }

  if (!thumbUrl) {
    return (
      <span
        className={`inline-flex h-12 w-12 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-300 ${className ?? ''}`}
      >
        <Loader2 size={16} className="animate-spin" />
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={handlePreview}
      onDoubleClick={event => event.preventDefault()}
      onContextMenu={event => event.preventDefault()}
      title="Click para ver en grande"
      className={`group relative inline-block h-12 w-12 overflow-hidden rounded-md border border-slate-200 bg-slate-50 hover:border-sky-400 ${className ?? ''}`}
    >
      <img
        src={thumbUrl}
        alt={alt}
        className="h-full w-full object-cover transition-transform group-hover:scale-105"
        draggable={false}
      />
    </button>
  );
};
