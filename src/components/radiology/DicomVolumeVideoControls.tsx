import React, { useEffect, useState } from 'react';
import { Film, Square } from 'lucide-react';
import type { DicomRuntime } from '@/services/radiology/dicomRuntimeTypes';
import { abortableDicomTask } from '@/services/radiology/dicomCine';
import {
  DICOM_TURNTABLE_ARCS,
  DICOM_TURNTABLE_FRAMES,
  defaultDicomVideoOptions,
  describeDicomVideoLength,
  sequenceDicomPositions,
  sliceDicomPositions,
  turntableDicomAngles,
  validateDicomVideoFrames,
  type DicomTurntableAxis,
  type DicomVideoOptions,
} from '@/services/radiology/dicomVideoPlan';
import { toDicomVideoOutput, useDicomVideoJob } from './useDicomVideoJob';
import { useDicomReconstruction } from './useDicomReconstruction';
import { DicomVideoPreview } from './DicomVideoPreview';
import { DicomVideoSettings } from './DicomVideoSettings';
import { dicomPlaneLabels } from './DicomViewportGrid';
import './dicomCine.css';

const axes: Array<[DicomTurntableAxis, string]> = [
  ['vertical', 'Vertical de la pantalla'],
  ['horizontal', 'Horizontal de la pantalla'],
  ['craniocaudal', 'Craneocaudal del paciente'],
];

/** MPR sweep of the active plane, or 3D turntable. Both keep the current reconstruction or
 * appearance and return the view to where it was when the video ends or is cancelled. */
