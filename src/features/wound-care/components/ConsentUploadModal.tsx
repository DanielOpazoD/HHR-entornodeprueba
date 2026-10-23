import React, { useRef, useState } from 'react';
import { ShieldCheck, Upload, FileText, Image as ImageIcon } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import type { EpisodeContext } from '@/application/wound-care/woundCareUseCases';
import type { WoundCareConsent } from '@/types/domain/woundCare';
import { useWoundCareUpload } from '../hooks/useWoundCareUpload';
import { CLINICAL_TIME_ZONE } from '@/utils/clinicalTimeZone';

interface ConsentUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  episodeContext: EpisodeContext;
  existingConsent: WoundCareConsent | null;
}

export const ConsentUploadModal: React.FC<ConsentUploadModalProps> = ({
  isOpen,
  onClose,
  episodeContext,
  existingConsent,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { uploadConsent, isUploading } = useWoundCareUpload();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setSelectedFile(file);

    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    const result = await uploadConsent(selectedFile, episodeContext);
    if (result.success) {
      handleClose();
    } else {
      setError(result.error || 'Error al subir el consentimiento.');
    }
  };

  const handleClose = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  const isViewingExisting = existingConsent?.status === 'signed' && !selectedFile;

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      title="Consentimiento Informado"
      icon={<ShieldCheck className="w-5 h-5" />}
      size="md"
    >
      <div className="space-y-4">
        {/* Legal notice */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
          <p className="font-medium mb-1">Aviso legal</p>
          <p>
            Este consentimiento autoriza la toma de fotografías y videos con fines{' '}
            <strong>exclusivos de registro clínico</strong>.
          </p>
          <p className="mt-1 font-semibold">
            NO autoriza su uso con fines académicos ni de investigación.
          </p>
        </div>

        {/* Existing consent view */}
        {isViewingExisting && existingConsent && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <div className="flex items-center gap-2 text-emerald-700 text-sm font-medium mb-1">
              <ShieldCheck className="w-4 h-4" />
              Consentimiento firmado
            </div>
            <p className="text-xs text-emerald-600">
              Subido el{' '}
              {new Date(existingConsent.uploadedAt).toLocaleDateString('es-CL', {
                timeZone: CLINICAL_TIME_ZONE,
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              por {existingConsent.uploadedBy.displayName}
            </p>
            {existingConsent.consentFileMimeType.startsWith('image/') ? (
              <img
                src={existingConsent.consentFileDownloadUrl}
                alt="Consentimiento firmado"
                className="mt-2 rounded-lg max-h-64 object-contain w-full"
              />
            ) : (
              <a
                href={existingConsent.consentFileDownloadUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex items-center gap-1.5 text-sm text-emerald-700 hover:underline"
              >
                <FileText className="w-4 h-4" />
                Ver documento PDF
              </a>
            )}
          </div>
        )}

        {/* File upload area */}
        {!isViewingExisting && (
          <>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center cursor-pointer hover:border-sky-400 hover:bg-sky-50/30 transition-colors"
            >
              {selectedFile ? (
                <div className="space-y-2">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Vista previa"
                      className="mx-auto max-h-48 rounded-lg object-contain"
                    />
                  ) : (
                    <FileText className="w-12 h-12 mx-auto text-slate-400" />
                  )}
                  <p className="text-sm text-slate-600">{selectedFile.name}</p>
                  <p className="text-xs text-slate-400">
                    {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-center gap-2 text-slate-400">
                    <ImageIcon className="w-8 h-8" />
                    <FileText className="w-8 h-8" />
                  </div>
                  <p className="text-sm text-slate-500">
                    Toque para seleccionar el consentimiento firmado
                  </p>
                  <p className="text-xs text-slate-400">PDF, JPEG, PNG (max 15 MB)</p>
                </div>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFileChange}
              className="hidden"
            />
          </>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Actions */}
        {!isViewingExisting && (
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
              disabled={!selectedFile || isUploading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <Upload className="w-4 h-4" />
              {isUploading ? 'Subiendo...' : 'Subir consentimiento'}
            </button>
          </div>
        )}
      </div>
    </BaseModal>
  );
};
