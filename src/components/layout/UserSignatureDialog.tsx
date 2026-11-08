import React, { useRef, useState } from 'react';
import { ImagePlus, PenLine, Trash2 } from 'lucide-react';
import { BaseModal } from '@/components/shared/BaseModal';
import { useUserSignatureImage } from '@/hooks/useUserSignatureImage';
import {
  describeUserSignatureFileProblem,
  userSignatureService,
  type UserSignatureService,
} from '@/services/user-profile/userSignatureService';

interface UserSignatureDialogProps {
  uid: string;
  onClose: () => void;
  service?: UserSignatureService;
}

/** Where a person keeps the signature printed on their own requests. Only they can see it. */
export default function UserSignatureDialog({
  uid,
  onClose,
  service = userSignatureService,
}: UserSignatureDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const signature = useUserSignatureImage(uid, reloadToken, service);

  const run = async (operation: () => Promise<void>, failure: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await operation();
      setReloadToken(token => token + 1);
    } catch {
      setMessage(failure);
    } finally {
      setBusy(false);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    const problem = describeUserSignatureFileProblem(file);
    if (problem) {
      setMessage(problem);
      return;
    }
    void run(() => service.save(uid, file), 'No se pudo guardar la firma.');
  };

  return (
    <BaseModal
      isOpen={true}
      onClose={onClose}
      title="Mi firma"
      icon={<PenLine size={18} />}
      size="sm"
      variant="white"
      closeOnBackdrop={false}
      dataTestId="user-signature-dialog"
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Se imprime en la línea FIRMA de sus solicitudes. Solo usted puede verla.
        </p>
        <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 p-2">
          {signature.status === 'ready' ? (
            <img
              src={signature.url}
              alt="Vista previa de mi firma"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-sm text-slate-500">
              {signature.status === 'loading'
                ? 'Cargando…'
                : signature.status === 'error'
                  ? 'No se pudo cargar su firma.'
                  : 'Aún no tiene una firma guardada.'}
            </span>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          aria-label="Imagen de la firma"
          onChange={event => handleFile(event.target.files?.[0])}
        />

        {message && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {message}
          </div>
        )}

        <p className="text-xs text-slate-500">PNG, JPG o WEBP, de hasta 500 KB.</p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <ImagePlus size={16} />
            {busy ? 'Guardando…' : signature.status === 'ready' ? 'Reemplazar' : 'Subir imagen'}
          </button>
          <button
            type="button"
            onClick={() => void run(() => service.remove(uid), 'No se pudo eliminar la firma.')}
            disabled={busy || signature.status !== 'ready'}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Trash2 size={16} />
            Eliminar
          </button>
        </div>

        <div className="flex justify-end border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100"
          >
            Cerrar
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
