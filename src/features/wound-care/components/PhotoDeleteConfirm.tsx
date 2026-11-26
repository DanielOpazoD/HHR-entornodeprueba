import React, { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { WoundCarePhoto } from '@/types/domain/woundCare';

interface PhotoDeleteConfirmProps {
  photo: WoundCarePhoto;
  onConfirm: () => Promise<{ success: boolean; error?: string }>;
  onCancel: () => void;
}

export const PhotoDeleteConfirm: React.FC<PhotoDeleteConfirmProps> = ({
  photo,
  onConfirm,
  onCancel,
}) => {
  const isMountedRef = useRef(true);
  const isSubmittingRef = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleConfirm = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setError(null);
    setIsDeleting(true);
    try {
      const result = await onConfirm();
      if (!isMountedRef.current) return;
      if (!result.success) {
        setError(result.error || 'No se pudo eliminar la fotografía.');
      }
    } catch (unknownError) {
      if (!isMountedRef.current) return;
      setError(
        unknownError instanceof Error ? unknownError.message : 'No se pudo eliminar la fotografía.'
      );
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) {
        setIsDeleting(false);
      }
    }
  };

  return (
    <BaseModal
      isOpen={true}
      onClose={onCancel}
      title="Eliminar fotografía"
      icon={<Trash2 className="w-5 h-5" />}
      size="sm"
    >
      <div className="space-y-4">
        <div className="flex gap-3">
          <img
            src={photo.thumbnailDownloadUrl}
            alt="Foto a eliminar"
            className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
          />
          <div className="text-sm text-slate-600">
            <p>Esta acción eliminará la fotografía del registro.</p>
            <p className="text-xs text-slate-400 mt-1">
              El equipo técnico puede recuperar la imagen si es necesario.
            </p>
            {photo.description && (
              <p className="mt-1 text-xs text-slate-400">{photo.description}</p>
            )}
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-slate-300 rounded-lg transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {isDeleting ? 'Eliminando...' : 'Eliminar'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
