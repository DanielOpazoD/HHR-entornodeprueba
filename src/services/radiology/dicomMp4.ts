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
  type DicomCineProgress,
  type DicomCineSession,
  type DicomVideoFrame,
} from './dicomCine';
import {
  dicomVideoBitrate,
  fitDicomVideoSize,
  validateDicomVideoFrames,
  type DicomVideoResolution,
} from './dicomVideoPlan';
import { drawDicomFrameIdentity, drawDicomFrameLabels } from './dicomFrameOverlay';
import { clearMp4CreationTimes } from './dicomMp4Metadata';

const MAX_BYTES = 64 * 1024 * 1024;

export interface DicomMp4Settings {
  fps: number;
  resolution: DicomVideoResolution;
  /** Name, RUT and date, burned in only when the user turned the anonymous profile off. */
  identity?: string;
}
export interface DicomMp4Result {
  blob: Blob;
  width: number;
  height: number;
  frames: number;
  /** Set when the browser cannot encode the chosen resolution and a smaller one was used. */
  notice?: string;
}

/** Mediabunny derives the H.264 level from size and bitrate: 3.1 for 720p, 4 for 1080p. */
const chooseEncoding = async (
  source: readonly [number, number],
  settings: DicomMp4Settings,
  signal: AbortSignal
) => {
  const tried = new Set<string>();
  for (const resolution of settings.resolution === '1080p'
    ? (['1080p', '720p'] as const)
    : (['720p'] as const)) {
    const size = fitDicomVideoSize(source[0], source[1], resolution);
    const key = `${size.width}x${size.height}`;
    if (tried.has(key)) continue;
    tried.add(key);
    const quality = new Quality({ bitrate: dicomVideoBitrate(size.width, size.height) });
    const supported = await abortableDicomTask(
      canEncodeVideo('avc', { ...size, frameRate: settings.fps, quality }),
      signal
    );
    if (supported)
      return {
        ...size,
        quality,
        notice:
          resolution === settings.resolution
            ? undefined
            : `Este navegador no codifica ${settings.resolution}; el video se generó en ${resolution}.`,
      };
  }
  throw new Error(
    'Este navegador no permite exportar MP4/H.264. Prueba Chrome o Safari actualizado.'
  );
};

const compose = (
  context: CanvasRenderingContext2D,
  frame: DicomVideoFrame,
  width: number,
  height: number,
  identity?: string
) => {
  context.fillStyle = 'black';
  context.fillRect(0, 0, width, height);
  context.drawImage(frame.canvas, 0, 0, width, height);
  drawDicomFrameLabels(context, width, height, frame.label, frame.edges);
  if (identity) drawDicomFrameIdentity(context, width, identity, Boolean(frame.edges));
};

/** One frame per planned position, each after IMAGE_RENDERED, with timestamps from its order
 * (never wall-clock speed or screen recording). No partial file, audio or creation date. */
export const exportDicomMp4 = async (
  session: DicomCineSession,
  positions: readonly number[],
  settings: DicomMp4Settings,
  signal: AbortSignal,
  progress: (value: DicomCineProgress) => void
): Promise<DicomMp4Result> => {
  const count = validateDicomVideoFrames(positions, settings.fps);
  const { fps } = settings;
  const encodingFailure = new AbortController();
  signal = AbortSignal.any([signal, encodingFailure.signal]);
  signal.throwIfAborted();
  progress({ completed: 0, total: count, stage: 'Preparando MP4' });
  const first = await session.frame(positions[0], signal);
  const sourceSize = [first.canvas.width, first.canvas.height] as const;
  // Copy now: the live canvas may redraw while the encoder support check is pending.
  const snapshot = document.createElement('canvas');
  snapshot.width = sourceSize[0];
  snapshot.height = sourceSize[1];
  snapshot.getContext('2d')?.drawImage(first.canvas, 0, 0);
  const canvas = document.createElement('canvas');
  let source: CanvasSource | undefined;
  let output: Output | undefined;
  const cancel = () => {
    void output?.cancel().catch(() => undefined);
  };
  try {
    const encoding = await chooseEncoding(sourceSize, settings, signal);
    signal.throwIfAborted();
    canvas.width = encoding.width;
    canvas.height = encoding.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar el video.');
    compose(
      context,
      { ...first, canvas: snapshot },
      canvas.width,
      canvas.height,
      settings.identity
    );
    snapshot.width = snapshot.height = 0;
    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat(), target });
    let encodedBytes = 0;
    const timestamps = new Set<number>();
    source = new CanvasSource(canvas, {
      codec: 'avc',
      quality: encoding.quality,
      onEncodedPacket: packet => {
        if (signal.aborted) return;
        encodedBytes += packet.data.byteLength;
        if (encodedBytes > MAX_BYTES) {
          encodingFailure.abort(new Error('El video supera 64 MB. Selecciona menos cortes.'));
          return;
        }
        const frame = Math.round(packet.timestamp * fps);
        if (!Number.isFinite(frame) || frame < 0 || frame >= count || timestamps.has(frame)) {
          encodingFailure.abort(new Error('El codificador alteró la secuencia de cuadros.'));
          return;
        }
        timestamps.add(frame);
      },
    });
    output.addVideoTrack(source, { frameRate: fps });
    signal.addEventListener('abort', cancel, { once: true });
    await abortableDicomTask(output.start(), signal);
    for (let index = 0; index < count; index++) {
      signal.throwIfAborted();
      progress({ completed: index, total: count, stage: 'Preparando cuadro' });
      if (index) {
        const frame = await session.frame(positions[index], signal);
        signal.throwIfAborted();
        if (frame.canvas.width !== sourceSize[0] || frame.canvas.height !== sourceSize[1])
          throw new Error('El tamaño de la vista cambió. Vuelve a generar el video.');
        compose(context, frame, canvas.width, canvas.height, settings.identity);
      }
      await abortableDicomTask(source.add(index / fps, 1 / fps), signal);
      progress({ completed: index + 1, total: count, stage: 'Codificando MP4' });
    }
    progress({ completed: count, total: count, stage: 'Finalizando MP4' });
    await abortableDicomTask(output.finalize(), signal);
    signal.throwIfAborted();
    if (timestamps.size !== count || !target.buffer || target.buffer.byteLength > MAX_BYTES)
      throw new Error('No se pudo completar un MP4 con todos los cuadros seleccionados.');
    return {
      blob: new Blob([clearMp4CreationTimes(target.buffer)], { type: 'video/mp4' }),
      width: canvas.width,
      height: canvas.height,
      frames: count,
      notice: encoding.notice,
    };
  } finally {
    signal.removeEventListener('abort', cancel);
    if (output && output.state !== 'finalized') await output.cancel().catch(() => undefined);
    source?.close();
    snapshot.width = snapshot.height = 0;
    canvas.width = canvas.height = 0;
  }
};
