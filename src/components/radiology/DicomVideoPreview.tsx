import React, { useState } from 'react';
import type { DicomVideoPreviewState } from './useDicomVideoJob';

/** Download is available once this local preview can be played. */
export const DicomVideoPreview: React.FC<{
  preview: DicomVideoPreviewState;
  discard: () => void;
  failed: (message: string) => void;
}> = ({ preview, discard, failed }) => {
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
      {playable && (
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
