import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeVideo,
} from 'mediabunny';
import {
  abortableDicomTask,
  validateCineOptions,
  type DicomCineOptions,
  type DicomCineProgress,
  type DicomCineSession,
} from './dicomCine';

const MAX_BYTES = 64 * 1024 * 1024;

/** Frame timestamps come from slice order, never wall-clock speed or screen recording. */
export const exportDicomMp4 = async (
  session: DicomCineSession,
  options: DicomCineOptions,
  total: number,
  signal: AbortSignal,
  progress: (value: DicomCineProgress) => void
): Promise<Blob> => {
  const count = validateCineOptions(options, total);
  const encodingFailure = new AbortController();
  signal = AbortSignal.any([signal, encodingFailure.signal]);
  signal.throwIfAborted();
  progress({ completed: 0, total: count, stage: 'Preparando MP4' });
  const canvas = await session.frame(options.start, signal);
  const quality = new Quality({ bitrate: 4_000_000 });
  if (
    !(await abortableDicomTask(
      canEncodeVideo('avc', {
        width: canvas.width,
        height: canvas.height,
        frameRate: options.fps,
        quality,
      }),
      signal
    ))
  )
    throw new Error(
      'Este navegador no permite exportar MP4/H.264. Prueba Chrome o Safari actualizado.'
    );
  signal.throwIfAborted();
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar el video.');
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  let encodedBytes = 0;
  const timestamps = new Set<number>();
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    quality,
    onEncodedPacket: packet => {
      if (signal.aborted) return;
      encodedBytes += packet.data.byteLength;
      if (encodedBytes > MAX_BYTES) {
        encodingFailure.abort(new Error('El video supera 64 MB. Selecciona menos cortes.'));
        return;
      }
      const frame = Math.round(packet.timestamp * options.fps);
      if (!Number.isFinite(frame) || frame < 0 || frame >= count || timestamps.has(frame)) {
        encodingFailure.abort(new Error('El codificador alteró la secuencia de cuadros.'));
        return;
      }
      timestamps.add(frame);
    },
  });
  output.addVideoTrack(source, { frameRate: options.fps });
  const cancel = () => {
    void output.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await abortableDicomTask(output.start(), signal);
    for (let index = options.start; index <= options.end; index++) {
      signal.throwIfAborted();
      progress({ completed: index - options.start, total: count, stage: 'Preparando corte' });
      if (index !== options.start) {
        const frame = await session.frame(index, signal);
        signal.throwIfAborted();
        if (frame.width !== canvas.width || frame.height !== canvas.height)
          throw new Error('El tamaño de la vista cambió. Vuelve a generar el video.');
        context.drawImage(frame, 0, 0);
        frame.width = frame.height = 0;
      }
      await abortableDicomTask(
        source.add((index - options.start) / options.fps, 1 / options.fps),
        signal
      );
      progress({ completed: index - options.start + 1, total: count, stage: 'Codificando MP4' });
    }
    progress({ completed: count, total: count, stage: 'Finalizando MP4' });
    await abortableDicomTask(output.finalize(), signal);
    signal.throwIfAborted();
    if (timestamps.size !== count || !target.buffer || target.buffer.byteLength > MAX_BYTES)
      throw new Error('No se pudo completar un MP4 con todos los cortes seleccionados.');
    return new Blob([target.buffer], { type: 'video/mp4' });
  } finally {
    signal.removeEventListener('abort', cancel);
    if (output.state !== 'finalized') await output.cancel().catch(() => undefined);
    source.close();
    canvas.width = canvas.height = 0;
  }
};
