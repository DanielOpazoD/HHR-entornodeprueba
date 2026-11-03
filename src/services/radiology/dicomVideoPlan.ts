/** Pure frame planning for local MP4 exports. A position is a slice index or an angle in degrees. */
export type DicomVideoSequence = 'loop' | 'pingpong';
export type DicomVideoResolution = '720p' | '1080p';
export type DicomTurntableAxis = 'vertical' | 'horizontal' | 'craniocaudal';
export interface DicomVideoOptions {
  sequence: DicomVideoSequence;
  resolution: DicomVideoResolution;
  fps: number;
  /** Owner decision: on by default. Off burns the patient's name, RUT and study date. */
  anonymous: boolean;
}

export const DICOM_VIDEO_FPS = [5, 10, 15, 20, 30] as const;
export const DICOM_VIDEO_MAX_FRAMES = 2048;
export const DICOM_TURNTABLE_ARCS = [360, 180, 90, 45] as const;
export const DICOM_TURNTABLE_FRAMES = { min: 4, max: 360 } as const;
/** Landscape boxes; a portrait view uses the same box turned, so the H.264 level is unchanged. */
export const dicomVideoBoxes: Record<DicomVideoResolution, readonly [number, number]> = {
  '720p': [1280, 720],
  '1080p': [1920, 1080],
};

export const defaultDicomVideoOptions = (fps = 10): DicomVideoOptions => ({
  sequence: 'loop',
  resolution: '720p',
  fps,
  anonymous: true,
});

/** Back-and-forth skips both turning points on the way back: a looping player never repeats one. */
export const sequenceDicomPositions = (
  forward: readonly number[],
  sequence: DicomVideoSequence
): number[] =>
  sequence === 'pingpong' && forward.length > 2
    ? [...forward, ...forward.slice(1, -1).reverse()]
    : [...forward];

/** Inclusive zero-based slice range, in the order the plane scrolls. */
export const sliceDicomPositions = (start: number, end: number, total: number): number[] => {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    !Number.isInteger(total) ||
    start < 0 ||
    end >= total ||
    start > end
  )
    throw new Error('Selecciona un intervalo de cortes válido.');
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
};

/** A full turn never repeats its first angle; a partial arc is centered on the current view. */
export const turntableDicomAngles = (count: number, arc: number): number[] => {
  if (
    !Number.isInteger(count) ||
    count < DICOM_TURNTABLE_FRAMES.min ||
    count > DICOM_TURNTABLE_FRAMES.max ||
    !DICOM_TURNTABLE_ARCS.includes(arc as (typeof DICOM_TURNTABLE_ARCS)[number])
  )
    throw new Error(
      `Selecciona entre ${DICOM_TURNTABLE_FRAMES.min} y ${DICOM_TURNTABLE_FRAMES.max} cuadros y un giro válido.`
    );
  return arc === 360
    ? Array.from({ length: count }, (_, index) => (360 * index) / count)
    : Array.from({ length: count }, (_, index) => -arc / 2 + (arc * index) / (count - 1));
};

export const validateDicomVideoFrames = (positions: readonly number[], fps: number) => {
  if (!DICOM_VIDEO_FPS.includes(fps as (typeof DICOM_VIDEO_FPS)[number]))
    throw new Error('Selecciona una velocidad entre 5 y 30 cuadros/s.');
  if (!positions.length || positions.some(value => !Number.isFinite(value)))
    throw new Error('No hay cuadros para el video.');
  if (positions.length > DICOM_VIDEO_MAX_FRAMES)
    throw new Error(
      `El video admite hasta ${DICOM_VIDEO_MAX_FRAMES} cuadros. Selecciona menos cortes o cuadros.`
    );
  return positions.length;
};

/** Even dimensions inside the chosen box. Never upscaled: interpolation adds no detail. */
export const fitDicomVideoSize = (
  width: number,
  height: number,
  resolution: DicomVideoResolution
) => {
  if (!(width > 0 && height > 0)) throw new Error('Imagen no disponible.');
  const [long, short] = dicomVideoBoxes[resolution];
  const [boxWidth, boxHeight] = width >= height ? [long, short] : [short, long];
  const scale = Math.min(1, boxWidth / width, boxHeight / height);
  return {
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
};

/** 4 Mbps up to 720p, growing with area to 8 Mbps: within H.264 levels 3.1 and 4. */
export const dicomVideoBitrate = (width: number, height: number) =>
  Math.round(Math.min(8_000_000, Math.max(4_000_000, (4_000_000 * width * height) / (1280 * 720))));

export const describeDicomVideoLength = (frames: number, fps: number) =>
  `${frames} ${frames === 1 ? 'cuadro' : 'cuadros'} · ${(frames / fps).toFixed(1).replace('.', ',')} s`;

type Vector = [number, number, number];
const cross = (a: readonly number[], b: readonly number[]): Vector => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (value: readonly number[]): Vector => {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!(length > 1e-9)) throw new Error('La cámara 3D no permite este giro.');
  return [value[0] / length, value[1] / length, value[2] / length];
};
/** Rodrigues' rotation of a vector about a unit axis. */
const rotate = (value: readonly number[], axis: Vector, degrees: number): Vector => {
  const angle = (degrees * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const turn = cross(axis, value);
  const along = axis[0] * value[0] + axis[1] * value[1] + axis[2] * value[2];
  return [0, 1, 2].map(i => value[i] * cos + turn[i] * sin + axis[i] * along * (1 - cos)) as Vector;
};
interface TurntableCamera {
  focalPoint: readonly number[];
  position: readonly number[];
  viewUp: readonly number[];
  viewPlaneNormal: readonly number[];
}

/** Orbits about the focal point, always from the camera saved before the video: no drift, and
 * restoring that camera returns the exact view. Screen axes follow that saved camera;
 * craniocaudal is the patient's S–I axis in LPS. */
export const turntableDicomCamera = (
  camera: TurntableCamera,
  axis: DicomTurntableAxis,
  degrees: number
) => {
  const turn = unit(
    axis === 'vertical'
      ? camera.viewUp
      : axis === 'horizontal'
        ? cross(camera.viewUp, camera.viewPlaneNormal)
        : [0, 0, 1]
  );
  const offset = camera.position.map((value, i) => value - camera.focalPoint[i]);
  return {
    focalPoint: [...camera.focalPoint] as Vector,
    position: rotate(offset, turn, degrees).map(
      (value, i) => value + camera.focalPoint[i]
    ) as Vector,
    viewUp: rotate(camera.viewUp, turn, degrees),
  };
};
