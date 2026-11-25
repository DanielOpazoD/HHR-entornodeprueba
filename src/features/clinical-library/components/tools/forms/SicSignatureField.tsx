import React, { useEffect, useRef, useState } from 'react';
import { useUserSignatureImage } from '@/hooks/useUserSignatureImage';
import { describeUserSignatureFileProblem } from '@/services/user-profile/userSignatureService';

export const useSicSignature = (uid: string | null) => {
  const saved = useUserSignatureImage(uid);
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [include, setInclude] = useState(true);
  const [error, setError] = useState('');
  const owned = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (owned.current) URL.revokeObjectURL(owned.current);
    },
    []
  );
  const replace = (next: string | null) => {
    if (owned.current) URL.revokeObjectURL(owned.current);
    owned.current = next;
    setLocalUrl(next);
  };
  const attach = (file?: File) => {
    if (!file) return;
    const problem = describeUserSignatureFileProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    replace(URL.createObjectURL(file));
    setInclude(true);
    setError('');
  };
  return {
    saved,
    localUrl,
    include,
    setInclude,
    error,
    attach,
    url: include ? (localUrl ?? saved.url) : null,
    busy: include && !localUrl && saved.status === 'loading',
    failed: include && !localUrl && saved.status === 'error',
    useSaved: () => {
      replace(null);
      setInclude(true);
      setError('');
    },
  };
};

export const SicSignatureField: React.FC<{ signature: ReturnType<typeof useSicSignature> }> = ({
  signature,
}) => (
  <fieldset className="clinical-form-section clinical-form-signature">
    <legend>Firma</legend>
    <div className="clinical-form-signature-row">
      <label className="clinical-form-check">
        <input
          type="checkbox"
          checked={signature.include}
          onChange={event => signature.setInclude(event.target.checked)}
        />
        <span>Adjuntar firma al documento</span>
      </label>
      {signature.url && (
        <img
          src={signature.url}
          alt="Firma seleccionada para esta SIC"
          className="clinical-form-signature-preview"
        />
      )}
      <label className="clinical-form-button clinical-form-signature-upload">
        <span>{signature.url ? 'Cambiar firma' : 'Subir firma'}</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Adjuntar imagen de firma"
          className="sr-only"
          onChange={event => {
            signature.attach(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
      </label>
      {signature.localUrl && (
        <button type="button" className="clinical-form-button" onClick={signature.useSaved}>
          {signature.saved.status === 'ready' ? 'Usar mi firma guardada' : 'Quitar firma'}
        </button>
      )}
    </div>
    {signature.busy && (
      <p role="status" className="clinical-form-muted">
        Cargando firma…
      </p>
    )}
    {signature.failed && (
      <p role="alert" className="clinical-form-notice">
        No se pudo cargar tu firma guardada. Sube una imagen o desmarca la firma.
      </p>
    )}
    {signature.error && (
      <p role="alert" className="clinical-form-notice">
        {signature.error}
      </p>
    )}
  </fieldset>
);
