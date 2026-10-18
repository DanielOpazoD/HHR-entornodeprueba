import React, { useEffect, useRef, useState } from 'react';
import { Film, Play, Square } from 'lucide-react';
import type { DicomRuntime } from '@/services/radiology/dicomRuntimeTypes';
import {
  abortableDicomTask,
  playDicomCine,
  validateCineOptions,
  type DicomCineProgress,
  type DicomCineSession,
} from '@/services/radiology/dicomCine';
import './dicomCine.css';

export const DicomCineControls: React.FC<{
  runtime: DicomRuntime;
  total: number;
  available: Array<[number, number]>;
  disabled: boolean;
  complete: boolean;
  busyChanged: (value: boolean) => void;
}> = ({ runtime, total, available, disabled, complete, busyChanged }) => {
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(total);
  const [fps, setFps] = useState(10);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DicomCineProgress | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [playable, setPlayable] = useState(false);
  const job = useRef<AbortController | null>(null);
  const previewUrl = useRef('');
  const alive = useRef(true);
  const busyCallback = useRef(busyChanged);
  busyCallback.current = busyChanged;
  const discard = () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = '';
    setPreview('');
    setReviewed(false);
    setPlayable(false);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      job.current?.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      busyCallback.current(false);
    };
  }, [runtime]);
  const run = async (exportVideo: boolean) => {
    if (job.current || disabled || (exportVideo && !complete)) return;
    const controller = new AbortController();
    job.current = controller;
    const options = { start: start - 1, end: end - 1, fps };
    let session: DicomCineSession | undefined;
    discard();
    setError('');
    setBusy(true);
    busyChanged(true);
    try {
      validateCineOptions(options, total);
      if (
        !exportVideo &&
        !complete &&
        !available.some(([from, to]) => options.start >= from && options.end <= to)
      )
        throw new Error('Para cine parcial, selecciona un intervalo continuo disponible.');
      session = runtime.openCine();
      const update = (value: DicomCineProgress) => {
        if (alive.current && !controller.signal.aborted) setProgress(value);
      };
      if (exportVideo) {
        const { exportDicomMp4 } = await abortableDicomTask(
          import('@/services/radiology/dicomMp4'),
          controller.signal
        );
        controller.signal.throwIfAborted();
        const blob = await exportDicomMp4(session, options, total, controller.signal, update);
        controller.signal.throwIfAborted();
        if (!alive.current) return;
        previewUrl.current = URL.createObjectURL(blob);
        setPreview(previewUrl.current);
      } else await playDicomCine(session, options, total, controller.signal, update);
    } catch (reason) {
      if (alive.current) {
        setError(
          controller.signal.aborted
            ? 'Operación cancelada. No se guardó ningún video.'
            : reason instanceof Error
              ? reason.message
              : 'No se pudo completar el cine.'
        );
      }
    } finally {
      session?.close();
      job.current = null;
      if (alive.current) {
        setBusy(false);
        busyChanged(false);
        setProgress(null);
      }
    }
  };
  const changeRange = (action: () => void) => {
    discard();
    action();
  };
  return (
    <details className="dicom-cine">
      <summary>
        <Film size={15} /> Cine / MP4 {busy && '· En curso'}
      </summary>
      <div className="dicom-cine-panel">
        <fieldset disabled={disabled || busy}>
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
              value={fps}
              onChange={e => changeRange(() => setFps(Number(e.target.value)))}
            >
              {[5, 10, 15, 20, 30].map(value => (
                <option key={value} value={value}>
                  {value} cortes/s
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void run(false)}>
            <Play size={14} /> Reproducir
          </button>
          <button type="button" disabled={!complete} onClick={() => void run(true)}>
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
              disabled={busy}
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
        {busy && (
          <button type="button" onClick={() => job.current?.abort()}>
            <Square size={14} /> Cancelar cine / MP4
          </button>
        )}
        {progress && (
          <div role="status">
            {progress.stage} · {progress.completed}/{progress.total}
            <progress
              aria-label="Progreso cine y MP4"
              max={progress.total}
              value={progress.completed}
            />
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <p>
          Una serie, sin audio ni datos de la interfaz. Copia de visualización con contraste fijo;
          no sustituye al DICOM.
        </p>
        {preview && (
          <div className="dicom-cine-preview">
            <video
              aria-label="Vista previa MP4"
              src={preview}
              controls
              controlsList="nodownload noremoteplayback"
              disablePictureInPicture
              disableRemotePlayback
              onContextMenu={event => event.preventDefault()}
              playsInline
              preload="auto"
              onLoadedData={() => setPlayable(true)}
              onError={() => {
                setPlayable(false);
                setError('No se pudo reproducir el MP4. No lo descargues.');
              }}
            />
            <p>
              Revisa el video completo: los píxeles originales pueden contener datos identificables.
              No se anonimiza automáticamente ni se envía a terceros.
            </p>
            <label>
              <input
                type="checkbox"
                checked={reviewed}
                disabled={!playable}
                onChange={e => setReviewed(e.target.checked)}
              />{' '}
              Revisé el video completo y no contiene datos identificables visibles.
            </label>
            {reviewed && playable && (
              <a href={preview} download="secuencia-dicom.mp4">
                Descargar MP4
              </a>
            )}
            <button type="button" onClick={discard}>
              Descartar video
            </button>
          </div>
        )}
      </div>
    </details>
  );
};
