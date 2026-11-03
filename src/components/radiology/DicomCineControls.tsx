import React, { useState } from 'react';
import { Film, Play, Square } from 'lucide-react';
import type { DicomRuntime } from '@/services/radiology/dicomRuntimeTypes';
import {
  abortableDicomTask,
  playDicomCine,
  validateCineOptions,
} from '@/services/radiology/dicomCine';
import {
  DICOM_VIDEO_FPS,
  defaultDicomVideoOptions,
  sequenceDicomPositions,
  sliceDicomPositions,
  type DicomVideoOptions,
} from '@/services/radiology/dicomVideoPlan';
import { toDicomVideoOutput, useDicomVideoJob } from './useDicomVideoJob';
import { DicomVideoPreview } from './DicomVideoPreview';
import { DicomVideoSettings } from './DicomVideoSettings';
import './dicomCine.css';

export const DicomCineControls: React.FC<{
  runtime: DicomRuntime;
  total: number;
  available: Array<[number, number]>;
  disabled: boolean;
  complete: boolean;
  busyChanged: (value: boolean) => void;
  /** Name, RUT and study date; burned in only if the user turns the anonymous profile off. */
  identity?: string;
}> = ({ runtime, total, available, disabled, complete, busyChanged, identity }) => {
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(total);
  const [video, setVideo] = useState(() => defaultDicomVideoOptions(10));
  const job = useDicomVideoJob(runtime, busyChanged);
  const run = (exportVideo: boolean) => {
    if (job.busy || disabled || (exportVideo && !complete)) return;
    const options = { start: start - 1, end: end - 1, fps: video.fps };
    const identified = !video.anonymous && Boolean(identity);
    void job.run(async (signal, update) => {
      validateCineOptions(options, total);
      if (
        !exportVideo &&
        !complete &&
        !available.some(([from, to]) => options.start >= from && options.end <= to)
      )
        throw new Error('Para cine parcial, selecciona un intervalo continuo disponible.');
      // Playback ends on its last cut; an export returns to the cut shown before it.
      const session = runtime.openCine({ restoreSlice: exportVideo });
      try {
        if (!exportVideo) {
          await playDicomCine(session, options, total, signal, update);
          return;
        }
        const { exportDicomMp4 } = await abortableDicomTask(
          import('@/services/radiology/dicomMp4'),
          signal
        );
        signal.throwIfAborted();
        const positions = sequenceDicomPositions(
          sliceDicomPositions(options.start, options.end, total),
          video.sequence
        );
        const result = await exportDicomMp4(
          session,
          positions,
          {
            fps: video.fps,
            resolution: video.resolution,
            identity: identified ? identity : undefined,
          },
          signal,
          update
        );
        return toDicomVideoOutput(result, video.fps, identified, 'secuencia-dicom.mp4');
      } finally {
        session.close();
      }
    }, 'No se pudo completar el cine.');
  };
  const changeVideo = (patch: Partial<DicomVideoOptions>) => {
    job.discard();
    setVideo(current => ({ ...current, ...patch }));
  };
  const changeRange = (action: () => void) => {
    job.discard();
    action();
  };
  return (
    <details className="dicom-cine">
      <summary aria-label="Cine / MP4" title="Cine / MP4">
        <Film size={15} /> Cine / MP4 {job.busy && '· En curso'}
      </summary>
      <div className="dicom-cine-panel">
        <fieldset disabled={disabled || job.busy}>
          <label>
            Desde{' '}
            <input
              aria-label="Corte inicial"
              type="number"
              min={1}
              max={total}
              value={start}
              onChange={e => changeRange(() => setStart(Number(e.target.value)))}
            />
          </label>
          <label>
            Hasta{' '}
            <input
              aria-label="Corte final"
              type="number"
              min={1}
              max={total}
              value={end}
              onChange={e => changeRange(() => setEnd(Number(e.target.value)))}
            />
          </label>
          <label>
            Velocidad{' '}
            <select
              aria-label="Velocidad cine"
              value={video.fps}
              onChange={e => changeVideo({ fps: Number(e.target.value) })}
            >
              {DICOM_VIDEO_FPS.map(value => (
                <option key={value} value={value}>
                  {value} cortes/s
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => run(false)}>
            <Play size={14} /> Reproducir
          </button>
        </fieldset>
        <fieldset disabled={disabled || job.busy} aria-label="Opciones de MP4">
          <DicomVideoSettings value={video} change={changeVideo} identity={identity} />
          <button type="button" disabled={!complete} onClick={() => run(true)}>
            Generar MP4
          </button>
        </fieldset>
        {!complete && available.length > 0 && (
          <label>
            Intervalo disponible{' '}
            <select
              aria-label="Intervalo cine parcial"
              value={
                available.some(([from, to]) => from === start - 1 && to === end - 1)
                  ? `${start - 1},${end - 1}`
                  : ''
              }
              disabled={job.busy}
              onChange={event => {
                const [from, to] = event.target.value.split(',').map(Number);
                changeRange(() => {
                  setStart(from + 1);
                  setEnd(to + 1);
                });
              }}
            >
              <option value="" disabled>
                Seleccionar cortes cargados
              </option>
              {available.map(([from, to]) => (
                <option key={`${from},${to}`} value={`${from},${to}`}>
                  {from + 1}–{to + 1}
                </option>
              ))}
            </select>
          </label>
        )}
        {!complete && (
          <p>
            MP4 disponible al completar la verificación de la serie. El cine parcial solo recorre el
            intervalo continuo ya preparado que selecciones; no omite cortes.
          </p>
        )}
        {job.busy && (
          <button type="button" onClick={job.cancel}>
            <Square size={14} /> Cancelar cine / MP4
          </button>
        )}
        {job.progress && (
          <div role="status">
            {job.progress.stage} · {job.progress.completed}/{job.progress.total}
            <progress
              aria-label="Progreso cine y MP4"
              max={job.progress.total}
              value={job.progress.completed}
            />
          </div>
        )}
        {job.error && <p role="alert">{job.error}</p>}
        <p>
          Una serie, sin audio ni datos de la interfaz. Copia de visualización con contraste fijo;
          no sustituye al DICOM. El MP4 lleva el número de corte y la orientación; sin fecha en el
          archivo.
        </p>
        {job.preview && (
          <DicomVideoPreview
            key={job.preview.url}
            preview={job.preview}
            discard={job.discard}
            failed={job.setError}
          />
        )}
      </div>
    </details>
  );
};
