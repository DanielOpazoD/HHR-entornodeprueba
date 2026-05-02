import React, { useState, useEffect, useCallback } from 'react';
import { Camera, Upload, Calendar } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { EpisodeContext } from '@/application/wound-care/woundCareUseCases';
import { useWoundCareUpload } from '../hooks/useWoundCareUpload';
import { BODY_LOCATION_OPTIONS } from '../domain/woundCareValidation';
import {
  formatFileSize,
  formatReadonlyUploadDateTime,
  toClinicalDatetimeLocalValue,
  toClinicalEventIso,
} from '../controllers/photoUploadController';

interface PhotoUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: File | null;
  episodeContext: EpisodeContext;
}

export const PhotoUploadModal: React.FC<PhotoUploadModalProps> = ({
  isOpen,
  onClose,
  file,
  episodeContext,
}) => {
  const [description, setDescription] = useState('');
  const [bodyLocation, setBodyLocation] = useState('');
  const [eventDateTime, setEventDateTime] = useState(() => toClinicalDatetimeLocalValue());
  const [error, setError] = useState<string | null>(null);
  const { uploadPhoto, isUploading, progress } = useWoundCareUpload();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const updatePreview = useCallback((f: File | null) => {
    setPreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return f ? URL.createObjectURL(f) : null;
    });
  }, []);

  useEffect(() => {
    updatePreview(file);
    return () =>
      setPreviewUrl(prev => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const handleUpload = async () => {
    if (!file) return;

    setError(null);
    const result = await uploadPhoto(file, episodeContext, {
      description: description.trim() || undefined,
      bodyLocation: bodyLocation || undefined,
      takenAt: toClinicalEventIso(eventDateTime),
    });

    if (result.success) {
      handleClose();
    } else {
      setError(result.error || 'Error al subir la fotografía.');
    }
  };

  const handleClose = () => {
    setDescription('');
    setBodyLocation('');
    setEventDateTime(toClinicalDatetimeLocalValue());
    setError(null);
    onClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Subir Foto de Curación"
      icon={<Camera className="w-5 h-5" />}
      size="md"
    >
      <div className="space-y-4">
        {/* Image preview + file info */}
        {previewUrl && (
          <div className="space-y-1.5">
            <div className="rounded-lg overflow-hidden bg-slate-100">
              <img src={previewUrl} alt="Vista previa" className="w-full max-h-64 object-contain" />
            </div>
            {file && (
              <p className="text-xs text-slate-400">
                {formatFileSize(file.size)} — se comprimirá automáticamente
              </p>
            )}
          </div>
        )}

        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Fecha de subida
          </p>
          <p className="text-sm text-slate-700">{formatReadonlyUploadDateTime()}</p>
        </div>

        {/* Event datetime picker */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            <Calendar className="w-3.5 h-3.5 inline mr-1" />
            Fecha del evento clínico
          </label>
          <input
            type="datetime-local"
            value={eventDateTime}
            onChange={e => setEventDateTime(e.target.value)}
            max={toClinicalDatetimeLocalValue()}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          />
          <p className="mt-1 text-xs text-slate-400">
            Use esta fecha si la curación fue realizada antes de subir la foto.
          </p>
        </div>

        {/* Body location */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Ubicación corporal
          </label>
          <select
            value={bodyLocation}
            onChange={e => setBodyLocation(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
          >
            <option value="">Seleccionar...</option>
            {BODY_LOCATION_OPTIONS.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Descripción (opcional)
          </label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Ej: Curación de herida operatoria, día 3 post-op..."
            rows={2}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-sky-500 focus:border-sky-500 resize-none"
          />
        </div>

        {/* Progress */}
        {isUploading && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-slate-500">
              <span>{progress?.message}</span>
            </div>
            <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 rounded-full animate-pulse"
                style={{ width: '100%' }}
              />
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Actions */}
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
            disabled={!file || isUploading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 disabled:text-white/50 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            <Upload className="w-4 h-4" />
            {isUploading ? 'Subiendo...' : 'Subir fotografía'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
