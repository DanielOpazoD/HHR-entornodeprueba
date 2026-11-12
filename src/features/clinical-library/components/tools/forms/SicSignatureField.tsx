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
  <fieldset className="clinical-form-section">
    <legend>Firma del profesional</legend>
    <label className="clinical-form-check">
      <input
        type="checkbox"
        checked={signature.include}
        onChange={event => signature.setInclude(event.target.checked)}
      />
      Adjuntar firma al documento
    </label>
    {signature.url && (
      <img
        src={signature.url}
        alt="Firma seleccionada para esta SIC"
        style={{ maxWidth: 240, maxHeight: 80, objectFit: 'contain' }}
      />
    )}
    {signature.busy && <p role="status">Cargando tu firma guardada…</p>}
    {signature.failed && (
      <p role="alert">
        No se pudo cargar tu firma guardada. Adjunta una imagen o desmarca la firma para firmar a
        mano.
      </p>
    )}
    {signature.saved.status === 'none' && !signature.localUrl && (
      <p>No tienes una firma guardada. Puedes adjuntarla aquí o firmar el impreso.</p>
    )}
    <label className="clinical-form-field">
      Adjuntar imagen de firma (PNG, JPG o WEBP; máximo 500 KB)
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        onChange={event => {
          signature.attach(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </label>
    {signature.localUrl && (
      <button type="button" onClick={signature.useSaved}>
        Usar mi firma guardada
      </button>
    )}
    {signature.error && <p role="alert">{signature.error}</p>}
    <p className="clinical-form-muted">
      La imagen adjunta se usa sólo en este formulario. Revisa que corresponda al profesional que
      emite la SIC.
    </p>
  </fieldset>
);