export const DicomVolumeVideoControls: React.FC<{
  runtime: DicomRuntime;
  mode: 'mpr' | '3d';
  plane: number;
  disabled: boolean;
  busyChanged: (value: boolean) => void;
  identity?: string;
}> = ({ runtime, mode, plane, disabled, busyChanged, identity }) => {
  const reconstruction = useDicomReconstruction(runtime);
  const job = useDicomVideoJob(runtime, busyChanged);
  const [slices, setSlices] = useState<{ current: number; total: number } | null>(null);
  const [range, setRange] = useState<[number, number]>([1, 1]);
  const [axis, setAxis] = useState<DicomTurntableAxis>('vertical');
  const [arc, setArc] = useState(360);
  const [frames, setFrames] = useState(48);
  const [video, setVideo] = useState(() => defaultDicomVideoOptions(mode === '3d' ? 15 : 10));
  const total = slices?.total ?? 0;
  const { discard } = job;
  // The slice count depends on the plane and its obliquity; frames of a running video must
  // not move the reported current slice.
  useEffect(() => {
    if (mode === 'mpr' && !job.busy) setSlices(runtime.mprSlices(plane));
  }, [runtime, mode, plane, reconstruction, job.busy]);
  useEffect(() => {
    discard();
    setRange([1, Math.max(1, total)]);
  }, [plane, total, discard]);
  const plan = () =>
    sequenceDicomPositions(
      mode === 'mpr'
        ? sliceDicomPositions(range[0] - 1, range[1] - 1, total)
        : turntableDicomAngles(frames, arc),
      video.sequence
    );
  let duration = '';
  try {
    duration = describeDicomVideoLength(validateDicomVideoFrames(plan(), video.fps), video.fps);
  } catch {
    /* Shown when generating. */
  }
  const change = (action: () => void) => {
    discard();
    action();
  };
  const changeVideo = (patch: Partial<DicomVideoOptions>) =>
    change(() => setVideo(current => ({ ...current, ...patch })));
  const identified = !video.anonymous && Boolean(identity);
  const generate = () => {
    if (disabled) return;
    void job.run(async (signal, update) => {
      const positions = plan();
      validateDicomVideoFrames(positions, video.fps);
      const session = runtime.openVideo(
        mode === 'mpr' ? { kind: 'mpr', plane } : { kind: '3d', axis }
      );
      try {
        const { exportDicomMp4 } = await abortableDicomTask(
          import('@/services/radiology/dicomMp4'),
          signal
        );
        signal.throwIfAborted();
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
        return toDicomVideoOutput(
          result,
          video.fps,
          identified,
          mode === 'mpr' ? 'barrido-mpr-dicom.mp4' : 'giro-3d-dicom.mp4'
        );
      } finally {
        session.close();
      }
    }, 'No se pudo generar el video.');
  };
  return (
    <details className="dicom-cine">
      <summary aria-label="Video MP4" title="Video MP4">
        <Film size={15} /> MP4 {job.busy && '· En curso'}
      </summary>
      <div className="dicom-cine-panel">
        <fieldset disabled={disabled || job.busy}>
          {mode === 'mpr' ? (
            <>
              <output className="dicom-video-plane" aria-label="Plano del barrido">
                {dicomPlaneLabels.mpr[plane]} ·{' '}
                {reconstruction?.planes[plane]?.label ?? 'Corte fino'}
                {slices && ` · corte actual ${slices.current + 1} de ${slices.total}`}
              </output>
              <label>
                Desde{' '}
                <input
                  aria-label="Corte inicial"
                  type="number"
                  min={1}
                  max={total}
                  value={range[0]}
                  onChange={e => change(() => setRange([Number(e.target.value), range[1]]))}
                />
              </label>
              <label>
                Hasta{' '}
                <input
                  aria-label="Corte final"
                  type="number"
                  min={1}
                  max={total}
                  value={range[1]}
                  onChange={e => change(() => setRange([range[0], Number(e.target.value)]))}
                />
              </label>
            </>
          ) : (
            <>
              <label>
                Eje{' '}
                <select
                  aria-label="Eje de giro 3D"
                  value={axis}
                  onChange={e => change(() => setAxis(e.target.value as DicomTurntableAxis))}
                >
                  {axes.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Giro{' '}
                <select
                  aria-label="Giro 3D"
                  value={arc}
                  onChange={e => change(() => setArc(Number(e.target.value)))}
                >
                  {DICOM_TURNTABLE_ARCS.map(value => (
                    <option key={value} value={value}>
                      {value}°
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cuadros{' '}
                <input
                  aria-label="Cuadros del giro 3D"
                  type="number"
                  min={DICOM_TURNTABLE_FRAMES.min}
                  max={DICOM_TURNTABLE_FRAMES.max}
                  value={frames}
                  onChange={e => change(() => setFrames(Number(e.target.value)))}
                />
              </label>
            </>
          )}
        </fieldset>
        <fieldset disabled={disabled || job.busy} aria-label="Opciones de MP4">
          <DicomVideoSettings value={video} change={changeVideo} identity={identity} speed />
          <button type="button" disabled={mode === 'mpr' && !total} onClick={generate}>
            Generar MP4
          </button>
          {duration && <output aria-label="Duración del video">{duration}</output>}
        </fieldset>
        {job.busy && (
          <button type="button" onClick={job.cancel}>
            <Square size={14} /> Cancelar MP4
          </button>
        )}
        {job.progress && (
          <div role="status">
            {job.progress.stage} · {job.progress.completed}/{job.progress.total}
            <progress
              aria-label="Progreso MP4"
              max={job.progress.total}
              value={job.progress.completed}
            />
          </div>
        )}
        {job.error && <p role="alert">{job.error}</p>}
        <p>
          {mode === 'mpr'
            ? 'Barre el plano activo corte a corte con el espesor y la proyección actuales (por ejemplo, MIP).'
            : 'Gira la vista 3D actual con su apariencia, opacidad, umbral y recorte.'}{' '}
          La vista vuelve a su posición al terminar. Sin audio, datos de la interfaz ni fecha en el
          archivo; no sustituye al DICOM.
        </p>
        {job.preview && (
          <DicomVideoPreview
            key={job.preview.url}
            preview={job.preview}
            discard={discard}
            failed={job.setError}
          />
        )}
      </div>
    </details>
  );
};
