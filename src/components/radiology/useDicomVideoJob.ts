import { useCallback, useEffect, useRef, useState } from 'react';
import type { DicomCineProgress } from '@/services/radiology/dicomCine';
import type { DicomMp4Result } from '@/services/radiology/dicomMp4';
import { describeDicomVideoLength } from '@/services/radiology/dicomVideoPlan';

export interface DicomVideoPreviewState {
  url: string;
  /** The user turned the anonymous profile off: name, RUT and date are burned in. */
  identified: boolean;
  filename: string;
  summary: string;
  notice?: string;
}
type Output = Omit<DicomVideoPreviewState, 'url'> & { blob: Blob };
type Task = (
  signal: AbortSignal,
  update: (value: DicomCineProgress) => void
) => Promise<Output | void>;

export const toDicomVideoOutput = (
  result: DicomMp4Result,
  fps: number,
  identified: boolean,
  filename: string
): Output => ({
  blob: result.blob,
  identified,
  filename,
  notice: result.notice,
  summary: `${result.width}×${result.height} · ${describeDicomVideoLength(result.frames, fps)}`,
});

/** One cine or MP4 job at a time. The video stays in memory behind a revocable blob URL:
 * discarding, a new job, closing or another series revokes it. Nothing is persisted. */
export const useDicomVideoJob = (resetKey: unknown, busyChanged: (value: boolean) => void) => {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DicomCineProgress | null>(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<DicomVideoPreviewState | null>(null);
  const job = useRef<AbortController | null>(null);
  const previewUrl = useRef('');
  const alive = useRef(true);
  const busyCallback = useRef(busyChanged);
  busyCallback.current = busyChanged;
  const discard = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = '';
    setPreview(null);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      job.current?.abort();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = '';
      busyCallback.current(false);
    };
  }, [resetKey]);
  const run = async (task: Task, failure: string) => {
    if (job.current) return;
    const controller = new AbortController();
    job.current = controller;
    discard();
    setError('');
    setBusy(true);
    busyCallback.current(true);
    try {
      const output = await task(controller.signal, value => {
        if (alive.current && !controller.signal.aborted) setProgress(value);
      });
      controller.signal.throwIfAborted();
      if (!alive.current || !output) return;
      const { blob, ...shown } = output;
      previewUrl.current = URL.createObjectURL(blob);
      setPreview({ ...shown, url: previewUrl.current });
    } catch (reason) {
      if (alive.current)
        setError(
          controller.signal.aborted
            ? 'Operación cancelada. No se guardó ningún video.'
            : reason instanceof Error
              ? reason.message
              : failure
        );
    } finally {
      job.current = null;
      if (alive.current) {
        setBusy(false);
        busyCallback.current(false);
        setProgress(null);
      }
    }
  };
  return {
    busy,
    progress,
    error,
    setError,
    preview,
    run,
    discard,
    cancel: () => job.current?.abort(),
  };
};
