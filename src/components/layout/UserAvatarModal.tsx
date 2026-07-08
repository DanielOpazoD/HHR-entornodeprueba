import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ImagePlus, Trash2 } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { createCenteredAvatarFile } from '@/components/layout/userAvatarImageController';

interface UserAvatarModalProps {
  isOpen: boolean;
  userEmail: string;
  avatarUrl?: string | null;
  isSaving?: boolean;
  onClose: () => void;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => Promise<void>;
}

const resolveInitial = (email: string): string => email.trim().charAt(0).toUpperCase() || 'U';

export const UserAvatarModal: React.FC<UserAvatarModalProps> = ({
  isOpen,
  userEmail,
  avatarUrl,
  isSaving = false,
  onClose,
  onUpload,
  onRemove,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const clearSelection = () => {
    setPreviewUrl(null);
    setSelectedFile(null);
    setError(null);
  };

  const handleSelectFile = async (file: File | null) => {
    setError(null);
    if (!file) {
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    setIsPreparing(true);
    try {
      const avatarFile = await createCenteredAvatarFile(file);
      setSelectedFile(avatarFile);
      setPreviewUrl(URL.createObjectURL(avatarFile));
    } catch (preparationError) {
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setError(
        preparationError instanceof Error
          ? preparationError.message
          : 'No se pudo recortar la imagen seleccionada.'
      );
    } finally {
      setIsPreparing(false);
    }
  };

  const handleClose = () => {
    clearSelection();
    onClose();
  };

  const visibleAvatarUrl = useMemo(() => previewUrl || avatarUrl || null, [avatarUrl, previewUrl]);

  const handleUpload = async () => {
    if (!selectedFile) return;
    setError(null);
    try {
      await onUpload(selectedFile);
      handleClose();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'No se pudo guardar la foto.');
    }
  };

  const handleRemove = async () => {
    setError(null);
    try {
      await onRemove();
      handleClose();
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'No se pudo eliminar la foto.');
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Foto de perfil"
      icon={<Camera size={18} />}
      size="sm"
      variant="white"
      closeOnBackdrop={false}
      dataTestId="user-avatar-modal"
    >
      <div className="space-y-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-28 w-28 overflow-hidden rounded-full border border-slate-200 bg-slate-100 shadow-inner">
            {visibleAvatarUrl ? (
              <img
                src={visibleAvatarUrl}
                alt={`Foto de perfil de ${userEmail}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-4xl font-bold text-slate-500">
                {resolveInitial(userEmail)}
              </div>
            )}
          </div>
          <p className="max-w-full truncate text-sm font-semibold text-slate-700">{userEmail}</p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/*"
          className="hidden"
          onChange={event => {
            void handleSelectFile(event.target.files?.[0] || null);
          }}
        />

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isPreparing || isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
          >
            <ImagePlus size={16} />
            {isPreparing ? 'Preparando...' : 'Elegir imagen'}
          </button>
          <button
            type="button"
            onClick={handleRemove}
            disabled={!avatarUrl || isSaving}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Trash2 size={16} />
            Eliminar
          </button>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={handleClose}
            disabled={isSaving}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || isSaving || isPreparing}
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Guardando...' : 'Guardar foto'}
          </button>
        </div>
      </div>
    </BaseModal>
  );
};
