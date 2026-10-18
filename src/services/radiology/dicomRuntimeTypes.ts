import type { createDicomComparison } from './dicomComparison';
import type { DicomSeries } from './dicomTypes';
import type { ProgressiveDicomSeries } from './dicomSeriesLoader';
import type { DicomCineSession } from './dicomCine';
import type { DicomStackState } from './dicomProgressiveStack';
import type { DicomReference, ReferenceStyle } from './dicomMprTools';
import type { VolumePresentation } from './dicomPresentation';
import type { captureDicomCanvas } from './dicomCanvasCapture';

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
export interface DicomOrientation {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export interface DicomRuntime {
  readonly sessionId: string;
  loading: ProgressiveDicomSeries['loading'];
  completion: Promise<void>;
  compare: (
    series: DicomSeries,
    elements: HTMLDivElement[],
    signal: AbortSignal,
    notify: Parameters<typeof createDicomComparison>[7]
  ) => Promise<ReturnType<typeof createDicomComparison>>;
  openCine: () => DicomCineSession;
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
