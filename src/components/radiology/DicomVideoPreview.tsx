import React, { useState } from 'react';
import type { DicomVideoPreviewState } from './useDicomVideoJob';

/** Download stays hidden until the video plays here and the user confirms reviewing it.
 * Mount with key={preview.url} so each new video needs its own review. */
export const DicomVideoPreview: React.FC<{
  preview: DicomVideoPreviewState;
  discard: () => void;
  failed: (message: string) => void;
}> = ({ preview, discard, failed }) => {
  const [reviewed, setReviewed] = useState(false);
  const [playable, setPlayable] = useState(false);
  return (
    <div className="dicom-cine-preview">
      <video
        aria-label="Vista previa MP4"
        src={preview.url}
        controls
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        onContextMenu={event => event.preventDefault()}
        playsInline
        loop
        preload="auto"
        onLoadedData={() => setPlayable(true)}
        onError={() => {
          setPlayable(false);
          failed('No se pudo reproducir el MP4. No lo descargues.');
        }}
      />
      <p className="dicom-video-summary">
        {preview.summary}
        {preview.notice && ` · ${preview.notice}`}
      </p>
      <p>
        {preview.identified
          ? 'Este video lleva sobre la imagen el nombre, el RUT y la fecha del examen. Revísalo completo antes de descargarlo; no se envía a terceros.'
          : 'Revisa el video completo: los píxeles originales pueden contener datos identificables. No se anonimiza automáticamente ni se envía a terceros.'}
      </p>
      <label>
        <input
          type="checkbox"
          checked={reviewed}
          disabled={!playable}
          onChange={event => setReviewed(event.target.checked)}
        />{' '}
        {preview.identified
          ? 'Revisé el video completo. Incluye nombre, RUT y fecha: lo compartiré solo por canales clínicos autorizados.'
          : 'Revisé el video completo y no contiene datos identificables visibles.'}
      </label>
      {reviewed && playable && (
        <a href={preview.url} download={preview.filename}>
          Descargar MP4
        </a>
      )}
      <button type="button" onClick={discard}>
        Descartar video
      </button>
    </div>
  );
};
