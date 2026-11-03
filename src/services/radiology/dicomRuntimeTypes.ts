import type { DicomOrientation } from './dicomTypes';
import type { MprSettings } from '@/domain/radiology/dicomReconstruction';
import type { MprReconstructionState } from './dicomMprReconstruction';
import type { createDicomComparison } from './dicomComparison';
import type { DicomSeries } from './dicomTypes';
import type { ProgressiveDicomSeries } from './dicomSeriesLoader';
import type { DicomCineSession } from './dicomCine';
import type { DicomStackState } from './dicomProgressiveStack';
import type { DicomReference, ReferenceStyle } from './dicomMprTools';
import type { VolumePresentation } from './dicomPresentation';
import type { captureDicomCanvas } from './dicomCanvasCapture';
import type { DicomVideoRequest } from './dicomVolumeVideo';

export type DicomTool =
  | 'window'
  | 'pan'
  | 'zoom'
  | 'rotate'
  | 'reference'
  | 'length'
  | 'angle'
  | 'probe'
  | 'roi';
export type DicomMode = 'original' | 'mpr' | '3d';
// Defined with the study types so overlay, cine and video code can share it without a cycle.
export type { DicomOrientation } from './dicomTypes';

export interface DicomRuntime {
  readonly sessionId: string;
  onGraphics: (
    listener: (state: import('./dicomViewContinuity').DicomGraphicsState) => void
  ) => () => void;
  loading: ProgressiveDicomSeries['loading'];
  completion: Promise<void>;
  compare: (
    series: DicomSeries,
    elements: HTMLDivElement[],
    signal: AbortSignal,
    notify: Parameters<typeof createDicomComparison>[7]
  ) => Promise<ReturnType<typeof createDicomComparison>>;
  onReconstruction: (listener: (state: MprReconstructionState | null) => void) => () => void;
  reconstruct: (patch: Partial<MprSettings> | null) => void;
  /** restoreSlice returns to the cut shown before the session when it closes (MP4 export). */
  openCine: (options?: { restoreSlice?: boolean }) => DicomCineSession;
  /** MPR sweep of one plane or 3D turntable; closing restores the camera it moved. */
  openVideo: (request: DicomVideoRequest) => DicomCineSession & { total: number };
  /** Zero-based current slice and slice count of an MPR plane, as the wheel scrolls it. */
  mprSlices: (plane: number) => { current: number; total: number } | null;
  select: (index: number) => void;
  onStack: (listener: (state: DicomStackState) => void) => () => void;
  show: (mode: DicomMode, elements: HTMLDivElement[]) => Promise<void>;
  tool: (tool: DicomTool) => void;
  window: (width: number, center: number) => void;
  reset: () => void;
  step: (plane: number, delta: number) => void;
  orientations: () => DicomOrientation[];
  reference: (enabled: boolean, style: ReferenceStyle) => void;
  onReference: (listener: (value: DicomReference | null) => void) => () => void;
  undoMeasurement: () => void;
  clearMeasurements: () => void;
  invert: (value: boolean) => void;
  presentation: (value: VolumePresentation) => void;
  isResampled: () => boolean;
  quantitative: () => boolean;
  capture: (plane: number) => ReturnType<typeof captureDicomCanvas>;
  dispose: () => void;
}
