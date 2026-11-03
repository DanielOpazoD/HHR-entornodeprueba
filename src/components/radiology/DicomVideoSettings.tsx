import React from 'react';
import {
  DICOM_VIDEO_FPS,
  type DicomVideoOptions,
  type DicomVideoResolution,
  type DicomVideoSequence,
} from '@/services/radiology/dicomVideoPlan';

/** MP4 options shared by Original, MPR and 3D. Changing one discards the previous video. */
export const DicomVideoSettings: React.FC<{
  value: DicomVideoOptions;
  change: (patch: Partial<DicomVideoOptions>) => void;
  /** Without identification available, the anonymous profile cannot be turned off. */
  identity?: string;
  /** Original keeps its own speed control, shared with cine playback. */
  speed?: boolean;
}> = ({ value, change, identity, speed = false }) => (
  <>
    {speed && (
      <label>
        Velocidad{' '}
        <select
          aria-label="Velocidad del video"
          value={value.fps}
          onChange={event => change({ fps: Number(event.target.value) })}
        >
          {DICOM_VIDEO_FPS.map(fps => (
            <option key={fps} value={fps}>
              {fps} cuadros/s
            </option>
          ))}
        </select>
      </label>
    )}
    <label>
      Secuencia{' '}
      <select
        aria-label="Secuencia del video"
        value={value.sequence}
        onChange={event => change({ sequence: event.target.value as DicomVideoSequence })}
      >
        <option value="loop">Bucle</option>
        <option value="pingpong">Ida y vuelta</option>
      </select>
    </label>
    <label>
      Resolución{' '}
      <select
        aria-label="Resolución del video"
        value={value.resolution}
        onChange={event => change({ resolution: event.target.value as DicomVideoResolution })}
      >
        <option value="720p">Hasta 720p</option>
        <option value="1080p">Hasta 1080p</option>
      </select>
    </label>
    <label title="Sin nombre, RUT ni fecha sobre la imagen ni en el archivo">
      <input
        type="checkbox"
        aria-label="Perfil anónimo"
        checked={value.anonymous || !identity}
        disabled={!identity}
        onChange={event => change({ anonymous: event.target.checked })}
      />{' '}
      Perfil anónimo
    </label>
  </>
);
